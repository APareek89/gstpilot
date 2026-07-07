-- Migration 0005: OR semantics for keyword search (the Hinglish fix).
-- websearch_to_tsquery ANDs every term, so "footwear ka GST rate kya hai" required chunks
-- to contain "ka", "kya" and "hai" — no English legal text does, and one Hindi filler word
-- vetoed the entire keyword channel. Fix: normalize the query to lexemes and join with OR.
-- ts_rank_cd still ranks by rare-words-count-more, so "footwear" dominates and fillers that
-- match nothing simply contribute nothing instead of vetoing everything.

create or replace function gstpilot_query_to_or_tsquery(query_text text)
returns tsquery
language sql immutable as $$
  -- to_tsvector drops stopwords and stems ("rates"->"rate"); we OR whatever survives.
  select coalesce(
    to_tsquery('english', string_agg(lexeme, ' | ')),
    ''::tsquery
  )
  from unnest(tsvector_to_array(to_tsvector('english', query_text))) as lexeme;
$$;

create or replace function gstpilot_keyword_search(query_text text, match_count int default 20)
returns table (id text, score double precision)
language sql stable as $$
  select id, ts_rank_cd(fts, gstpilot_query_to_or_tsquery(query_text))::double precision as score
  from gstpilot_legal_chunks
  where status = 'in_force' and fts @@ gstpilot_query_to_or_tsquery(query_text)
  order by score desc
  limit match_count;
$$;

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
      order by ts_rank_cd(c.fts, gstpilot_query_to_or_tsquery(query_text)) desc
    ) as r
    from gstpilot_legal_chunks c
    where c.status = 'in_force' and c.fts @@ gstpilot_query_to_or_tsquery(query_text)
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
