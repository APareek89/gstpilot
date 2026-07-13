// The single entry point for retrieval. EVERY caller — Playground, the Phase 5 agents,
// eval runs — goes through hybridSearch(), which does the work AND records a trace row.
// Routing all retrieval through one function is what makes the admin Traces view a
// complete record: nothing can search the corpus without leaving a flight-recorder entry.

import { getEmbedder } from "./embed";
import { EMBEDDING } from "./config";
import { transformQuery, type Transformation } from "./transform";
import { getServiceClient, TABLE_PREFIX } from "../supabase";
import type { LfParent } from "../observability/langfuse";

// The retrieval constants, in one visible place (they're also written into every trace).
export const RETRIEVAL_CONFIG = {
  rrf_k: 60,          // fusion dampener: 1/(60+rank) — stops rank-1 dominating
  channel_top_n: 20,  // candidates taken from each channel before fusion
  final_top_n: 8,     // chunks handed to the agents
  model: EMBEDDING.modelId,
} as const;

export type ChannelHit = { id: string; score: number; rank: number };
export type FusedHit = {
  id: string; act: string; section: string | null; heading_path: string[];
  snippet: string; dense_rank: number | null; keyword_rank: number | null; rrf_score: number;
};
export type SearchResult = {
  transformation: Transformation;
  dense: ChannelHit[];
  keyword: ChannelHit[];
  fused: FusedHit[];
  timings_ms: { transform: number; embed: number; dense: number; keyword: number; fused: number };
  traceId: string | null;
};

export async function hybridSearch(query: string, source: string, parent?: LfParent, userHint?: string): Promise<SearchResult> {
  const supabase = getServiceClient();

  // Step 0: transform — deterministic id references + vocabulary rewrite. Both search
  // channels run on the REWRITTEN text; the original is preserved in the trace.
  // `userHint` (memory) only helps the rewrite resolve vague references — never the search itself.
  const tT = Date.now();
  const transformation = await transformQuery(query, parent, userHint);
  const tTransform = Date.now() - tT;

  // Dense channel embeds the hypothetical ANSWER when available (corpus text looks like
  // answers, not questions); keyword channel gets the rewrite + verbatim identifiers.
  const denseInput = transformation.hyde ?? transformation.rewritten;
  const keywordInput = [transformation.rewritten, ...transformation.exact_tokens].join(" ");

  // Doc-type prior: for statute-anchored questions, lift Act+Rules above the notification/circular
  // stream so a broad "how do I …" doesn't bury the anchor section (e.g. s54 for refunds). Rate/
  // exemption/late-fee questions keep 1.0 — there the notification IS the authority. Applied inside
  // the fusion SQL, BEFORE the top-8 cut, so a crowded-out section can actually climb into the set.
  const statuteBoost = transformation.doc_type_hint === "statute" ? 1.5 : 1.0;

  const t0 = Date.now();
  const [queryVector] = await getEmbedder().embed([denseInput]);
  const embedding = JSON.stringify(queryVector);
  const tEmbed = Date.now() - t0;

  // Long eval runs and agent sessions WILL hit transient network blips — retry the trio
  // of read-only RPCs a couple of times before declaring failure.
  const t1 = Date.now();
  let d: any, k: any, f: any;
  for (let attempt = 0; ; attempt++) {
    try {
      [d, k, f] = await Promise.all([
        supabase.rpc(`${TABLE_PREFIX}dense_search`, { query_embedding: embedding, match_count: RETRIEVAL_CONFIG.channel_top_n }),
        supabase.rpc(`${TABLE_PREFIX}keyword_search`, { query_text: keywordInput, match_count: RETRIEVAL_CONFIG.channel_top_n }),
        supabase.rpc(`${TABLE_PREFIX}hybrid_search`, { query_embedding: embedding, query_text: keywordInput, match_count: RETRIEVAL_CONFIG.final_top_n, statute_boost: statuteBoost }),
      ]);
      const firstError = d.error ?? k.error ?? f.error;
      if (firstError) throw new Error(firstError.message);
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
  const tSearch = Date.now() - t1;

  const withRank = (rows: { id: string; score: number }[]): ChannelHit[] =>
    rows.map((r, i) => ({ ...r, rank: i + 1 }));

  // Identity references beat similarity: chunks named directly in the question are fetched
  // by id and PINNED above the fused ranking (deduplicated). Ids that don't exist in the
  // database are silently dropped — the parser can guess, the database decides.
  let fused = (f.data ?? []) as FusedHit[];
  if (transformation.direct_ids.length) {
    const { data: direct } = await supabase
      .from(`${TABLE_PREFIX}legal_chunks`)
      .select("id, act, section, heading_path, text")
      .in("id", transformation.direct_ids)
      .eq("status", "in_force");
    const pinned: FusedHit[] = (direct ?? []).map((c) => ({
      id: c.id, act: c.act, section: c.section, heading_path: c.heading_path,
      snippet: c.text.slice(0, 200), dense_rank: null, keyword_rank: null,
      rrf_score: 1, // sentinel: pinned by identity, not fused arithmetic
    }));
    const pinnedIds = new Set(pinned.map((p) => p.id));
    fused = [...pinned, ...fused.filter((c) => !pinnedIds.has(c.id))].slice(0, RETRIEVAL_CONFIG.final_top_n + pinned.length);
  }

  const result: SearchResult = {
    transformation,
    dense: withRank(d.data ?? []),
    keyword: withRank(k.data ?? []),
    fused,
    // the three SQL calls run in parallel; we report the wall time once for all of them
    timings_ms: { transform: tTransform, embed: tEmbed, dense: tSearch, keyword: tSearch, fused: tSearch },
    traceId: null,
  };

  // Record the trace. Best-effort: a broken flight recorder must not break search itself.
  try {
    const { data: trace } = await supabase
      .from(`${TABLE_PREFIX}retrieval_traces`)
      .insert({
        source,
        query,
        config: { ...RETRIEVAL_CONFIG, statute_boost: statuteBoost, transformation },
        timings_ms: result.timings_ms,
        dense: result.dense,
        keyword: result.keyword,
        fused: result.fused.map((r) => ({
          id: r.id, rrf: r.rrf_score, dense_rank: r.dense_rank, keyword_rank: r.keyword_rank,
        })),
      })
      .select("id")
      .single();
    result.traceId = trace?.id ?? null;
  } catch {
    /* trace failure is logged nowhere better than here — search result still returns */
  }

  return result;
}
