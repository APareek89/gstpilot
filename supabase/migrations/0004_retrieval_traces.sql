-- Migration 0004: retrieval traces — the flight recorder for search.
-- One row per retrieval, whoever triggered it (Playground now, agents in Phase 5).
-- Stores the full behind-the-scenes picture: what each channel returned with scores,
-- the fusion arithmetic, the constants in force, and timings. Read-only in admin;
-- rows are facts about what happened and are never edited.

create table if not exists gstpilot_retrieval_traces (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null,            -- 'playground' | 'agent' | 'eval'
  query       text not null,
  config      jsonb not null,           -- constants used: rrf_k, per-channel top-n, model id
  timings_ms  jsonb not null,           -- embed / dense / keyword / fusion durations
  dense       jsonb not null,           -- [{id, score, rank}] top-20
  keyword     jsonb not null,           -- [{id, score, rank}] top-20
  fused       jsonb not null            -- [{id, rrf, dense_rank, keyword_rank}] top-8
);

create index if not exists gstpilot_retrieval_traces_created_idx
  on gstpilot_retrieval_traces (created_at desc);
