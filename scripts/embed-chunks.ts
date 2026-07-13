// Embeds every chunk that doesn't have a vector yet. Run: pnpm embed
// Resumable by design (same pattern as enrichment): only rows with a NULL embedding are
// fetched, so a crash or re-run continues where it left off, and re-running after new
// chunks load touches only the new ones. Changing the model in config requires clearing
// the column first — vectors from different models must never coexist.

import "dotenv/config";
import { getEmbedder, embeddingInput } from "../lib/retrieval/embed";
import { getServiceClient, TABLE_PREFIX } from "../lib/supabase";

// NO truncation — embed every chunk WHOLE. The OOM that once forced a 6,000-char cap was
// batch-16 of long texts: transformer attention memory grows with batch × length², so many
// long texts at once exhausted the ONNX runtime's native memory (invisible to Node's heap).
// bge-m3 handles up to ~8,192 tokens and our largest chunk is ~4,330, so the fix is to bound
// the BATCH, not the text: short chunks ride in groups of BATCH, oversized ones embed SOLO at
// full length. A rule's tail (e.g. r89's refund formula) now survives in its vector.
const BATCH = 4;
const SOLO_ABOVE_CHARS = 6_000;   // a chunk longer than this embeds alone (one giant fits fine)
const MODEL_MAX_CHARS = 24_000;   // ~8,192-token window; beyond this the model itself truncates

async function main() {
  const supabase = getServiceClient();
  const embedder = getEmbedder();
  let done = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(`${TABLE_PREFIX}legal_chunks`)
      .select("id, act, heading_path, text")
      .is("embedding", null)
      .limit(200);
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    const writeVec = async (id: string, vec: number[]) => {
      // A long batch WILL hit a transient network blip — retry each write with backoff
      // instead of letting one hiccup waste the CPU time already spent.
      let lastErr = "";
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 3_000 * attempt));
        try {
          const { error: upErr } = await supabase
            .from(`${TABLE_PREFIX}legal_chunks`)
            .update({ embedding: JSON.stringify(vec) }) // pgvector accepts the '[0.1,0.2,…]' string form
            .eq("id", id);
          if (!upErr) return;
          lastErr = upErr.message;
        } catch (e) {
          lastErr = (e as Error).message;
        }
      }
      throw new Error(`${id}: ${lastErr} (after 4 attempts)`);
    };

    const embedBatch = async (rows: any[]) => {
      const vectors = await embedder.embed(rows.map((r) => embeddingInput(r))); // WHOLE text, no slice
      for (let j = 0; j < rows.length; j++) await writeVec(rows[j].id, vectors[j]);
      done += rows.length;
      console.log(`  …${done} embedded`);
    };

    // Short chunks batch together; an oversized chunk flushes the batch and embeds SOLO, so we
    // never hold many long attention matrices at once. The tripwire warns before the model's
    // own limit silently truncates a future mega-provision.
    let pending: any[] = [];
    for (const row of data) {
      const chars = embeddingInput(row).length;
      if (chars > MODEL_MAX_CHARS)
        console.warn(`  ⚠ TRIPWIRE ${row.id}: ${chars} chars exceed the ~8,192-token window — the model will truncate it. Split this provision at sub-rule boundaries.`);
      if (chars > SOLO_ABOVE_CHARS) {
        if (pending.length) { await embedBatch(pending); pending = []; }
        await embedBatch([row]);
      } else {
        pending.push(row);
        if (pending.length >= BATCH) { await embedBatch(pending); pending = []; }
      }
    }
    if (pending.length) await embedBatch(pending);
  }
  console.log(`EMBED DONE total=${done}`);
}

main().catch((e) => { console.error(`EMBED FAILED: ${e.message}`); process.exit(1); });
