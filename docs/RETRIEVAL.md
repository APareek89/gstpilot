# Phase 3 — Retrieval report

Generated: 2026-07-07

## Model decision

**Pinned: `Xenova/bge-m3` (local, Transformers.js, q8 quantized, 1024-dim, cls pooling + normalize).**
The planned two-model bake-off (Voyage API vs open bge-m3) was collapsed to the open model by
Anand's decision — no API spend for now. The provider interface in `lib/retrieval/embed.ts`
keeps an API model one class away if the golden-set eval ever demands it. The 25-question
golden set (Anand) will produce the recall@10 number that either blesses this choice or
reopens it.

## Architecture

query → embed (bge-m3, ~1–4s CPU) → in parallel:
dense top-20 (pgvector HNSW, cosine, in_force only) + keyword top-20 (rarity-weighted FTS,
in_force only) → reciprocal rank fusion 1/(60+rank) → top-8 → trace recorded.

Constants: rrf_k=60 · channel_top_n=20 · final_top_n=8 (lib/retrieval/config.ts + search.ts;
every trace stores the constants it ran with).

## Smoke results (full golden eval pending Anand's 25 questions)

| query | top-3 outcome |
|---|---|
| footwear ka GST rate kya hai | ✅ #1 = ntr-2018-024 (footwear S.No. 225 rate substitution) |
| e-commerce TCS rate section 52 | ✅ #2 = cir-2023-194 (TCS under s52); #1/#3 = rules amendments |
| invoice mila but payment nahi kiya, ITC milega? | ✅ #1 = cir-2024-241 (ITC availability) |
| restaurant order Zomato se — GST kaun bharega? | ✅ #1–2 = cir-2021-167 (restaurants via ECO) |
| what does section 16(4) say | ⚠ extension notifications outrank s16 itself — see limitations |

## Issues found & fixed during verification

1. **Hinglish veto**: `websearch_to_tsquery` ANDs all words — "kya"/"hai" matched nothing, so
   the whole keyword channel returned empty for Hinglish. Fixed with OR semantics over stemmed
   lexemes (migration 0005).
2. **No rarity weighting**: Postgres ts_rank has no corpus IDF — "footwear" (12 chunks) weighed
   the same as "rate" (hundreds), so generic rate circulars beat the actual footwear schedule
   row. Fixed with a lexeme document-frequency materialized view and idf-summed scoring,
   ts_rank_cd as tiebreaker (migration 0006). Ingest refreshes the stats after every load.
3. **Restricted search_path in matviews**: CREATE/REFRESH MATERIALIZED VIEW runs its query with
   a security-restricted search_path — names inside ts_stat() must be schema-qualified.

## Known limitations (deliberate, for later phases)

- **Current vs historical rates**: for "footwear rate", the 2018 substitution outranks the
  Sept-2025 schedule (ntr-2025-009) that actually governs today. Retrieval returns *relevant
  law*; picking the *currently operative* rate among amendment chains is the resolution
  agent's job (Phase 5), aided by effective_date and the amends[] graph.
- **Bare statutory queries** ("what does section 16(4) say") rank due-date-extension
  notifications above the section text itself. Phase 5's query transformation ("section 16(4)"
  → direct id lookup CGST-ACT/s16) is the designed fix — identity questions shouldn't go
  through similarity search at all.
- Query embedding costs ~1–4s on CPU per query — acceptable for beta; revisit (smaller model,
  GPU, or API) if latency matters at Phase 7 deploy.
