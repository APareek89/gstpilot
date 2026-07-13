// Embedding provider for GSTPilot retrieval.
// One small interface so the model is swappable — and as of the free-tier deploy, it actually
// has two implementations behind an env switch:
//   • LocalBgeM3 (dev default): bge-m3 runs in-process via Transformers.js — no API, no
//     per-token cost, but ~1.5GB RAM for the loaded weights.
//   • HfApiBgeM3 (EMBEDDINGS_PROVIDER=hf-api): the SAME bge-m3 weights served by Hugging
//     Face's Inference API — ~250MB total RAM, which is what fits Render's free 512MB
//     instance. Same model = same vector space, so the 1064 chunk vectors already in
//     Supabase remain valid and only QUERY embedding goes over the wire.
//
// The CONTEXT LINE: before embedding, every chunk gets one prepended line like
// "CGST-ACT | CHAPTER V — INPUT TAX CREDIT". Three sentences on why this matters:
// A chunk's text often never names its own act or chapter — "(1) Every registered person
// shall…" could live anywhere in three statutes. The context line injects that identity
// into the vector, so a question about "input tax credit rules" pulls chunks from the ITC
// chapter even when their body text is procedural boilerplate. It costs a dozen tokens and
// disambiguates hundreds of otherwise look-alike provisions.

import { EMBEDDING } from "./config";

export interface EmbeddingProvider {
  /** Embed texts into vectors. Same call for queries and documents (bge-m3 is symmetric). */
  embed(texts: string[]): Promise<number[][]>;
}

// The model takes ~seconds to load, so it's created once and reused (important for the
// Playground, where every request would otherwise pay the load time).
// `any` avoided by typing through the dynamic import below.
let extractor: Awaited<ReturnType<typeof loadPipeline>> | null = null;

// Lazy import: @huggingface/transformers drags in the onnxruntime NATIVE binding at import
// time. On the hf-api path that memory must never be paid — so the local path only touches
// the package inside its own embed() call, never at module load.
async function loadPipeline() {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("feature-extraction", EMBEDDING.modelId, {
    revision: EMBEDDING.revision,
    dtype: "q8", // quantized weights: ~4x smaller/faster on CPU, negligible quality loss
  });
}

export class LocalBgeM3 implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    extractor ??= await loadPipeline();
    // cls pooling + normalize is bge-m3's documented dense-retrieval recipe; normalized
    // vectors mean cosine similarity is a simple dot product in SQL.
    const out = await extractor(texts, { pooling: "cls", normalize: true });
    return out.tolist() as number[][];
  }
}

// HfApiBgeM3 — the same recipe, remotely. HF's feature-extraction pipeline for bge-m3 applies
// the model's own sentence-transformers config (cls pooling + normalize), i.e. exactly what
// LocalBgeM3 does — the vectors land in the same space as the stored chunk vectors.
// Trust boundary in code: every response is shape-checked (array of 1024-float vectors, one
// per input) — a wrong-shaped response throws loudly rather than silently corrupting search.
export class HfApiBgeM3 implements EmbeddingProvider {
  private url = `https://router.huggingface.co/hf-inference/models/${EMBEDDING.apiModelId}/pipeline/feature-extraction`;

  async embed(texts: string[]): Promise<number[][]> {
    const key = process.env.HF_API_KEY;
    if (!key) throw new Error("EMBEDDINGS_PROVIDER=hf-api but HF_API_KEY is not set.");
    // Serverless models scale to zero — the first call after idle can 503 while the model
    // warms. Retry with backoff instead of failing a user's very first question of the day.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: texts }),
        });
        if (res.status === 503 || res.status === 429) throw new Error(`HF API warming/limited (${res.status})`);
        if (!res.ok) throw new Error(`HF API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const out = (await res.json()) as unknown;
        return this.validate(out, texts.length);
      } catch (e) {
        lastErr = e as Error;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw new Error(`Embedding API failed after retries: ${lastErr?.message}`);
  }

  // Accepts [[...floats]] per input; a single input may come back as one flat vector.
  private validate(out: unknown, expected: number): number[][] {
    const vecs: unknown[] =
      Array.isArray(out) && out.length && typeof (out as number[])[0] === "number"
        ? [out] // single flat vector
        : (out as unknown[]);
    if (!Array.isArray(vecs) || vecs.length !== expected) {
      throw new Error(`HF API returned ${Array.isArray(vecs) ? vecs.length : "non-array"} vectors for ${expected} inputs`);
    }
    for (const v of vecs) {
      if (!Array.isArray(v) || v.length !== EMBEDDING.dimensions || typeof v[0] !== "number") {
        throw new Error(`HF API vector has wrong shape (expected ${EMBEDDING.dimensions} floats)`);
      }
    }
    return vecs as number[][];
  }
}

export function getEmbedder(): EmbeddingProvider {
  return process.env.EMBEDDINGS_PROVIDER === "hf-api" ? new HfApiBgeM3() : new LocalBgeM3();
}

/** The context line + text that actually gets embedded for a chunk. */
export function embeddingInput(chunk: { act: string; heading_path: string[]; text: string }): string {
  return `${chunk.act} | ${chunk.heading_path.join(" › ")}\n${chunk.text}`;
}
