-- Migration 0003: search functions + vector index.
-- Three functions: dense (meaning) search, keyword (exact-word) search, and hybrid fusion.
-- All three filter status='in_force' BEFORE searching — top-N is always computed over the
-- universe of valid law, never polluted by superseded amendment history.

-- HNSW index: pgvector's graph index for fast approximate nearest-neighbor lookups.
-- At 1k chunks a full scan would also work; the index keeps us honest for growth.
create index if not exists gstpilot_legal_chunks_embedding_idx
  on gstpilot_legal_chunks using hnsw (embedding vector_cosine_ops);

-- Channel 1: dense / meaning search. `<=>` is pgvector's cosine-distance operator
-- (0 = identical direction), so similarity = 1 - distance.
create or replace function gstpilot_dense_search(query_embedding vector(1024), match_count int default 20)
returns table (id text, score double precision)
language sql stable as $$
  select id, 1 - (embedding <=> query_embedding) as score
  from gstpilot_legal_chunks
  where status = 'in_force' and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Channel 2: keyword search over the generated fts column. websearch_to_tsquery parses
-- the raw question ("footwear ka GST rate kya hai") into search terms; ts_rank_cd scores
-- with the rare-words-count-more / repetition-saturates / long-docs-discounted logic.
create or replace function gstpilot_keyword_search(query_text text, match_count int default 20)
returns table (id text, score double precision)
language sql stable as $$
  select id, ts_rank_cd(fts, websearch_to_tsquery('english', query_text))::double precision as score
  from gstpilot_legal_chunks
  where status = 'in_force' and fts @@ websearch_to_tsquery('english', query_text)
  order by score desc
  limit match_count;
$$;

-- The hybrid: filter -> dense top-20 + keyword top-20 -> reciprocal rank fusion -> top-8.
-- Scores from the two channels are different units, so fusion uses RANKS only:
-- each chunk earns 1/(60 + rank) per channel; consistent-in-both beats spiky-in-one.
create or replace function gstpilot_hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count int default 8
)
returns table (
  id text, act text, section text, heading_path text[],
  snippet text, dense_rank int, keyword_rank int, rrf_score double precision
)
language sql stable as $$
  with dense as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as r
    from gstpilot_legal_chunks c
    where c.status = 'in_force' and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 20
  ),
  keyword as (
    select c.id, row_number() over (
      order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
    ) as r
    from gstpilot_legal_chunks c
    where c.status = 'in_force' and c.fts @@ websearch_to_tsquery('english', query_text)
    limit 20
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
         f.dense_rank::int, f.keyword_rank::int, f.rrf::double precision as rrf_score
  from fused f
  join gstpilot_legal_chunks c on c.id = f.id
  order by f.rrf desc
  limit match_count;
$$;
