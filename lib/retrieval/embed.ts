// Embedding provider for GSTPilot retrieval.
// One small interface so the model is swappable (a paid API can slot in later without
// touching callers); today's single implementation runs BAAI's bge-m3 locally through
// Transformers.js — no API, no per-token cost, weights downloaded once and cached.
//
// The CONTEXT LINE: before embedding, every chunk gets one prepended line like
// "CGST-ACT | CHAPTER V — INPUT TAX CREDIT". Three sentences on why this matters:
// A chunk's text often never names its own act or chapter — "(1) Every registered person
// shall…" could live anywhere in three statutes. The context line injects that identity
// into the vector, so a question about "input tax credit rules" pulls chunks from the ITC
// chapter even when their body text is procedural boilerplate. It costs a dozen tokens and
// disambiguates hundreds of otherwise look-alike provisions.

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING } from "./config";

export interface EmbeddingProvider {
  /** Embed texts into vectors. Same call for queries and documents (bge-m3 is symmetric). */
  embed(texts: string[]): Promise<number[][]>;
}

// The model takes ~seconds to load, so it's created once and reused (important for the
// Playground, where every request would otherwise pay the load time).
let extractor: FeatureExtractionPipeline | null = null;

export class LocalBgeM3 implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    extractor ??= await pipeline("feature-extraction", EMBEDDING.modelId, {
      revision: EMBEDDING.revision,
      dtype: "q8", // quantized weights: ~4x smaller/faster on CPU, negligible quality loss
    });
    // cls pooling + normalize is bge-m3's documented dense-retrieval recipe; normalized
    // vectors mean cosine similarity is a simple dot product in SQL.
    const out = await extractor(texts, { pooling: "cls", normalize: true });
    return out.tolist() as number[][];
  }
}

export function getEmbedder(): EmbeddingProvider {
  return new LocalBgeM3();
}

/** The context line + text that actually gets embedded for a chunk. */
export function embeddingInput(chunk: { act: string; heading_path: string[]; text: string }): string {
  return `${chunk.act} | ${chunk.heading_path.join(" › ")}\n${chunk.text}`;
}
