-- Migration 0010: Phase 8c — WHO is asking, and what we REMEMBER about them.
-- Three shapes, one per memory need:
--   1. gstpilot_user_profile  — identity (email-as-id, no password) + the two onboarding facts.
--   2. threads.user_id/pending — working memory: which user owns a conversation, and the live
--      slot-gathering state ({tool, values, missing, assumed}) so a clarification RESUMES
--      instead of being re-derived from raw chat text every turn.
--   3. gstpilot_user_memory   — durable per-user facts. `kind` keeps the two durable types
--      distinct: 'behavioral' = observed facts about the user (sells footwear, files monthly);
--      'default' = procedural shortcuts the user CONFIRMED ("late fee" means monthly GSTR-3B).
-- Every memory row carries confidence (starts low, rises on confirmation), provenance (the
-- thread it was learned in), as_of (when the fact was true) and last_confirmed — because a
-- stale memory silently applied is a confident wrong answer.

create table if not exists gstpilot_user_profile (
  user_id    uuid primary key default gen_random_uuid(),
  email      text not null unique,
  sells      text,          -- onboarding Q1: "what do you sell?"
  state      text,          -- onboarding Q2: "which state are you in?"
  created_at timestamptz not null default now()
);

-- A thread now belongs to a user (nullable: pre-8c anonymous threads keep working), and
-- carries the persisted working-memory object for the in-flight clarification, if any.
alter table gstpilot_threads add column if not exists user_id uuid references gstpilot_user_profile(user_id);
alter table gstpilot_threads add column if not exists pending jsonb;

create table if not exists gstpilot_user_memory (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references gstpilot_user_profile(user_id) on delete cascade,
  fact           text not null,   -- closed-set key: sells | state | platforms | turnover_band |
                                  -- filing_frequency | observation:* | default:<tool>.<slot>
  value          text not null,
  confidence     real not null default 0.4,   -- model-extracted starts LOW; confirmation raises it
  provenance     uuid,                        -- thread_id where this was learned
  as_of          timestamptz not null default now(),
  last_confirmed timestamptz,
  kind           text not null default 'behavioral' check (kind in ('behavioral','default')),
  created_at     timestamptz not null default now(),
  unique (user_id, fact)                      -- one row per fact per user → upsert overwrites
);

create index if not exists gstpilot_user_memory_user_idx on gstpilot_user_memory (user_id);
create index if not exists gstpilot_threads_user_idx on gstpilot_threads (user_id);
