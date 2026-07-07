-- Migration 0006: rarity-aware keyword search (poor-man's BM25).
-- Postgres ts_rank knows term frequency INSIDE a document but nothing about rarity ACROSS
-- the corpus — "footwear" (in 12 chunks) and "rate" (in hundreds) weigh the same, so generic
-- rate circulars outranked the actual footwear schedule row. Fix: precompute each lexeme's
-- document frequency, and score a chunk by the summed rarity (idf = ln(N/df)) of the query
-- lexemes it contains, with ts_rank_cd as a small tiebreaker for proximity/repetition.

-- Lexeme -> number of in-force chunks containing it. Refreshed by ingest after every load.
create materialized view if not exists gstpilot_lexeme_stats as
  select word, ndoc
  from ts_stat('select fts from public.gstpilot_legal_chunks where status = ''in_force''');

create unique index if not exists gstpilot_lexeme_stats_word_idx on gstpilot_lexeme_stats (word);

-- Callable from the ingest script after every corpus load (PostgREST can call functions,
-- not run REFRESH directly). SECURITY DEFINER so the API role may refresh the view.
create or replace function gstpilot_refresh_lexeme_stats()
returns void
language sql security definer as $$
  refresh materialized view public.gstpilot_lexeme_stats;
$$;

create or replace function gstpilot_keyword_search(query_text text, match_count int default 20)
returns table (id text, score double precision)
language sql stable as $$
  with corpus as (
    select count(*)::float as n from gstpilot_legal_chunks where status = 'in_force'
  ),
  -- the query, reduced to stemmed lexemes ("footwear ka GST rate kya hai" -> footwear,ka,gst,rate,kya,hai)
  lex as (
    select distinct lexeme
    from unnest(tsvector_to_array(to_tsvector('english', query_text))) as lexeme
  ),
  -- rarity weight per lexeme: ln(total docs / docs containing it); unknown lexemes match nothing
  weights as (
    select l.lexeme, ln(greatest((select n from corpus) / s.ndoc, 1.0)) as idf
    from lex l
    join gstpilot_lexeme_stats s on s.word = l.lexeme
  ),
  -- candidates: any chunk matching at least one query lexeme (OR semantics — a Hindi filler
  -- word that matches nothing contributes nothing instead of vetoing the channel)
  candidates as (
    select c.id, c.fts
    from gstpilot_legal_chunks c
    where c.status = 'in_force'
      and c.fts @@ gstpilot_query_to_or_tsquery(query_text)
  )
  select cand.id,
         -- main term: summed rarity of the query lexemes this chunk contains;
         -- tiebreak: ts_rank_cd for proximity/frequency among equals
         ( select coalesce(sum(w.idf), 0)
           from weights w
           where w.lexeme = any (tsvector_to_array(cand.fts)) )
         + 0.1 * ts_rank_cd(cand.fts, gstpilot_query_to_or_tsquery(query_text))
         as score
  from candidates cand
  order by score desc
  limit match_count;
$$;

-- Hybrid now COMPOSES the two channel functions, so scoring logic lives in exactly one place.
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
         f.dense_rank::int, f.keyword_rank::int, f.rrf::double precision as rrf_score
  from fused f
  join gstpilot_legal_chunks c on c.id = f.id
  order by f.rrf desc
  limit match_count;
$$;
