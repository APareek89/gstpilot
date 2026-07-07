-- Migration 0007: eval runs — golden-set results as first-class data.
-- One row per eval execution: the per-metric report plus per-case outcomes, so the admin
-- Evals view can show "which exact questions failed, at what rank" for any historical run
-- and compare runs over time. Same philosophy as retrieval traces: results are facts,
-- recorded once, never edited.

create table if not exists gstpilot_eval_runs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sut        text not null,          -- system under test, e.g. 'hybrid-retrieval-v1'
  cases      int not null,
  report     jsonb not null,         -- the EvalReport (per-metric numbers)
  per_case   jsonb not null          -- [{id, question, tier, unanswerable, hit, first_rank}]
);

create index if not exists gstpilot_eval_runs_created_idx on gstpilot_eval_runs (created_at desc);
