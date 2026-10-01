# GSTPilot — Learning Log

## Portfolio launch — 1 October 2026 (live acceptance verified)

**Design calls.** Preserve the question/clarification/citation and confirmed-memory loop, but derive identity from a real account. Add an explicit historical filing action beside chat. A prepared example shares calculator and persistence behavior while bypassing providers; ordinary pasted facts never inherit that exemption. Reusing the full chat pipeline for the single filing action was rejected because intake, retrieval, synthesis and memory extraction would add hidden requests.

**Three concepts.** (1) A successful fetch is not the end of an identity check: JSON body parsing and every streamed frame can finish after another account signs in. Capture an owner generation before the request and reject stale work throughout. (2) A browser may still think it is account A after another tab changes the cookie to B; an expected-owner request header lets the server reject this transition before returning B's data. (3) A deterministic formula can be correct for its inputs while the legal conclusion remains unsupported. Display supplied dates, reviewed historical scope and actual source links rather than claiming a current liability.

**Verification.** Eleven client regressions, 18 PostgreSQL contracts, two provider/PostgreSQL contracts and 48 compiled Auth.js/API checks (58 assertions/57 requests) pass. TypeScript and the coherent build pass. Live two-account acceptance used 29 requests with zero providers; root browser checks of free and paid paths had no console errors. The original baseline and routing repair remain separate evidence.

**One paid path.** On 1 October 2026, 09:55:20.640–09:55:22.974 UTC, one ordinary filing POST completed without retries. OpenAI `gpt-4o-mini` used 608 input and 78 output tokens, zero cached, at an estimated USD 0.000138. The model extracted supplied fields; deterministic code produced ₹300 and persisted it under the owner. Independent readback confirmed the saved reply and another owner's 404. This is a historical formula demonstration, not validation of current tax liability or a fully paid chat pipeline.

**Release boundary.** Live image `ca026ef671cea06a8860712d53d82eb33593b3423778893c45103f884f128b45` came from logical Docker tag `portfolio/gstpilot:f8058a32493897f9`. Image identity is recorded at build, tested without network, checked before activation and retained in runtime configuration. This closes the risk that a second build silently activates bytes different from those tested.

**Browser findings corrected.** Historical filing source IDs are not corpus chunk IDs. Workspace and admin conversations now share an allowlisted official-source link renderer; actual corpus references retain local detail links. A filing-mode T3 response has no calculation, so it must not display the historical calculation badge or disclosure.

**Known documentation/tool limits.** Diagram 7 captures the launch path. MASTER renders successfully but retains older failure/memory/lane details without the hosted coverage gate. Legacy CLI scripts still carry service or laptop assumptions and some issue paid requests; they are not the certified hosted setup or corpus-write workflow.

**Most likely to break later.** Extending source coverage without extending its date/period guards would turn a historical illustration into an unjustified current-law claim. Review official source coverage and preserve owner/prepared provenance before adding periods or calculator rules.

## Session 9 — 2026-07-21 (Blindspot observe-only connection)

**What we built:** connected gstpilot to the local Blindspot prototype without changing its Claude
routing. The existing `recordGeneration` helper now sends the same model, timing and token evidence to
Langfuse and Blindspot; a turn-level `pipeline` span marks the workflow completed and flushes children at
the answer boundary. Three live questions discovered `intake`, registration/late-fee slot filling, and
the Sonnet guidance lane. Capture stayed `metadata`, so no question or answer content was retained.

**3 key concepts:** (1) environment variables configure telemetry but cannot emit it—the application
must call the SDK around real work; (2) linked local packages cross build-tool boundaries, so Turbopack's
root must include both sibling projects and `node_modules` must contain the actual link; (3) child model
spans are not the workflow lifecycle—a root agent span plus an explicit terminal flush prevents completed
requests from appearing permanently `running`.

**Hosted deployment follow-up:** the first connector existed only in a local commit and depended on
`link:../Projects/Blindspot_v1/packages/sdk`. Render checks out only the GSTPilot repository, so the
neighbouring Mac folder could never exist in its build container. Deepest cause: `process` — local package
linking was treated as distribution. Fix: build the publishable SDK, vendor the versioned 0.1.0 tarball
inside GSTPilot, pin `package.json`/the lockfile to it, remove the read-only-host-incompatible Corepack shim
step, and declare metadata + observe-only Render configuration. Prevention: every connector release must
pass a clean install/build using only files tracked in the consuming repository before deployment.

**Most likely to break later:** the vendored package is the fastest beta proof, not the public install
experience; publish `@blindspot/sdk` to a package registry before onboarding unrelated repositories. On
this machine the dev server also needs the existing `NODE_EXTRA_CA_CERTS` bundle or Supabase thread
creation fails before the agent runs. The API route currently hides that insert error and dereferences
`data!`; surface the database error before public beta.

## Session 8c — 2026-07-10 (Phase 8c: agent memory + lightweight sign-up — ask → CONFIRM)

**Why this session:** the app re-met a stranger on every message. Every turn re-derived everything
from raw chat text; a returning seller was asked the same five questions forever. Goal: recognise a
returning user, stop asking what we already know, and turn cold questions into warm confirmations —
WITHOUT ever letting a remembered (possibly stale) fact silently drive a legal number.

**What we built (5 checkpoints, verified by RUNNING the app across two sessions — no evals):**
1. **Identity** — email-as-id sign-up (no password), 2-question onboarding (sells, state), user_id on
   threads and on the Langfuse trace. Migration 0010: `user_profile`, `threads.user_id/pending`,
   `user_memory` (fact · value · confidence · provenance · as_of · last_confirmed · kind).
2. **WORKING memory** — the Phase-8b SlotFill persisted as ONE `pending` object on the thread
   ({tool, values, assumed, missing, rejected}); a clarification now RESUMES from structure instead of
   re-reading 20 turns. Cleared on compute; 6h TTL.
3. **BEHAVIORAL memory** — a new Haiku agent (`lib/memory/extract.ts`) runs AFTER each reply
   (fire-and-forget, a node on the same pipeline trace) and upserts durable facts from a CLOSED set;
   code validates the keys. Injected before each turn in 3 places: intake context, retrieval-rewrite
   hint, slot pre-fill. Never merged into the context fillSlots reads.
4. **CONFIRM-not-ask + PROCEDURAL defaults** — missing slots consult memory (`prefill.ts`,
   deterministic mapping) and become SHOWN assumptions with origin + date ("aapne pichhli baar confirm
   kiya tha, 2026-07-10 — sahi hai?"); the calculator refuses to run on an unconfirmed assumption.
   "haan"/answering-the-gaps graduates them; an explicit correction wins and consumes a "nahi"; a bare
   "nahi" drops ALL assumptions (safe direction). On compute, every non-date slot becomes a per-user
   default (kind='default', 0.9) — next month's cold ask is a one-line confirm.
5. **"Jo mujhe yaad hai" panel + hygiene** — /memory shows every fact with post-decay confidence and
   as-of date; edit (= strongest confirmation) and delete. Confidence halves every 60 unconfirmed days;
   below 0.25 a fact stops being proposed and gets re-asked.

**3 key concepts:**
1. **Three memory types, three lifetimes.** WORKING = this conversation's live state (minutes, on the
   thread); BEHAVIORAL = observed facts about the person (weeks, low-trust until confirmed);
   PROCEDURAL = confirmed shortcuts (durable, high-trust, decaying). Collapsing them into one blob is
   how agents end up "remembering" a guess as a fact — the `kind` column and the confidence ladder
   (0.4 extract → +0.1 reinforce → 0.9 human-confirm → halve/60d) keep provenance attached to trust.
2. **The confirmation UX IS the verification.** We never built a memory-verification pipeline —
   instead every consequential remembered fact must pass through a human "sahi hai?" before it touches
   a number. Model proposes (extraction, pre-fill), code disposes (detectStance regex, buildConfirmation
   pure function, prefill mapping) — an LLM never invents a memory key, writes the confirmation text, or
   decides that an assumption was accepted.
3. **A stale/wrong memory is a confident wrong answer — and we watched it happen.** The extractor once
   stored filing_frequency="quarterly" for a user who said "monthly" (a real hallucination in testing).
   Every defense fired: it entered at 0.4 (not trusted), it could only ever surface as a SHOWN
   assumption, and the panel deleted it in one click. That's the design working, not luck — plan for
   wrong memories, don't hope against them.

**Most likely to break later:** `detectStance` + the negation-attribution rule are regex/heuristics
fitted to Hinglish yes/no replies. A phrasing they misread ("theek nahi hai" reads affirm+negate) can
mis-graduate an assumption — the blast radius is bounded (the assumption was SHOWN on screen and the
reply echoes every input: "Galat ho to sahi bata dein"), but watch feedback for "maine to nahi bola
tha". Second: `rememberAllDefaults` learns per-period facts (nil_return) as durable defaults — they
flip-flop between confirmations; if that annoys users, exclude nil_return from default-writing.

**Session 8c addendum (same day) — the wrongful-T3 fix + the GUIDANCE lane.** Anand's dogfooding
found "description mein kya likhna hai, ek example do" escalated to a CA. Root cause was a
TAXONOMY HOLE, not risk logic: INTENTS had no home for benign how-to questions, so the classifier
borrowed the lane word "procedure" as an intent → zod rejected it → temperature-0 retry produced
the identical output → double failure → the deliberate fail-UP default sent it to T3. Fix in three
layers: a `general_guidance` intent (give benign questions a home) · `repairIntake()` (deterministic
vocabulary repair before zod — but the TIER field is never repaired; risk still fails up) · a new
GUIDANCE lane that answers drafting/wording help directly with hard no-numbers rules, a G6 regex
that strips any rate/amount/section that slips out, and a code-appended disclaimer. **Lesson 1:
fail-up defaults amplify upstream schema gaps** — when the safe fallback is drastic (a CA
escalation), every hole in the happy path funnels into it; watch WHAT lands in the fallback, not
just that it exists. **Lesson 2: at temperature 0, "retry once" is not a second opinion** — the
same prompt gives the same wrong output; a retry only helps if something changes (repair the output
in code, or vary the ask). **Lesson 3 (from the same hour): a permissive lane over-triggers
immediately** — "how do i get a GST refund" rode the uncited guidance lane on its first outing;
the deterministic SUBSTANTIVE-keyword guard in reconcileLane pulls law questions back to the cited
path. Un-rigid where facts aren't needed, rigid wherever they are.

**⚠️ HUMAN TASKS (Anand):**
- Real sign-in before ANY real user: magic-link (prove inbox ownership) + an explicit consent screen.
  Today anyone typing an email BECOMES that user and can read their memory panel.
- `user_memory` is business PII (turnover, platforms, state): decide retention + deletion policy and
  check Supabase encryption posture before real sellers touch it.
- Carry-over from 8b: verify the model-compiled rate table against source PDFs; fix nvm default → 22.

## Session 8 — 2026-07-09 (Phase 8b: make it actually WORK — the third move, router→lanes, rate table, gate loosening)

**Why this session:** the app abstained on things it should handle — "what is the late fee for GST
filing" (we HAVE the calculator, but the question had no params), "edible oil ka gst" (rate buried in
a giant schedule chunk), "footwear rate changes in 6 months" (temporal, unhandled). Root causes: the
agent had only TWO moves (answer/abstain), one rigid retrieve→generate pipe, rates as unstructured
prose, and an all-or-nothing citation gate that suppressed nearly every RAG answer.

**What we built (6 pieces, verified by running the app — no evals this session):**
1. **The third move — ASK.** `lib/agents/clarify.ts`: reads a tool's required-input SCHEMA
   (`lib/tools/registry.ts`), extracts whatever the conversation already gave, and asks ONE bundled
   friendly question (with options) for the gaps instead of abstaining. Multi-turn carry-back rides
   the existing thread context.
2. **Router → lanes.** Intake now also classifies the question's LANE (rate_lookup · calculation ·
   procedure · eligibility · change_over_time · escalate · out_of_scope) in the same G1-guarded call.
   `reconcileLane` trusts a specific model pick and only overrides the weak defaults; `pickCalcTool`
   + `toolFits` pick the right tool per lane. Each lane returns a `LaneOutcome`; the rest fall through
   to the unchanged RAG path. Safety bars intact (T3 escalates first).
3. **Rate table + `lookup_rate`.** `lib/rates/`: rates as structured FACTS (item/HSN → rate + price
   condition + source notif id + effective_date), model-compiled from the notifications. Lookup is
   language-agnostic (Hindi item words resolve via synonyms/model-in-closed-set), pre-cited (carries
   its own chunk id), and asks the price-threshold question for conditional items (footwear ≤/>₹2500).
4. **Calculators.** A safe general-arithmetic dispatcher (closed op set, NO eval, NO citation — just
   math on the user's own numbers), plus typed `registrationThreshold` (s22/s24) and export-refund
   `refundExportRule89` (Rule 89(4)). All exposed to the RAG tool loop; the understanding layer now
   resolves relative dates ("5 days back", "today", "kal") and word-amounts ("10 crore") — the extractor
   finally has a clock.
5. **Gate loosening.** `pruneUngrounded` in verify-citations.ts: drop ONLY the untagged/fake-cited
   sentence and keep the cited remainder, abstaining fully only if nothing grounded survives. Kept the
   hard anti-hallucination bar (invented citations never ship). This un-suppressed the whole RAG lane.
6. **Change-over-time lane (bounded).** Retrieves dated notifications/circulars, sorts by government
   release date (`effective_date`, populated on all 1064 chunks), filters to the asked window, and
   narrates a cited timeline ONLY when ≥2 dated docs exist — else honest "one doc" / "no change I can
   see". Seeded with the rate-table anchor so a rate topic lands on the right notification.

**3 key concepts:** (1) **A third move changes the product.** answer/abstain → answer/**ASK**/abstain.
And the ASK is derived from the tool's required-input schema, so every tool you add teaches the ASK
move for free — you never hand-write "what to ask". (2) **Facts vs passages.** A rate/threshold is a
FACT you look up, not a passage you fish out of prose. Making it a pre-cited lookup fixes THREE things
at once — the Hindi-vs-English inconsistency (lookup is language-agnostic), the buried-rate dilution
(the number isn't retrieved), and the gate over-abstention (a pre-cited fact can't trip the gate).
(3) **Gentle enforcement beats all-or-nothing.** Dropping the one bad sentence keeps every safety
guarantee while unblocking the good answer. Same spirit runs through the router ("trust a specific
model pick; model proposes from a CLOSED list, code disposes") — hard where it must be, forgiving
where it can be.

**Most likely to break later:** the **rate table is model-compiled and UNVERIFIED** — a wrong rate is
exactly the "confident false answer" the brief forbids. It's mitigated (every rate is cited + carries
a "confirm on the notification" hedge + `verified:false`), but the real fix is a human sitting with the
source PDFs (⚠️ below). Second: the lane router leans on the intake's lane label; a model drift could
misroute (guarded by `reconcileLane` + `toolFits`, but watch the router notes in the trajectory).

**⚠️ HUMAN TASKS (Anand):**
- [ ] **Verify the rate table** (`lib/rates/table.ts`) against the source rate notifications; flip
  `verified` to true per row (or correct the rate/threshold/citation). It's model-compiled for now.
- [ ] **Preview tooling:** the Claude preview MCP can't launch the server — it runs `pnpm` via corepack
  under Node 18, which crashes ("Invalid host defined options"). I ran the dev server manually on
  :3210 with Node 22 (`node node_modules/next/dist/bin/next dev -p 3210`). Fix: set nvm default to 22
  or pin the launch command to a Node-22 `next` binary so preview screenshots work again.
- [ ] (Optional) The `refund_export_rule89` tool exists but sonnet sometimes explains the formula
  instead of calling it — a stronger prompt nudge would make it compute the number.

### Session 8 addendum (same day) — post-test-ride fixes (Anand dogfooding at :3210)

**Fixed (in code, verified by running the app):**
1. **Intake resilience — a transient API blip was silently escalating routine questions to a CA.**
   `classifyIntake`'s bare `catch {}` treated a network/overload error the same as bad-JSON output;
   after two tries it defaulted to T3 with "intake failed twice". Fix: distinguish transient
   (429/5xx/network) from parse failures — retry transient with backoff, and if the *service* stays
   down return a `serviceError` so the pipeline shows an honest "try again" instead of a fake
   escalation. Also bumped intake `max_tokens` 200→300 (the added `lane` field made JSON longer).
2. **Langfuse trace links 404'd.** The UI built a bare `…/traces/<id>`; Langfuse Cloud needs
   `…/project/<projectId>/traces/<id>`. Fix: `getLangfuseProjectId()` fetches the id via the public
   API (existing keys, cached) — no manual env step. `/admin/{conversations,triage}` link correctly now.
3. **Langfuse trace structure — one turn was two disconnected traces, no visible nodes, no session.**
   Fix: `sessionId = threadId` (groups a conversation's turns into one Langfuse Session);
   `answerQuestion` now nests under the pipeline trace (killed the stray "answer" trace → one trace
   per turn); every model call wrapped as a `recordGeneration` node so the tree (intake · transform ·
   sonnet-generation · fill-slots · reply · G5) is visible with token usage. Verified via the API:
   sessionId present, 2 traces for 2 turns (not 4), generation nodes nested under `resolution`.

4. **"100 crore" was echoed as ₹10,00,00,00,000 (1000 crore).** Root cause: the slot extractor
   PROMPT told Haiku to *expand* crore/lakh to digits — and Haiku miscounts zeros on big numbers.
   Fix (the principle, not a bigger model): tell the model to copy the amount VERBATIM ("100 crore")
   and let `validate()` do `100 × 10^7` deterministically — model proposes, code disposes. Verified
   across 100 crore / 40 lakh / 1.5 crore / ₹1,50,000 / 2.5 cr. **Takeaway: don't reach for Sonnet to
   fix arithmetic — take the arithmetic out of the model.**
5. **Langfuse "no traces today" / "Trace not found".** Two causes: (a) the dev server had run since
   the previous evening and hot-reloaded through today's `langfuse.ts` rewrite, resetting the
   module-level client so traces got ids but never flushed; (b) Langfuse Hobby-tier ingestion lags
   ~30–60s (the "still being processed" message). Fix: pin the client to `globalThis` so hot-reloads
   reuse ONE client, and restart the dev server fresh. Verified: new chats ingest (pipeline trace +
   sessionId + generation nodes) after the tier's lag.
6. **"N shoes, kitna GST" mis-guessed the price tier.** The rate lane's `resolveConditionSide` read
   the *quantity* "10000" as a per-unit *price* (>₹2,500 → 18%). Fix: the prompt now states a
   quantity is NOT a price → returns "unknown" → the lane ASKS the per-pair price instead of guessing.
   Verified it now asks; plain "footwear ka gst" unregressed.

**Known-open (logged to fix later, NOT yet fixed):**
- [ ] **Total GST on a quantity.** After #6 it correctly ASKS the per-unit price, but once the price
  is given it still doesn't compute `quantity × price × rate` (the full total). Needs a composite
  goods-GST flow (resolve item → get qty + price → rate from table → multiply, pre-cited).
- [ ] **English-vs-Hinglish for the RAG (non-rate) lanes.** The rate table made *rate* lookups
  language-agnostic, but RAG still searches only the English rewrite/HyDE — it never embeds the raw
  Hindi query, wasting bge-m3's multilingual strength. Lever: add the raw query as a second dense
  probe. **Deliberately NOT applied blind** — it changes the RRF fusion inputs and could silently
  degrade all retrieval; it needs a before/after retrieval check (an eval), which this phase skips.


## Session 7 — 2026-07-08 (Phase 8: retrieval fix · eval stability · the self-improvement flywheel · UI)

**What we built:** (1) **eval cost + stability** — a 30-case curated sample (`EVAL_SAMPLE`, keeps ALL
18 fact cases so fact_match stays comparable) at ~half the spend, and N-run mean-pass-rate
(`EVAL_REPEAT=3`) so fact_match stops swinging ±2/18. (2) **retrieval fix for the refund miss** —
root-caused the giant-chunk truncation (the 6,000-char embed cap was an OOM *workaround*, not a
model limit; bge-m3 takes 8,192 tokens) → **embed-whole** (adaptive batch, giants solo, a size
tripwire that flagged s2 at 31.5k), widened the generation source cap 4,500→12,000, and an
**intent-conditional doc-type boost** in fusion (statute-anchored queries lift Act/Rules; rate
queries untouched — verified no regression). (3) **the Phase-8 flywheel** — `lib/golden/{append,
predraft}`, `app/admin/triage` (👎 → Haiku pre-draft → ⚠️ human approve → golden append + version
bump), CI (`.github/workflows/ci.yml`: 25-case smoke asserting the absolute gates as a hard PR
block + nightly full suite + Langfuse experiment), and `docs/{DASHBOARD,MODEL_CHANGE}.md`. (4) **UI
redesign** (warm-paper/teal/serif, empty-state chips, quoted-snippet citation cards, tier badges)
and a `[SOURCE-ID]` placeholder-leak fix.

**The turning point (honest):** the retrieval fix is real at the *retrieval* level — s54 climbed
dense #15 → #2 and reached the agent (fused #2), 5/8 statute — but the golden eval showed fact_match
FLAT/down, and the diagnostic explained why: (a) the eval is **flaky** — 1/18 in the eval vs 3/18 in
the diagnostic on *identical code* (fact_match is ±2 noise at this granularity), and (b) the dominant
fact_match blocker is the **citation gate force-abstaining** (~11/18 answers end in the 101-char
abstention), NOT retrieval. The fix targeted a class (refund) the fact cases barely cover. Retrieval
work is correct and stays; the real levers are eval-stability (done) then the gate (next).

**3 key concepts:** (1) **root cause beats the directed fix** — "split the giant chunks at sub-rule
boundaries" was the plan, but the OCR made clean splits fragile, and the *actual* root cause was an
unnecessary truncation. Removing it (embed-whole) was simpler and safer. Let the evidence overrule
the plan, out loud. (2) **isolate changes, or pay when something breaks** — bundling embed-whole +
gen-cap + boost into one eval meant the (noise) regression couldn't be cleanly attributed; the
"isolate what worked" rule earns its keep exactly when a number moves the wrong way. (3) **failures
are assets; a static golden set depreciates** — reality (law, phrasings, models) keeps moving, so a
frozen test set tests yesterday's product. The flywheel turns each production 👎 into a permanent
regression test. Labels that feed zero-tolerance gates must be human-verified — a wrong label teaches
the gate to enforce a wrong answer.

**Most likely to break later:** the CI smoke runs the real pipeline on GitHub runners — it needs
bge-m3 downloaded (~600MB, cached), all five secrets set, and NO corp-CA path; if it goes red on
infra rather than a real gate, it reads like a product regression. And until the **gate
over-abstention** is fixed, fact_match stays ~0.1–0.15 no matter how good retrieval gets — that's the
next session's #1 lever.


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
