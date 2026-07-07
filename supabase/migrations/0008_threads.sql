-- Migration 0008: conversation threads + messages + feedback.
-- The UI shows history from these rows; the MODEL only sees what /api/ask explicitly
-- re-sends — two different things (see Phase 7 teaching). summary/summary_upto implement
-- compaction: turns older than the last ~20 get folded into one standing summary.

create table if not exists gstpilot_threads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  title        text,
  summary      text,                 -- compacted memory of turns 1..summary_upto
  summary_upto int not null default 0
);

create table if not exists gstpilot_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references gstpilot_threads(id),
  created_at      timestamptz not null default now(),
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  tier            text,
  citations       jsonb not null default '[]',   -- [{id, heading, snippet}]
  trace_id        text,
  feedback        text check (feedback in ('up','down')),
  feedback_reason text check (feedback_reason in ('wrong','unclear','didnt_answer'))
);

create index if not exists gstpilot_messages_thread_idx on gstpilot_messages (thread_id, created_at);
