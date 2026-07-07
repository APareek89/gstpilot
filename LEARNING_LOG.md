# GSTPilot — Learning Log

## Session 6 — 2026-07-07 (Phase 5: first full question→answer path)

**What we built:** lib/agents/answer.ts (transform+HyDE → hybrid retrieval → pinned claude-sonnet-4-6 with calculator tools → citation gate → named-errors regeneration → forced abstention), lib/gates/verify-citations.ts, lib/calculators/ (late fee + s50 interest as pure functions returning their own legal-basis citations), Langfuse tracing on every answer, full-path eval (pnpm eval:answer).

**Results:** false-answer rate 0/20 ✓ (the strictest bar, met on first run) · poison 0 ✓ · fact-match still failing — NOT because of retrieval (relevant chunk present in 15/18 fact cases) but because the citation gate kept force-abstaining correct answers.

**FAILURE WALKTHROUGH (the contract-required study):** stage attribution across 18 fact cases: 3 pass · 3 retrieval misses (g026, g027, g044 — abstention is CORRECT behavior for ungrounded questions; fix belongs in retrieval) · ~9 gate-forced abstentions · 3 answered-but-incomplete (rule stated, number omitted). The gate failures were, in sequence: calculator citations not trusted → markdown flagged as claims → Hinglish navigation sentences → subsection tags [s17(5)] invisible to the regex → finally BULLET LISTS: model tags a block once, gate demanded per-sentence tags (g031: six substantively-correct s107 bullets → abstention). Every failure = producer/checker format disagreement where correct behavior got punished; never model dishonesty.

**3 key concepts:** (1) permission-to-not-know works — 20/20 unanswerable abstained, and the gate makes honesty cheaper than bluffing; (2) grade the grader first — fact_match=0 was notation blindness (statute words vs digits), and mid-experiment golden edits changed denominators (9→18 fact cases), so v1/v2 rates aren't comparable; (3) align the producer-checker contract from BOTH sides — instruct checkable output AND make checks tolerant of legitimate variation.

**Open at session end:** bullet-inheritance gate fix + per-bullet tag instruction applied but NOT yet re-evaled — next session: pnpm eval:answer, expect fact-match to jump; then completeness gaps and the 3 retrieval misses (schedule-row summaries still the known lever). T3 handling (consult-a-CA behavior) still not implemented — tier classifier is the next agent.

**Most likely to break later:** the gate's claim-marker + bullet-inheritance heuristics are fitted to sonnet's current output style; a model upgrade changes the style and either floods false failures (visible: abstention rate spikes) or lets untagged claims through (invisible — watch the eval, not the vibes).


## Session 5 — 2026-07-07 (Phase 4: golden set, eval harness, query transformation)

**What we built:** 60-case golden set (40 answerable / 20 unanswerable, 7 T3) in a typed schema with a labeling guide; second-marker verification of Codex's cases (ids → in-force → content → facts literally present); eval harness (per-metric, never blended) with runs persisted to DB and browsable at /admin/evals (miss rows deep-link to Playground); query transformation (deterministic section/rule reference pinning + haiku vocabulary rewrite). Baseline recall@10 0.60 → 0.775 after transformation; #1-rank hits 4 → 12.

**3 key concepts:**
1. **Evals before agents** — the baseline's 16 misses fell into 3 nameable patterns (statute loses to stream; schedule-row dilution; vocabulary gap), which told us exactly what to build next. Without the stick, we'd have "improved" blind.
2. **The statute doesn't speak user language** — s52 never contains "TCS"; no channel can match words absent from the corpus. Rewrite queries into statutory vocabulary; resolve identity references (section 52 → CGST-ACT/s52) deterministically, never by similarity.
3. **Report regressions, not just wins** — v2 fixed 10 misses but broke 3 previously-passing cases (g011, g014, g027). Net +7, honestly stated. A harness that only celebrates hides the cost of every change.

**Most likely to break later:** the rewrite step adds a haiku call to EVERY query (latency + cost + a new failure mode in the hot path). It fails soft (falls back to the original query), but if answers ever look Phase-3-dumb, check whether rewrites are silently failing.


## Session 4 — 2026-07-07 (Phase 3: hybrid retrieval + observability)

**What we built:** local bge-m3 embeddings for all 1064 chunks (pinned in config; provider interface keeps APIs swappable), context-line prepending, hybrid search as readable SQL (dense top-20 + keyword top-20 → RRF → top-8, in_force filtered BEFORE search), the Retrieval Playground (3-column debug view), and Retrieval Traces — a flight recorder: every retrieval by any caller is logged with channels, RRF arithmetic, constants and timings, live view at /admin/traces.

**3 key concepts:**
1. **Hybrid = complementary failure modes** — proven live: for "late fee GSTR-9C delay", dense found s47 (Levy of late fee) but completely missed circular 246 (keyword #1), because "GSTR-9C" is an exact token embeddings blur.
2. **AND vs OR query semantics** — websearch_to_tsquery requires every word; one Hindi filler ("kya") vetoed the entire keyword channel for Hinglish queries. OR over stemmed lexemes fixed it.
3. **ts_rank has no IDF** — Postgres FTS doesn't know "footwear" is rare and "rate" is common; we added corpus rarity weighting (ln(N/df) via a ts_stat materialized view), which is the actual heart of BM25.

**Gotchas:** ONNX runtime OOMs on batch-16 long texts (native memory — Node heap flags don't help; batch 4 + 6k-char truncation); CREATE/REFRESH MATERIALIZED VIEW runs with a restricted search_path (schema-qualify names inside ts_stat); 30-minute batch jobs need per-write retries (one transient fetch failure killed a run at 124/1064).

**Most likely to break later:** the model pin — bge-m3 revision "main" isn't a commit hash yet; a silent upstream weight update would degrade every similarity score with no error anywhere. Pin the exact revision after the golden-set eval, and never mix vectors across model versions.


## Session 3 — 2026-07-07 (Phase 2: PDFs → retrievable, labeled chunks)

**What we built:** the whole offline ingestion pipeline. `extract.py` (410 PDFs → cleaned per-page JSON, locally + Supabase Storage `corpus-text/`), structure-aware chunkers (`chunk-acts.ts` splits at section/rule boundaries with provisos glued; `chunk-notifications.ts` one chunk per notification with derived table-change summaries), migration 0002 (`gstpilot_legal_chunks` with generated full-text-search column + vector(1024) placeholder), `enrich.ts` (claude-haiku, temp 0, closed label set → provision_type + cross_refs), `load.ts` (upsert on deterministic ids), and the read-only Chunk Inspector at /admin/chunks. 1064 chunks loaded; base coverage audited to 100% (CGST 182 s + IGST 26 s + Rules 192 r in force, no gaps).

**3 key concepts:**
1. **Split at legal boundaries, not word counts** — a mid-provision split separates a rule from its proviso, and retrieval then serves confident, cited, *incomplete* law. Chunk = complete legal thought.
2. **Three-tier metadata** — config (known facts) / regex (structure the drafters wrote) / model (judgment labels only, closed set). The model never fills identity fields: deterministic sources fail loudly, models fail plausibly.
3. **Reconcile counts at every stage** — "179 CGST sections" looked fine until an audit against the expected 174-numbered list exposed both duplicates (omitted s42/43 kept as history → status superseded) and 40+ missed rules (five different heading formats in ONE official PDF, incl. `17.Assignment` and `25[Physical…` typos).

**Gotcha:** Supabase Storage rejects the new `sb_secret_` key as a Bearer JWT — use the `apikey` header; and its duplicate-bucket error says 409 in the body but arrives as HTTP 400.

**Most likely to break later:** the boundary regexes are fitted to the three current base PDFs; a re-downloaded consolidation with different formatting will silently mis-chunk — the per-act completeness audit (missing-number check) must run in CI as the tripwire.


## Session 2 — 2026-07-07 (Phase 1: get the law onto disk)

**What we built:** the STREAM layer. `scripts/download-stream.ts` pulls 407 documents (162 Central Tax notifications from the Rules base date, all 211 Central Tax (Rate) notifications since 2017, 34 approved e-commerce circulars) from taxinformation.cbic.gov.in's JSON API into `corpus/stream/`, plus a corpus-wide `corpus/manifest.json` (410 docs incl. base) with sha256, needs_ocr, and amends[] per doc. Validation: 0 failures, no >12-month gaps, 6 docs flagged needs_ocr, amends[] parsed for ~half.

**3 key concepts:**
1. **Guest-token APIs** — the "browser-only" portal actually authenticates every anonymous visitor via `POST /api/authenticate-token` (empty body → JWT). SPAs almost always have a cleaner data path than their HTML; read the network calls, not the page.
2. **Idempotency** — a job you can run any number of times with the same end state. Achieved here by checksum-skip: re-run verified `downloaded=0 skipped=407` in seconds, so crashes/timeouts just resume.
3. **Identity needs a stable unique key** — deriving doc_id from number+title collided on four distinct "Corrigendum" docs and silently lost files; switching the fallback to hash-of-file-path fixed it. Checksums + a dedupe audit caught what eyeballs missed.

**Gotchas hit:** gov server sends an incomplete TLS chain (missing Entrust intermediate) — Node correctly refuses where curl/browsers auto-fetch; fixed by committing the intermediate cert (`scripts/certs/`) and pointing NODE_EXTRA_CA_CERTS at it — never NODE_TLS_REJECT_UNAUTHORIZED=0. PDFs arrive as base64-in-JSON, so verify `%PDF` magic bytes after decode.

**Most likely to break later:** the undocumented portal API (endpoints/token flow can change without notice) — the manifest + idempotent re-run make re-syncing cheap, and the frozen-at-2022 HTML tables on cbic-gst.gov.in remain a partial fallback.


## Session 1 — 2026-07-07

**What we built:** Project skeleton (Next.js 15 + TypeScript + pnpm, folder structure for ingestion/retrieval/agents/gates/evals), server-side Supabase client, first migration enabling pgvector, `scripts/check-setup.ts` (verifies Supabase, pgvector, Anthropic key, Langfuse keys), and the isolated Python 3.12 extraction environment spec under `scripts/extract/`.

**3 key concepts:**
1. **pgvector** — a Postgres extension that adds a `vector` column type plus nearest-neighbor search, so one ordinary database can store law-chunk text AND its embedding side by side; no separate vector database needed.
2. **Service-role vs anon key** — Supabase issues two API keys: the anon key is safe for browsers (row-level security applies), the service-role key bypasses all security and must live only on the server (`.env`, never shipped to the client).
3. **Online vs offline paths** — user questions never touch a PDF; PDFs are processed offline into the database, and the online path only queries what's already there. This split is what makes answers fast and auditable.

**Most likely to break later:** the check-setup script's pgvector check depends on the migration having been applied — a fresh Supabase project will pass "reachable" but fail "pgvector" until we run `supabase/migrations/0001_enable_pgvector.sql`, and it will look like a bug when it's actually a missing step.

**Session 1 addendum (same day):** Phase 0 closed green on a shared staging Supabase DB (everything we create is prefixed `gstpilot_`; `pnpm migrate` runner added). Base corpus in `corpus/base/` with a sha256 manifest: Anand manually downloaded the consolidated CGST Act (as on 28-09-2022, 124 pp) and IGST Act (as on 27-03-2020, 21 pp) from taxinformation.cbic.gov.in — that portal blocks headless browsers, so the downloader marks these `manual:true` and never overwrites them; CGST Rules Part A (as on 01-06-2021, 167 pp) still auto-downloads from CBIC's static files.

**Extra concept:** government PDF portals rot — official "current" pages 404 while old static files live forever; a corpus pipeline must record source + as-on date + checksum for every file (our manifest.json), because "the law" is really "a specific version of a document".

**Second thing likely to break:** the corpus bases are consolidated only up to 28-09-2022 (CGST) and 27-03-2020 (IGST) — until Phase 1 layers the later amendment acts (incl. IGST Amendment Act 2023) and the notification stream on top, any answer touching newer changes would be wrong. Nothing may ship answers until that layering exists.

## Session 6 addendum — Phase 6 (supervised team with gates)
Built: intake+G1(zod, default-up-to-T3) · T3→CA handoff · pipeline with trajectory logging · G2 floor (threshold pending Anand) · G3 recompute-in-code · reply+G5 (model verifies, never generates facts) · trajectory rules · consistency runner. Results: T3 recall 1.0, T3 pass^5 1.0, trajectory rules 1.0, tier accuracy 0.867 — but T2 pass^5 0.5: three cases fail 5/5 (deterministic Phase-5 leftovers), two flicker (10111, 00100 — real inconsistency, move those decisions into code next). Key concept: pass^5 vs average — 4-of-5 runs averages 0.8 but pass^5 = 0; users experience the unluckiest run. Key finding: G2 distributions overlap heavily (cosine = topical closeness, not answerability) — the false-answer defense is behavioral (abstention+gates), not retrieval-score-based.
