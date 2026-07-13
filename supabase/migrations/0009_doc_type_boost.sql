-- Migration 0009: intent-conditional doc-type boost in fusion.
-- Problem (measured on "how do i get gst refund"): broad procedural questions pull plain-language
-- circulars/notifications above the anchor statute — CGST-ACT/s54 sat below keyword-matched
-- circulars and never reached the agent. Fix: when the query transformer flags a question as
-- "statute-anchored", multiply the RRF score of Act/Rules chunks by a boost BEFORE the top-8 cut,
-- so the anchor section can climb into the set. Rate/exemption/late-fee questions pass boost = 1.0
-- — there a notification genuinely IS the authority, so nothing changes for them.

-- The signature changes (adds statute_boost), so drop the old 3-arg version to avoid an overload
-- that PostgREST could resolve ambiguously.
drop function if exists gstpilot_hybrid_search(vector(1024), text, int);

create or replace function gstpilot_hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count int default 8,
  statute_boost double precision default 1.0   -- > 1.0 lifts doc_type in ('act','rules')
)
returns table (
  id text, act text, section text, heading_path text[],
  snippet text, dense_rank int, keyword_rank int, rrf_score double precision
)
language sql stable as $$
  with dense as (
    select d.id, row_number() over (order by d.score desc) as r
    from gstpilot_dense_search(query_embedding, 20) d
  ),
  keyword as (
    select k.id, row_number() over (order by k.score desc) as r
    from gstpilot_keyword_search(query_text, 20) k
  ),
  fused as (
    select id,
           d.r as dense_rank,
           k.r as keyword_rank,
           coalesce(1.0 / (60 + d.r), 0) + coalesce(1.0 / (60 + k.r), 0) as rrf
    from dense d full outer join keyword k using (id)
  )
  select c.id, c.act, c.section, c.heading_path,
         left(c.text, 200) as snippet,
         f.dense_rank::int, f.keyword_rank::int,
         -- statute rows earn the boost; stream rows are unchanged. Order by the BOOSTED score so
         -- the boost decides the top-8 membership, not just the display value.
         (f.rrf * case when c.doc_type in ('act', 'rules') then statute_boost else 1.0 end)::double precision as rrf_score
  from fused f
  join gstpilot_legal_chunks c on c.id = f.id
  order by rrf_score desc
  limit match_count;
$$;
