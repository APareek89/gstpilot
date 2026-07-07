// Embeds every chunk that doesn't have a vector yet. Run: pnpm embed
// Resumable by design (same pattern as enrichment): only rows with a NULL embedding are
// fetched, so a crash or re-run continues where it left off, and re-running after new
// chunks load touches only the new ones. Changing the model in config requires clearing
// the column first — vectors from different models must never coexist.

import "dotenv/config";
import { getEmbedder, embeddingInput } from "../lib/retrieval/embed";
import { getServiceClient, TABLE_PREFIX } from "../lib/supabase";

// Small batch + input cap: batch 16 of full-length sections OOM-killed the ONNX runtime
// (native memory, invisible to Node's heap limit). 4 × ~6000 chars fits comfortably; the
// head of a provision carries its identity, so truncating the tail barely affects recall.
const BATCH = 4;
const MAX_INPUT_CHARS = 6_000;

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

    for (let i = 0; i < data.length; i += BATCH) {
      const rows = data.slice(i, i + BATCH);
      const vectors = await embedder.embed(
        rows.map((r) => embeddingInput(r).slice(0, MAX_INPUT_CHARS))
      );
      for (let j = 0; j < rows.length; j++) {
        // pgvector accepts the '[0.1,0.2,…]' string form over the REST API.
        // A 30-minute batch WILL hit a transient network blip — retry each write with
        // backoff instead of letting one hiccup waste the CPU time already spent.
        let lastErr = "";
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 3_000 * attempt));
          try {
            const { error: upErr } = await supabase
              .from(`${TABLE_PREFIX}legal_chunks`)
              .update({ embedding: JSON.stringify(vectors[j]) })
              .eq("id", rows[j].id);
            if (!upErr) { lastErr = ""; break; }
            lastErr = upErr.message;
          } catch (e) {
            lastErr = (e as Error).message;
          }
        }
        if (lastErr) throw new Error(`${rows[j].id}: ${lastErr} (after 4 attempts)`);
      }
      done += rows.length;
      console.log(`  …${done} embedded`);
    }
  }
  console.log(`EMBED DONE total=${done}`);
}

main().catch((e) => { console.error(`EMBED FAILED: ${e.message}`); process.exit(1); });
