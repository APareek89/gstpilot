// Loader: chunks → the gstpilot_legal_chunks table. Upserts on the chunk id, which makes
// loading idempotent: re-running after a chunker fix simply overwrites each chunk with its
// new text — same id, same row — instead of piling up duplicates. This is one payoff of
// deterministic ids: CGST-ACT/s16 is CGST-ACT/s16 on every run, on every machine.

import { getServiceClient, TABLE_PREFIX } from "../supabase";
import type { Chunk } from "./chunk-acts";

const BATCH = 200; // one HTTP roundtrip per 200 rows instead of per row

export async function loadChunks(chunks: Chunk[]): Promise<void> {
  const supabase = getServiceClient();
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH).map((c) => ({
      ...c,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from(`${TABLE_PREFIX}legal_chunks`)
      .upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`upsert batch ${i / BATCH}: ${error.message}`);
  }
}
