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
- ▶ **SESSION 8c (2026-07-10) — Phase 8c: agent memory + lightweight sign-up (ask → CONFIRM).** BUILT &
  VERIFIED by running the app across TWO sessions (screenshots in session log; no evals, by request).
  THREE memory types, kept distinct; ONE rule enforced end-to-end: memory sets DEFAULTS/CONTEXT — any
  remembered fact that changes a rate/number/eligibility is SHOWN + CONFIRMED before it's applied.
  - **Identity:** email-as-id sign-up (`app/api/user`, no password — ⚠️ magic-link+consent = ANAND),
    2-question onboarding (sells, state) in `app/page.tsx`, user in localStorage; `user_id` on threads;
    Langfuse trace now carries `userId`. Migration `0010_users_and_memory.sql` (user_profile ·
    threads.user_id/pending · user_memory).
  - **WORKING memory:** the Phase-8b SlotFill, PERSISTED — `threads.pending` = one jsonb
    {tool, values, assumed, missing, rejected, asked_at} (`lib/memory/working.ts`, 6h TTL). Calc lane
    RESUMES from it (merge: this turn's words always win); cleared on compute. Router forces the calc
    lane when pending is fresh and the reply is a haan/nahi (`detectStance`, regex — code, not model).
  - **BEHAVIORAL memory:** `lib/memory/extract.ts` — new Haiku agent after each answered turn
    (fire-and-forget, node on the SAME pipeline trace via traceId). CLOSED fact set (sells/state/
    platforms/turnover_band/filing_frequency/observation:*), code validates keys. Confidence starts
    0.4, +0.1 reinforce on same value, RESET on changed value; DECAY halves per 60d unconfirmed
    (`effectiveConfidence`, floor CONF_USABLE 0.25); only user confirmation → 0.9 (`store.ts`).
    Injected 3 places (`pipeline.ts`): intake context · retrieval-rewrite hint (transform `userHint`) ·
    slot pre-fill. Memory is NEVER merged into the context fillSlots reads (trust boundary).
  - **CONFIRM-not-ask:** `proposeDefaults` (`lib/memory/prefill.ts`, deterministic memory→slot mapping,
    incl. state→special-category, sells→goods/services) + `buildConfirmation` (`clarify.ts`, PURE
    FUNCTION — shows each assumption + origin + date, asks only true gaps). Assumptions live in
    pending.assumed and NEVER reach a calculator unconfirmed. Resolution in code: explicit correction
    wins & consumes a "nahi" (untouched assumptions keep implicit consent); bare "nahi" drops ALL
    assumed (re-asked cold, never re-proposed — `rejected`); "haan"/answering-the-gaps = consent.
    On compute, `rememberAllDefaults` writes every non-date slot as kind='default' @0.9. Rate lane:
    vague item resolves via profile → CONFIRM-first (never states the rate); confirmed price-band side
    becomes `default:rate_lookup.<item>.side` → next time a one-tap confirm replaces the threshold ask.
  - **Panel:** `/memory` ("Jo mujhe yaad hai") — view/edit/delete every fact w/ post-decay % + as-of;
    edit = strongest confirm (0.9). API `app/api/memory`. ⚠️ ANAND: this is business PII — consent +
    retention policy before any real deployment.
  - **Fixed en route:** `resolveConditionSide` parser broke on "**below**" (markdown bold w/ long
    context) → strip non-letters before matching (lookup.ts). Real drift case observed: extractor once
    wrote filing_frequency="quarterly" (user said monthly) — system behaved as designed (0.4 conf,
    reset-on-change, panel delete); extractor prompt hardened ("when in doubt, OMIT").
  - **Docs current:** `docs/mermaid/06-memory.mmd` (new) + master-flow updated (memory load/inject/
    extract/CONFIRM nodes) + ARCHITECTURE_FLOW.md §6 MEMORY + file index; `agent-prompts.ts` + the
    "memory extract" agent; /admin/architecture staleness dirs now include lib/memory + new APIs.
    All 6 .mmd validate; tab renders green.
  - **8c-fix addendum (same day, from Anand's dogfooding):** "description mein kya likhun, ek
    example do" got WRONGLY T3-escalated. ROOT CAUSE: with context, intake answered
    intent="procedure" (a LANE word — INTENTS had no home for benign how-to) → zod fail ×2 at
    temp 0 → fail-up to T3. THREE-LAYER FIX: (1) new intent `general_guidance` (golden-schema.ts);
    (2) `repairIntake()` in intake.ts — deterministic vocab repair before zod (lane-word-as-intent
    remapped, reason clamped; TIER is never repaired — invalid risk still fails up); (3) new
    **GUIDANCE lane** (`lanes/guidance.ts`): drafting/wording help answered directly (Sonnet) with
    hard no-rates/amounts/dates/sections prompt rules + **G6** code regex that strips any slipped
    line + code-appended disclaimer. OVER-TRIGGER caught & guarded: "how do i get a GST refund"
    briefly rode guidance uncited → `reconcileLane` now forces grounded procedure when intent is
    substantive OR the question matches the SUBSTANTIVE keyword regex (lanes.ts). Verified: the
    failing convo → guidance/T1 w/ example + disclaimer · refund → RAG cited s54/r90 · DRC-01 → T3.
  - **Known tradeoffs (deliberate):** answering remaining gaps w/o objecting = implicit consent
    (documented in working.ts); per-period facts (nil_return) learn the LAST confirmed value — can
    flip-flop but always confirmed before use; a stale calc-pending + "haan" on a DIFFERENT lane's
    confirm could misroute (6h TTL bounds it).
- ▶ **SESSION 8 (2026-07-09) — Phase 8b: make it actually WORK (kill wrongful abstentions).** BUILT &
  VERIFIED BY RUNNING THE APP (no evals this session, by request). Turned the single retrieve→generate
  pipe into a **router → lanes**, and gave the agent a **third move: ASK**.
  - **The third move (ASK):** `lib/agents/clarify.ts` (`fillSlots` extracts from convo w/ a trust
    boundary + now a CLOCK for relative dates "5 days back"/"kal" + crore/lakh expansion; `buildClarification`
    asks ONE bundled question). Derived from each tool's required-input SCHEMA in `lib/tools/registry.ts`.
    Dead `needs_clarification` wired as the blunt fallback. Multi-turn carry-back uses existing threads.
  - **Router → lanes:** intake (`lib/agents/intake.ts`) now emits `lane` too (same G1 call); `lib/agents/
    lanes.ts` holds the LANE enum + `LANE_GUIDE` + `reconcileLane` (trusts specific model picks, overrides
    only weak defaults) + `pickCalcTool`. Pipeline dispatches a `laneHandlers` map; unhandled lanes fall
    through to the UNCHANGED RAG path. **T3 still short-circuits before the router.**
  - **Lanes built:** `lanes/calculation.ts` (late-fee/interest/registration via ASK; general-arithmetic
    path; RAG fallback via `toolFits`), `lanes/rate.ts` (rate lookup + condition-ASK), `lanes/timeline.ts`
    (bounded change-over-time). Shared `LaneOutcome` type in lanes.ts.
  - **Rate table:** `lib/rates/table.ts` (~28 items, item/HSN→rate+condition+source notif+effective_date,
    ⚠️ MODEL-COMPILED `verified:false`) + `lib/rates/lookup.ts` (`resolveItem` synonym-then-model-in-
    closed-set, `lookupRate` flat/conditional/ask). Pre-cited → sidesteps the gate → fixes edible-oil,
    footwear (≤/>₹2500 ASK), and the Hindi-vs-English inconsistency (lookup is language-agnostic).
  - **Calculators:** added `generalArithmetic` (safe dispatcher, NO eval, NO citation), `registrationThreshold`
    (s22/s24), `refundExportRule89` (Rule 89(4)) in `lib/calculators/index.ts`; all exposed in the RAG
    tool loop (`answer.ts`). Every tool DECLARES its inputs (registry) → that's what ASK reads.
  - **Gate loosening:** `pruneUngrounded` in `lib/gates/verify-citations.ts` — drop the untagged/fake-cited
    sentence, keep the cited remainder; abstain fully only if nothing grounded survives. Anti-hallucination
    (invalid-tag) bar KEPT. This un-suppressed the RAG lane (e.g. "how do i get a GST refund" now answers,
    cited r96/r89).
  - **VERIFIED (direct pipeline + real HTTP/SSE):** edible oil→5% pre-cited · footwear→condition-ASK →
    ₹800 price→5% · "chappal" (Hindi)→footwear · registration ASK→answer (₹45L>₹40L, s22/s24) · relative
    dates "5 days back/today"→computed · general math "2 lakh @18%"→₹36,000 gate-free · refund→RAG cited ·
    timeline footwear→anchored on ntr-2025-009 · T3 dispute→escalates. Screenshot of the late-fee ASK in
    session log.
  - **⚠️ ANAND (carryover, see LEARNING_LOG Session 8):** (1) VERIFY the rate table vs source PDFs (it's
    model-compiled). (2) Preview MCP can't launch the server (corepack pnpm crashes under Node 18) — I ran
    `node node_modules/next/dist/bin/next dev -p 3210` under Node 22 manually; fix nvm default→22 or the
    launch cmd. (3) Optional: nudge sonnet to actually CALL refund_export_rule89 (it sometimes explains).
- ▶ **SESSION 8b addendum (2026-07-10) — post-test-ride fixes + observability + debug diagrams + a skill.**
  All verified by running the app.
  - **Fixes (from Anand's dogfooding):** (a) **"100 crore" → 1000 crore** — Haiku was told to EXPAND
    amounts and miscounts zeros; now it copies amounts VERBATIM and `validate()` (clarify.ts) expands
    crore/lakh IN CODE. (b) **"N shoes" mis-guessed the price tier** — `resolveConditionSide` read a
    QUANTITY as a price → guessed 18%; prompt now says a quantity is NOT a price → returns 'unknown' →
    ASKs the per-pair price. (c) **Intake resilience** — a transient API blip silently escalated routine
    Qs to a CA; `intake.ts` now splits transient (429/5xx/net → retry/backoff → `serviceError` "try
    again") from parse-fail (→ T3 fail-safe); max_tokens 200→300. (d) **Langfuse:** trace links now use
    `/project/<id>/traces/<id>` (`getLangfuseProjectId()` auto-fetch); `sessionId = threadId`;
    `answerQuestion` NESTS under the pipeline trace (ONE trace/turn); every model call is a
    `recordGeneration` node; client pinned to `globalThis` (survives dev hot-reloads). Hobby-tier
    ingestion lags ~30–60s ("still being processed" is normal).
  - **Docs (NEW):** `docs/CODE_WALKTHROUGH.md` (code-block-level, 8 modules), `docs/SYNTAX_GLOSSARY.docx`
    (76 terms), `docs/ARCHITECTURE_FLOW.md` + `docs/mermaid/*.mmd` (5 flow diagrams) +
    `docs/architecture-flow.html` (standalone viewer). Diagram convention: **one box = one step, labelled
    AGENT/FUNCTION/LIBRARY, with in:/out:**; decisions are diamonds; gates show thresholds; the
    CLARIFICATION is shown as a loop and it states that **`buildClarification` is a FUNCTION — no LLM
    writes the question** (the LLM only extracts + a FUNCTION detects missing slots).
  - **In-app debug tab (NEW):** `app/admin/architecture/` — nav "Architecture ▸". Two views:
    **Flow diagrams** (live-renders the `.mmd` with tabs/zoom/download + a source-vs-diagram STALENESS
    banner) and **Agent prompts** (`agent-prompts.ts` — every LLM call: name · model · file · stage ·
    purpose · the actual prompt). Added `mermaid` dependency.
  - **"Mindful Coding" skill (NEW, reusable):** `~/Documents/Mindful Coding/` (symlinked to
    `~/.claude/skills/mindful-coding`). In ANY project it asks "only `.mmd` or also an in-app debug
    tab?", then generates diagrams to the convention + validates + builds the viewer + optionally the
    tab. Scripts: `scripts/{build-html,validate-mmd}.mjs`.
  - **⚠️ OPEN (fix later, LEARNING_LOG Session 8 addendum):** (1) **total-GST-on-quantity** — after the
    price ASK, compute qty × price × rate (composite goods-GST). (2) **English-vs-Hinglish RAG** — add the
    raw Hindi query as a 2nd dense probe; NOT done blind (changes RRF fusion → needs a retrieval
    before/after check = an eval). (3) **`pnpm docs:flow`** — LLM regen of the `.mmd` from code (git-diff =
    the change highlight); proposed, not built.
  - **▶ NEXT = Phase 8c (agent memory + lightweight sign-up).** Add per-user memory so the app recognises
    a returning seller and turns cold ASKs into CONFIRMATIONS. THREE memory types kept distinct: WORKING
    (the Phase-8b slot object — extend, don't duplicate), BEHAVIORAL (per-user `user_memory`: fact +
    confidence + provenance + last_confirmed), PROCEDURAL (per-user learned defaults). **Non-negotiable:
    memory sets DEFAULTS/CONTEXT, never silently drives a rate/number/eligibility — any remembered fact
    that would change a legal answer must be shown + CONFIRMED (stale memory = confident wrong answer);
    the confirm UX IS the verification.** Build order: identity+profile (email-only, ask just "what do you
    sell?" + "which state?") → working memory → behavioral memory (Haiku extract after each answer, inject
    before) → confirm-not-ask + per-user defaults → "what I remember" panel + confidence decay. Keep the
    safety bars (T3 · no confident false answer · legal claims cite). No evals; verify across TWO sessions
    in the browser. Full prompt handed to Anand.
- ▶ **SESSION 7 (2026-07-08) — Phase 8 flywheel + retrieval fix + eval stability + UI.** BUILT & VERIFIED:
  - **Flywheel** (self-improvement loop): `lib/golden/append.ts` (append case → provenance="production",
    source_trace_id, dataset `version` bump in golden.json; only human-approved = `verified`, gates CI) +
    `lib/golden/predraft.ts` (Haiku pre-drafts labels, identity-guarded to retrieved ids) +
    `app/admin/triage` (page+API: 👎 queue → pre-draft → ⚠️ ANAND approves each label → append). Demo'd
    end-to-end on a seeded refund 👎 (pre-draft nailed intent=refund_export, tier=T2, chunks s54/r90/r95).
  - **CI**: `.github/workflows/ci.yml` — 25-case smoke (T3 recall=1.0, false-answer=0, citation validity,
    HARD `expect`) as PR block + nightly full + langfuse-sync. Scripts: `pnpm eval:smoke`. ⚠️ needs GitHub
    remote + 5 secrets. Docs: `docs/DASHBOARD.md` (cliff-vs-slope weekly read), `docs/MODEL_CHANGE.md` (2×2).
  - **Retrieval fix** (refund miss): embed-whole (removed the 6,000-char truncation — it was an OOM
    workaround, not a model limit; `embed-chunks.ts` now solo-batches giants + size tripwire; re-embedded
    190 oversized chunks) · gen source cap 4,500→12,000 (`answer.ts`) · intent-conditional statute boost in
    fusion (migration 0009 `statute_boost`, `transform.ts` `doc_type_hint`, `search.ts`). Verified at
    retrieval level: s54 dense #15→#2, fused #2, 5/8 statute; rate queries un-regressed.
  - **KEY FINDING — read before more retrieval work:** fact_match did NOT improve, and the diagnostic shows
    why: (a) the answer eval is **flaky** (1/18 vs 3/18 on identical code — ±2 noise), now damped by
    `EVAL_REPEAT` mean-pass-rate; (b) the real fact_match blocker is the **citation gate force-abstaining**
    (~11/18 end in the 101-char abstention), not retrieval. NEXT LEVER = the gate (loosen over-abstention,
    hold false-answer=0), on the now-stable eval. The refund class is barely in the fact cases → adding
    refund goldens (via triage) is what will let the eval measure the retrieval fix.
  - **Eval spend controls**: `eval:answer` now `EVAL_SAMPLE=30` (curated: all 18 fact + 12 unanswerable,
    ~$1-2/run) + `EVAL_REPEAT=3` (mean-pass-rate). `eval:answer:full` = 60-case single-run baseline.
  - **UI**: redesigned chat (warm-paper/teal/serif, empty-state chips, citation cards, tier badges) +
    `[SOURCE-ID]` leak fix in pipeline. Dev server: preview `gstpilot-dev` :3210. Admin nav has Triage.
  - ⚠️ ANAND: approve the seeded refund 👎 in /admin/triage to close the loop (→ golden → smoke) · set up
    GitHub remote + CI secrets · then the gate work. (Carryover: G2 threshold, verification sitting, Render.)
  - **LATEST (2026-07-09) — live evidence + open design Q.** Anand's own test-ride WRONGLY abstained on rate
    questions ("what is the gst rate for edible oils", "is the rate same for all oils") — edible-oil rates
    ARE in corpus (`NOTIF-CTR/ntr-2017-001` Sch I, 5%). Confirms the top-2 open problems hit RATE queries
    hardest: (i) rate-schedule **dilution** — a rate line buried in a giant multi-page schedule chunk (the
    deferred **"schedule-row summaries"** ingestion lever, still #1 for rates; note the new doc-type boost
    does NOT help rates — they're "stream"); (ii) **gate over-abstention** (same as refund). Rebuilt
    `docs/gstpilot-explained.html` (full current explainer, code-linked).
  - **OPEN DESIGN Q (Anand raised — discuss/decide next session): make RATE lookups deterministic like the
    calculators.** Proposal: a structured **rate table** + a `lookup_rate` tool (item/HSN → rate + source
    notif id) composing with the existing calc tool (lookup → calculate). POV = right long-term (a rate is a
    FACT, not a passage; extends "model proposes, code disposes"), BUT: (a) three-tier rule — the table
    can't be model-filled without human verification; (b) item→HSN mapping is its own fuzzy step; (c) real
    rates carry CONDITIONS (branded/unbranded, ≤₹1000 vs >, packaged/loose) so schema ≠ simple HSN→rate;
    (d) sequencing — the gate fix helps ALL answerable classes, a rate table helps one. Recommended path:
    **schedule-row chunks FIRST** (fixes dilution, makes each rate a clean citable retrievable unit), THEN
    promote isolated rows to a typed rate table + `lookup_rate` tool. See lib/calculators/ for the pattern.
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
- **NODE 22 REQUIRED.** The nvm default sometimes falls back to Node 18, where corepack `pnpm` crashes
  ("Invalid host defined options") — this breaks the Claude preview MCP launcher AND one-off `tsx`/DB
  scripts. Fix per shell: `export PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"`. If the preview MCP
  won't start, run the server manually: `node node_modules/next/dist/bin/next dev -p 3210` (Node 22, with
  NODE_EXTRA_CA_CERTS set). Set nvm default to 22 to fix permanently.
- Long jobs: shell caps at 10 min — use `nohup pnpm X > /tmp/log 2>&1 &` + Monitor on the log.
- **New architecture (Session 8):** `lib/agents/{lanes.ts,clarify.ts,lanes/*}` + `lib/rates/*` +
  `lib/tools/registry.ts`. The router lives in `pipeline.ts` (the `laneHandlers` map). Adding a lane =
  a handler returning `LaneOutcome` + a map entry; adding a tool = a registry spec (auto-teaches ASK).
- **Memory (Session 8c):** `lib/memory/{working,store,extract,prefill}.ts` + `app/api/{user,memory}` +
  `app/memory` panel. Lanes receive `LaneExtras` {memory, pending, threadId, userId}; a lane returns
  `pending` on its outcome (object=save, null=clear, undefined=leave). Route loads memory+pending per
  turn and persists the instruction. Adding a memory-fillable slot = one mapping in `prefill.ts`.
- **DIAGRAM SYNC RULE (STANDING, Anand's instruction 2026-07-10):** ANY workflow change or bug fix
  ships WITH its diagram update in the SAME session — no exceptions. That means: (1) the affected
  `docs/mermaid/*.mmd` file(s); (2) the mirrored mermaid blocks in `docs/ARCHITECTURE_FLOW.md`;
  (3) `app/admin/architecture/agent-prompts.ts` if any LLM prompt changed. FLAG CONVENTION: every
  changed box gets an orange dashed border (`classDef fix` + `class <NODES> fix;`) AND a dated line
  in the box text — `🔧 FIX yyyy-mm-dd: what broke → what changed` for bug fixes, `🔄 <phase>
  yyyy-mm-dd` for behavior changes. Flags are cleared next phase once the change is test-ridden
  (so the orange always means "recent"). Validate before finishing:
  `node ~/.claude/skills/mindful-coding/scripts/validate-mmd.mjs docs/mermaid` (must be N/N ok),
  then eyeball the tab at /admin/architecture (banner must be green).

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
