# GSTPilot — Session Handoff

> For any new Claude session: read this FULLY, then CLAUDE.md (Teaching Contract — binding),
> then docs/PRODUCT_BRIEF.md. Update this file at every phase boundary and whenever the
> session context is nearly exhausted.

## What this project is
Citation-grounded GST Q&A agent for Indian e-commerce sellers. Every claim cites a chunk;
abstains when sources don't cover; T3 (notices/disputes) escalates to a CA. Anand is a
product leader learning AI engineering — teaching comes WITH building (see CLAUDE.md rules:
explain before build, plain language, checkpoints, honest tradeoffs, ⚠️ HUMAN TASK = Anand's,
LEARNING_LOG.md updated every session).

## Phase status (roadmap in CLAUDE.md)
- ✅ P0 skeleton+infra · P1 corpus (410 docs, manifest, sha256) · P2 chunks (1064 in
  gstpilot_legal_chunks, admin Inspector) · P3 hybrid retrieval (bge-m3 local + IDF keyword
  + RRF, Playground, Traces)
- ✅ P4 evals: 60-case golden set (evals/golden.json, schema evals/golden-schema.ts, guide
  docs/LABELING_GUIDE.md), harness evals/run.ts (per-metric), runs in DB + /admin/evals,
  Langfuse dataset 'gstpilot-golden' + scored runs. Query transformation (haiku rewrite +
  deterministic section/rule pinning) lifted recall@10 0.60 → 0.775.
- ▶ P5 answer path BUILT: lib/agents/answer.ts (transform+HyDE → hybrid → pinned
  claude-sonnet-4-6 + calculator tools → citation gate → named-errors regen → forced
  abstention). lib/gates/verify-citations.ts · lib/calculators/ · Langfuse-traced.
  Full-path eval runs (pnpm eval:answer, ~25 min): v1 false_answer=0/20 ✓ poison=0 ✓,
  fact_match 0.111 — diagnosis (/tmp/fact-diagnosis.json): retrieval fine (10/11 had the
  relevant chunk), failures were GATE-forced abstentions (flaky subsection-style tags
  [s17(5)] invisible to the tag regex at near-temp-0 variance) + missing specifics.
  v2 evaled: false_answer=0 ✓ poison=0 ✓, fact_match 0.056 — BUT golden.json grew 9→18
  fact cases mid-experiment, so v1/v2 rates aren't comparable. v2 diagnosis
  (/tmp/gstpilot-diag2.log): 3 pass · 3 retrieval misses (g026/g027/g044 — abstention
  correct there) · ~9 GATE-forced abstentions (root cause: bullet lists tagged per-block,
  gate demanded per-sentence) · 3 answered-but-incomplete.
  FIXES APPLIED, NOT YET RE-EVALED: per-bullet tag instruction + bullet block-inheritance
  in verify-citations.ts (typecheck clean). NEXT SESSION FIRST MOVE: pnpm eval:answer
  (~25 min, detached: nohup pnpm eval:answer > /tmp/log 2>&1 &), expect fact_match jump;
  then: 3 answered-but-incomplete cases, retrieval misses (schedule-row summaries lever),
  T3 tier classifier (consult-a-CA path — brief requires T3 recall 1.0, not yet built),
  Anand's verification sitting still pending. Done-when for P5: fact ≥ 0.8,
  false-answer = 0, failure walkthrough in LEARNING_LOG (session 6 entry has it).
  Note: golden.json was hand-edited (facts added to g026+); chunk-notifications.ts regex
  compat edit — both intentional, keep.
- P6 RESULTS: T3 recall 1.0 ✓ (tier accuracy 0.867) · trajectory rules 1.000 ✓ ·
  T3 pass^5 = 1.000 ✓ · **T2 pass^5 = 0.500 — FAILS the ≥0.9 bar**. Per-case
  (docs/CONSISTENCY.json): g003/g004/g006/g008/g017 solid 11111; g035/g041/g042 = 00000
  (DETERMINISTIC failures — the Phase 5 fact-completeness/gate leftovers, not flakiness);
  g016 = 10111 and g040 = 00100 (TRUE flakiness — the pass^5 finding; likely borderline
  gate judgments; candidates for the move-decision-from-model-into-code rule). NEXT
  SESSION: re-run pnpm eval:answer (bullet fixes still uneval'd), fix the three 00000
  cases, then chase g016/g040 flakiness into code. Gate table in docs/GATES.md.
- ✅ P7 (local): chat UI at / (SSE streaming statuses → answer; citations as expandable
  cards with quoted snippets + /admin/chunks links; tier badge; CA button on T2/T3;
  disclaimer; 👍/👎 + reason → message row + Langfuse score). app/api/ask (SSE, threads in
  gstpilot_threads/messages, last-20-verbatim + haiku compaction past 20 turns),
  app/api/feedback. Pipeline: opts {context, onStep}, returns traceId. render.yaml written
  (needs STANDARD 2GB instance — bge-m3 in-process; cold start ~1min model load).
  VERIFIED in browser: T3 seizure → escalated card w/ CA handoff; T1 TCS → cited streamed
  answer (s52). PENDING: Render deploy = Anand (repo push + blueprint + env vars from
  .env); Anand's 3-day/30-question dogfood; token-cost-per-reply in Langfuse still coarse
  (trace-level, not per-generation usage).
- ⚠️ PENDING ANAND: G2 retrieval-floor threshold decision — current placeholder 0.45 in
  lib/agents/pipeline.ts (G2_MIN_RELEVANCE). Distributions (from golden traces): answerable
  best-cosine 0.478–0.85, unanswerable up to 0.787 — heavy overlap, so G2 only catches
  nothing-even-close retrieval. Claude recommends 0.45 (near-zero wrongful refusals);
  0.60 would pre-block ~half of unanswerable but wrongfully refuse ~6 answerable.
  Anand picks the number; record decision + rationale here and in docs/GATES.md.
  ALSO PENDING ANAND: golden-set verification sitting (40 answerable cases vs source PDFs).
- Open items: 9 eval misses (biggest lever: per-row summaries for rate-schedule chunks —
  ingestion change); Anand's ⚠️ verification sitting (40 answerable cases vs source PDFs →
  status "verified"); 6 needs_ocr docs unprocessed; bge-m3 revision not pinned to commit;
  3 v2 regressions to study (g011, g014, g027).

## How things run
- Dir: /Users/anandpareek/Documents/gstpilot · pnpm (NOT npm) · Next.js 15 App Router.
- ALWAYS cd into the project dir first — the session shell resets cwd between commands.
- Scripts: pnpm migrate · download-stream · ingest [--enrich] · embed · eval ·
  golden:validate · langfuse:sync · check-setup. Extraction: scripts/extract/.venv/bin/python
  scripts/extract/extract.py (SSL_CERT_FILE=corp bundle for uploads).
- Dev server via Claude preview tool config "gstpilot-dev" (port 3210), registered in
  /Users/anandpareek/Documents/.claude/launch.json. Admin: /admin/{chunks,playground,traces,evals}.
- Long jobs: shell caps at 10 min — use `nohup pnpm X > /tmp/log 2>&1 &` + Monitor on the log.

## Environment gotchas (each cost us a debugging session)
- Corp MITM proxy: Node needs NODE_EXTRA_CA_CERTS="/Users/anandpareek/Documents/SEO content
  Skill/scripts/system-ca-bundle.pem" (baked into pnpm scripts); Python needs SSL_CERT_FILE.
- taxinformation.cbic.gov.in sends an incomplete TLS chain → scripts/certs/entrust-intermediate.pem
  (never disable TLS). Its JSON API needs a guest token: POST /api/authenticate-token, empty
  body. PDFs = base64 inside JSON at /content/pdf/<path>.
- Supabase: SHARED staging DB — every object is prefixed gstpilot_ (TABLE_PREFIX in
  lib/supabase.ts). New sb_secret_ key: REST ok, but Storage wants it in the `apikey` header
  (not Bearer). Matview internals need schema-qualified names (restricted search_path).
- ONNX embedding OOMs on big batches: batch 4, 6000-char truncation (scripts/embed-chunks.ts).
- Long-running Supabase writes need retry loops — transient 'fetch failed' is routine.

## Non-negotiables (from the brief — enforce in every phase)
Every legal claim cites a retrieved chunk (deterministic gate) · false-answer ≈ 0 on
unanswerable slice · T3 recall = 1.0 · rates/dates/thresholds from documents or code, never
model memory · law text never hand-edited (audit trail) · identity fields never filled by a
model (three-tier metadata rule) · per-metric eval reporting, never blended · report
regressions alongside wins.

## Key architecture facts
- Corpus: corpus/base (3 consolidated PDFs, manual, manifest'd) + corpus/stream (407 notif/
  circulars via API) + corpus/manifest.json (sha256 audit trail). Extracted text in
  corpus-text/ + Supabase Storage 'corpus-text'.
- Chunks: structure-aware (sections/rules split, provisos glued), deterministic ids
  (CGST-ACT/s16), status in_force/superseded (--v2 suffix for history), haiku enrichment
  (closed label set) for provision_type/cross_refs only.
- Retrieval: lib/retrieval/search.ts hybridSearch() is the ONLY entry point (records traces).
  transform.ts (haiku rewrite + reference pinning) → bge-m3 embed (pinned Xenova/bge-m3,
  1024-dim) → SQL functions (migrations 0003–0006): dense + IDF-weighted keyword + RRF,
  in_force filtered BEFORE search.
- Evals: runEval takes any SystemUnderTest ({retrieve?, answer?, classifyTier?}) — the same
  harness grades every future layer.
