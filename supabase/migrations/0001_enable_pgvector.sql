-- Migration 0001: enable pgvector.
-- pgvector is a Postgres extension that adds a `vector` column type and nearest-neighbor
-- search operators. It lets the same ordinary database that stores our law-chunk text also
-- store each chunk's embedding (a list of numbers capturing meaning) and answer
-- "which chunks are closest in meaning to this question?" — no separate vector database.
-- Without it, semantic retrieval (Phase 4) is impossible.
--
-- NOTE: we currently share a staging database with another project, so EVERYTHING GSTPilot
-- creates is prefixed `gstpilot_` (tables, functions). Extensions are database-wide and
-- additive — enabling pgvector cannot break the other project.

create extension if not exists vector;

-- Tiny helper so our setup-check script can ask "is pgvector on?" through Supabase's
-- auto-generated API (which can call functions but not run raw SQL from outside).
create or replace function gstpilot_pgvector_enabled()
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_extension where extname = 'vector');
$$;
