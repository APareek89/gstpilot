-- Migration 0002: the legal_chunks table — GSTPilot's single source of retrievable law.
-- One row = one complete legal thought (a section with its provisos, one notification, …).
-- Prefixed gstpilot_ because we share a staging database with another project.
-- The embedding column stays empty until Phase 3; the fts column works from day one.

create table if not exists gstpilot_legal_chunks (
  id             text primary key,          -- deterministic, e.g. 'CGST-ACT/s16'
  act            text not null,             -- CGST-ACT | IGST-ACT | CGST-RULES | NOTIF-CT | NOTIF-CTR | CIRCULAR
  doc_type       text not null,             -- act | rules | notification-* | circular
  section        text,                      -- '16', '36', null for notifications
  heading_path   text[] not null default '{}',  -- ['CHAPTER V — INPUT TAX CREDIT']
  provision_type text,                      -- filled by the model enricher (judgment label)
  cross_refs     text[] not null default '{}',  -- ['section 49', 'rule 36'] (model, judgment)
  effective_date date,
  status         text not null default 'in_force'
                 check (status in ('in_force', 'amended', 'superseded')),
  amends         text[] not null default '{}',
  source_doc_id  text not null,             -- manifest doc_id -> PDF sha256 -> gov URL (audit chain)
  text           text not null,
  embedding      vector(1024),              -- Phase 3 fills this
  -- Full-text-search column: Postgres pre-chews every chunk's text into a searchable index
  -- of word stems ("furnishing" -> "furnish"), stored and kept in sync automatically because
  -- it is GENERATED from the text column. Phase 3's hybrid retrieval runs exact-word queries
  -- against this (finding "5407" or "GSTR-9C" that vector search would blur), while the
  -- embedding column handles meaning. One table, both kinds of search.
  fts            tsvector generated always as (to_tsvector('english', text)) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists gstpilot_legal_chunks_fts_idx  on gstpilot_legal_chunks using gin (fts);
create index if not exists gstpilot_legal_chunks_act_idx  on gstpilot_legal_chunks (act, section);
create index if not exists gstpilot_legal_chunks_type_idx on gstpilot_legal_chunks (doc_type, status);
