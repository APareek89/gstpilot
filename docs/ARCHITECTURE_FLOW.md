# GSTPilot — Architecture Flow (visual, for debugging)

> Built so a non-engineer can trace what happens without reading code. **Every box is ONE step** and tells you: is it an **AGENT** (an LLM decides) or a **FUNCTION** (plain code) · its **in:** (what goes in) · its **out:** (what comes out). Data flows box → box. When something misbehaves, find the box and open its file (index at the bottom).

## Legend

| Colour | Meaning |
|---|---|
| **blue** | **AGENT** — the configured model does this step |
| **green** | **FUNCTION** — our deterministic TypeScript, no model |
| **teal** | a **question back to you** (the clarification / ASK) |
| **purple diamond** | a **decision** (who decides is on the box) |
| **grey** | a **result** (answer / abstain / escalate) |
| **lilac** | **data / library** (PostgreSQL · rate table · embedding adapter) |
| **orange dashed border** | **🔧 recently FIXED / 🔄 recently CHANGED** — the box carries a dated 🔧/🔄 line saying what changed and why; flags are removed next phase once test-ridden |

Read each box as: **NAME · [AGENT/FUNCTION] · in: … · out: …**

---

## 1 · MASTER FLOW — one question, end to end (incl. the clarification loop)

```mermaid
flowchart TD
  %% Authenticated entry and the separate one-extraction filing path are in diagram 7.
  U(["YOU: a question<br/>'footwear ka gst kitna hai'"]):::term --> API

  API["API ENTRY<br/>FUNCTION · app/api/ask/route.ts<br/>in: your question + owned threadId + verified session<br/>out: question + CONTEXT (last-20-turns + summary)<br/>+ loads DURABLE MEMORY (profile+facts) + thread PENDING (diagram 6)"]:::fn --> INTAKE

  MEMDB[("user_memory + user_profile<br/>DATA · PostgreSQL · loaded per owner/turn")]:::data -.-> API

  INTAKE["INTAKE — classify<br/>AGENT · configured small model · intake.ts<br/>in: question + context + memory block (background only)<br/>out: intent, tier, lane"]:::agent --> G1{"valid output?<br/>FUNCTION · repairIntake() then zod<br/>🔧 FIX 2026-07-10: known vocab slips (lane-word-as-intent)<br/>repaired IN CODE before zod — TIER is never repaired,<br/>invalid risk still fails up (was: benign how-to → wrong T3)"}:::dec

  G1 -->|"API kept failing (transient)"| SVC["serviceError<br/>FUNCTION · out: 'service busy, try again'"]:::term
  G1 -->|"output malformed x2"| CA
  G1 -->|"ok"| T3{"tier == T3?<br/>FUNCTION · a live dispute?"}:::dec

  T3 -->|"yes"| CA["CA HANDOFF<br/>FUNCTION · caHandoff()<br/>in: question · out: summary for a human CA<br/>(malformed lands here too: risk unknown = fail-safe)"]:::term
  T3 -->|"no"| ROUTER["ROUTER<br/>FUNCTION (NO model) · reconcileLane()<br/>in: intent + lane + question · out: the chosen lane<br/>🔧 FIX 2026-07-10: guidance guard — a substantive intent OR a<br/>substantive keyword (refund/registration/ITC/…) forces the<br/>grounded RAG path (guidance briefly answered refund UNCITED)"]:::fn

  ROUTER --> LANE{"which lane?"}:::dec
  LANE -->|"calculation"| CALC["CALCULATION lane<br/>(diagram 2)"]:::fn
  LANE -->|"rate_lookup"| RATE["RATE lane<br/>(diagram 3)"]:::fn
  LANE -->|"change_over_time"| TIME["TIMELINE lane<br/>(diagram 4)"]:::fn
  LANE -->|"guidance (drafting/wording help ONLY —<br/>code guard: substantive words → RAG)"| GUIDE["GUIDANCE lane<br/>AGENT · configured main model · lanes/guidance.ts<br/>in: question + memory · out: practical example, NO rates/amounts/sections<br/>(G6 FUNCTION strips any that slip) + standing disclaimer<br/>🔧 NEW 2026-07-10 (bug fix: 'description mein kya likhun' was<br/>wrongly T3-escalated — benign how-to had no lane)"]:::agent
  LANE -->|"procedure / eligibility /<br/>refund / out_of_scope"| RAG["RAG path<br/>(diagram 5)"]:::fn

  CALC --> OUTCOME{"lane result?"}:::dec
  RATE --> OUTCOME
  TIME --> OUTCOME
  GUIDE --> OUTCOME
  RAG --> OUTCOME

  OUTCOME -->|"has everything it needs"| ANS["CITED ANSWER<br/>out: answer + source cards"]:::term
  OUTCOME -->|"sources don't cover it"| AB["HONEST ABSTAIN"]:::term
  OUTCOME -->|"a required input is MISSING<br/>and memory has NOTHING to propose"| ASK["CLARIFYING QUESTION — the ASK move<br/>built by a FUNCTION from pre-written phrases (NO LLM writes it)<br/>out: ONE question back to you, e.g. 'per-pair price 2500 se kam ya zyada?'"]:::ask
  OUTCOME -->|"a required input is MISSING<br/>but memory CAN propose it"| CONF["CONFIRMATION — confirm-not-ask (diagram 6)<br/>FUNCTION · buildConfirmation() — pre-written phrases, NO LLM<br/>out: shown assumptions + 'sahi hai?' + only the true gaps<br/>RULE: the number is NOT computed until you confirm"]:::ask

  ANS --> OUT2["OUTPUT<br/>FUNCTION · route.ts<br/>in: answer · out: source cards + saved msg + streamed to chat"]:::fn
  OUT2 --> MEMX["MEMORY EXTRACT (after reply, fire-and-forget)<br/>AGENT · configured small model · lib/memory/extract.ts<br/>in: this turn's exchange · out: durable facts (CLOSED set) → user_memory<br/>confidence starts LOW (0.4); only YOUR confirmation raises it"]:::agent
  MEMX -.-> MEMDB
  OUT2 --> DONE(["shown in your chat"]):::term
  ASK --> DONE
  CONF --> DONE

  %% ---- THE CLARIFICATION LOOP: how the agent 'asks' across turns ----
  DONE -.->|"YOU type the answer in the NEXT message"| U2(["YOU: '800 per pair'"]):::term
  U2 -.->|"SAME thread → API buildContext() adds the prior turn as MEMORY,<br/>so the lane now finds the missing input and computes"| API

  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
  classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
  %% fix flag: orange dashed border layered ON TOP of a box's base colour
  classDef fix stroke:#ea580c,stroke-width:3px,stroke-dasharray:6 3;
  class G1,ROUTER,GUIDE fix;
```

> **How the ASK works (plain):** a lane that's missing an input doesn't guess — it returns a **question** as its reply. That question is shown in chat. When **you answer in the next message**, the API's `buildContext()` re-sends the *previous* turn as memory, so on this second pass the same lane finds the value and computes. No special state machine — the thread memory carries it.
>
> **Who actually writes the question? A FUNCTION, not an LLM.** The model (`fillSlots`) only *extracts* what you already gave and *flags* which required inputs are missing. A separate FUNCTION (`buildClarification`, or the rate table's stored `ask` line) then stitches the **pre-written `ask` phrases** from the tool's schema (`registry.ts`) into one message. So the wording is deterministic and reviewable — the LLM never composes the question.

---

## 2 · CALCULATION lane — extract, then compute (agent vs code kept separate)

```mermaid
flowchart TD
  IN(["from router:<br/>your calculation question"]):::term --> RESUME{"fresh thread pending?<br/>FUNCTION · isFresh() (diagram 6)<br/>🔄 8c 2026-07-10: a gather in progress RESUMES —<br/>same tool, earlier values carried over"}:::dec

  RESUME -->|"yes — you're answering our last ask"| FILL
  RESUME -->|"no — a fresh question"| PICK

  PICK["pickCalcTool<br/>FUNCTION · lanes.ts<br/>in: question + intent<br/>out: tool name (late_fee | interest | registration)"]:::fn --> FIT{"toolFits?<br/>FUNCTION · does a legal calculator match?"}:::dec

  %% ---- branch A: no calculator fits ----
  FIT -->|"no"| EX["extract the math<br/>AGENT · Haiku · tryGeneralMath()<br/>in: question<br/>out: op + values  OR  'none'"]:::agent
  EX --> ISMATH{"is it math?<br/>FUNCTION"}:::dec
  ISMATH -->|"yes (op + values)"| ARITH["do the arithmetic<br/>FUNCTION · generalArithmetic() safe dispatcher, NO eval<br/>in: op + values<br/>out: EXACT number (NO citation — it's just math)"]:::fn
  ISMATH -->|"no"| TORAG(["not a calculation<br/>-> hand to RAG path"]):::term
  ARITH --> R1(["result: the number"]):::term

  %% ---- branch B: a calculator fits ----
  FIT -->|"yes"| FILL["extract the inputs<br/>AGENT · Haiku · fillSlots() · clarify.ts<br/>in: question + context + tool SCHEMA<br/>out: raw slot values (amounts copied VERBATIM)"]:::agent
  FILL --> VAL["validate + expand<br/>FUNCTION · validate() · clarify.ts<br/>in: raw values<br/>out: clean values (crore/lakh expanded IN CODE, not by Haiku)"]:::fn
  VAL --> STANCE["resolve last turn's assumptions<br/>FUNCTION · detectStance() regex + attribution rule (diagram 6)<br/>correction wins & consumes a 'nahi' · bare 'nahi' drops ALL assumed<br/>🔄 8c 2026-07-10"]:::fn
  STANCE --> MISS{"required slot missing?<br/>FUNCTION"}:::dec
  MISS -->|"yes"| PROP{"memory can pre-fill it?<br/>FUNCTION · proposeDefaults() (diagram 6)<br/>🔄 8c 2026-07-10"}:::dec
  PROP -->|"yes"| CONF["build the CONFIRMATION — confirm-not-ask<br/>FUNCTION · buildConfirmation() — NO LLM writes this<br/>out: shown assumptions + origin + only the true gaps<br/>calculator will NOT run until you confirm · pending SAVED<br/>🔄 8c 2026-07-10"]:::ask
  PROP -->|"no"| ASK["build the clarifying question — the ASK<br/>FUNCTION · buildClarification() — NO LLM writes this<br/>in: missing slots + their pre-written 'ask' text (registry.ts)<br/>out: ONE bundled question · pending SAVED (🔄 8c)"]:::ask
  MISS -->|"no"| CALC["run the calculator<br/>FUNCTION · calculators/index.ts<br/>in: clean values<br/>out: EXACT number + its OWN citations<br/>then: pending CLEARED + non-date slots saved as per-user defaults (🔄 8c)"]:::fn
  CONF --> R2
  ASK --> R2(["out: a question back to you"]):::term
  CALC --> R3(["out: cited answer + echoes your inputs"]):::term

  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
  classDef fix stroke:#ea580c,stroke-width:3px,stroke-dasharray:6 3;
  class RESUME,STANCE,PROP,CONF fix;
```

> **Your question, answered:** when no legal calculator fits, **Haiku does NOT do the math** — it only *extracts* `op + values` (e.g. `percent_of, [18, 50000]`); the actual number is computed by **`generalArithmetic` (FUNCTION, no `eval`)**. And if the model says it isn't a calculation at all → it drops to the **RAG path**. Extract (agent) and compute (code) are two separate boxes on purpose.
>
> **And the ASK is the same split:** `fillSlots` (AGENT) extracts + finds the missing inputs; `buildClarification` (FUNCTION) writes the question from the schema's pre-written phrases. **No LLM composes the question.**

---

## 3 · RATE lane — find the item, then the pre-cited rate

```mermaid
flowchart TD
  IN(["from router:<br/>'X ka gst kitna hai'"]):::term --> SYN

  SYN["match by synonym<br/>FUNCTION · findBySynonym() · rates/table.ts<br/>in: question words (English/Hindi)<br/>out: item OR nothing"]:::fn --> HIT{"matched?<br/>FUNCTION"}:::dec
  HIT -->|"no"| MODEL["ask the model to pick<br/>AGENT · Haiku · resolveItem()<br/>in: question + CLOSED item list<br/>out: one item OR 'none' (can't invent)"]:::agent
  HIT -->|"yes"| LOOK
  MODEL --> INTBL{"item in table?<br/>FUNCTION"}:::dec
  INTBL -->|"no"| MEMI{"profile knows what they sell?<br/>FUNCTION · getFact(sells) (diagram 6)<br/>🔄 8c 2026-07-10"}:::dec
  MEMI -->|"yes → resolve via profile"| CONFI["CONFIRM the item first — never state a rate off memory<br/>FUNCTION-built text · 'Aap footwear bechte hain (profile se) —<br/>footwear ka rate poochh rahe hain?'<br/>🔄 8c 2026-07-10"]:::ask
  MEMI -->|"no"| AB["honest abstain<br/>out: 'not in my rate table'"]:::term
  CONFI --> R0(["out: a question back to you"]):::term
  INTBL -->|"yes"| LOOK["look up the rate<br/>FUNCTION reads RATE_TABLE (data)<br/>in: item<br/>out: a flat rate OR 'rate depends on price'"]:::fn

  LOOK --> COND{"price-conditional?<br/>FUNCTION · footwear/apparel"}:::dec
  COND -->|"flat"| ANS["out: 'X% · Notification id · effective date' + source card"]:::term
  COND -->|"conditional"| SIDE["read which side of the price threshold<br/>AGENT · Haiku · resolveConditionSide()<br/>in: the conversation<br/>out: below / above / unknown (a QUANTITY is not a price)<br/>🔧 FIX 2026-07-10: parser strips markdown before matching —<br/>with long context the model answered '**below**' (bold) and the<br/>bare startsWith read it as unknown → the ask looped forever"]:::agent
  SIDE --> KNOWN{"price side known?<br/>FUNCTION"}:::dec
  KNOWN -->|"yes"| SAVE["remember the side as a per-user default<br/>FUNCTION · confirmFact('default:rate_lookup.item.side') (diagram 6)<br/>🔄 8c 2026-07-10"]:::fn
  SAVE --> ANS
  KNOWN -->|"no"| REMD{"remembered side default?<br/>FUNCTION · getDefault() (diagram 6)<br/>🔄 8c 2026-07-10"}:::dec
  REMD -->|"yes"| CONFS["CONFIRM the remembered side — shown with its date,<br/>never silently applied · 'pichhli baar ₹2500 tak bataya tha —<br/>is baar bhi wahi maanoon?'<br/>🔄 8c 2026-07-10"]:::ask
  REMD -->|"no"| ASK["ASK the price — clarification<br/>FUNCTION · returns the pre-written 'ask' from the rate table — NO LLM writes it<br/>out: 'per-pair price 2500 se kam ya zyada?'"]:::ask

  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
  classDef fix stroke:#ea580c,stroke-width:3px,stroke-dasharray:6 3;
  class SIDE,MEMI,CONFI,SAVE,REMD,CONFS fix;
```

---

## 4 · TIMELINE lane — change-over-time (bounded & honest)

```mermaid
flowchart TD
  IN(["from router:<br/>'footwear rate change in 6 months?'"]):::term --> WIN

  WIN["read the time window<br/>FUNCTION · parseWindowMonths() (regex)<br/>in: question<br/>out: N months (default 24)"]:::fn --> SEARCH["find dated documents<br/>FUNCTION + LIBRARY(Supabase)<br/>in: question<br/>out: notifications/circulars with a release date"]:::fn
  SEARCH --> SEED["add the rate-table anchor<br/>FUNCTION<br/>in: item<br/>out: + its governing notification (dated)"]:::fn
  SEED --> COUNT{"how many DATED docs in the window?<br/>FUNCTION"}:::dec

  COUNT -->|">= 2"| TL["out: TIMELINE — dates + citations, old to new<br/>(the ONLY case it may claim a 'change')"]:::term
  COUNT -->|"exactly 1"| ONE["out: 'just this one doc'"]:::term
  COUNT -->|"0, but topic held"| NC["out: 'no change in that window' + latest doc"]:::term
  COUNT -->|"none"| INS["out: abstain — won't fabricate a timeline"]:::term

  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
```

---

## 5 · RAG path + gates — grounded answer, checked at each step

```mermaid
flowchart TD
  IN(["from router:<br/>a how-to / eligibility question"]):::term --> TR

  TR["rewrite for search<br/>AGENT · Haiku · transformQuery() · transform.ts<br/>in: question (Hinglish ok)<br/>out: English rewrite + HyDE (a fake answer to search with)"]:::agent --> SEARCH["hybrid search<br/>FUNCTION + LIBRARY<br/>in: rewrite + HyDE<br/>out: TOP 8 chunks (dense bge-m3 + keyword, fused RRF k=60)"]:::fn
  SEARCH --> G2{"G2 · relevance floor<br/>FUNCTION · best cosine >= 0.45?"}:::dec
  G2 -->|"no"| AB["abstain — no real source"]:::term
  G2 -->|"yes"| GEN["write the cited answer<br/>AGENT · Sonnet · generate() · answer.ts<br/>in: 8 chunks + question<br/>out: draft with [tags] (may call calculator tools)"]:::agent

  GEN --> G4{"G4 · citation gate<br/>FUNCTION · verify-citations.ts<br/>every [tag] real? every claim tagged?"}:::dec
  G4 -->|"fail"| REGEN["regenerate once (named errors)<br/>AGENT · Sonnet<br/>in: draft + errors · out: fixed draft"]:::agent
  REGEN --> PRUNE["drop the bad sentence<br/>FUNCTION · pruneUngrounded()<br/>in: draft · out: draft minus untagged/fake-cited sentences"]:::fn
  G4 -->|"pass"| G3
  PRUNE --> G3{"G3 · recompute<br/>FUNCTION · g3-recompute.ts<br/>every number in a cited source/tool output?"}:::dec

  G3 -->|"fail"| RETRY["retry once, else abstain"]:::term
  G3 -->|"ok"| RS["warm rewrite<br/>AGENT · Haiku · reply synth · pipeline.ts<br/>in: approved draft<br/>out: friendly reply (keeps every tag + number)"]:::agent
  RS --> G5{"G5 · claim-check<br/>AGENT · Haiku · reply adds NO new claim vs draft?"}:::dec
  G5 -->|"pass"| OUTP(["out: cited answer"]):::term
  G5 -->|"fail"| SHIP["ship the safe approved draft instead"]:::term

  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
```

---

## 6 · MEMORY (Phase 8c) — three types, one non-negotiable rule

> **The three memory types, kept distinct:** **WORKING** = this thread's live slot-gather, persisted as one `pending` object on the thread (resume, don't re-derive). **BEHAVIORAL** = durable facts about *you* (sells, state, platforms, turnover band), model-extracted after each turn at LOW confidence. **PROCEDURAL** = defaults *you confirmed* ("late fee" → monthly GSTR-3B), written only when a calculation actually runs or you say "haan".
>
> **The non-negotiable rule:** memory sets DEFAULTS and CONTEXT — it never silently drives a rate, a number, or an eligibility answer. Any remembered fact that would change one is SHOWN with its origin ("aapne pichhli baar confirm kiya tha, 2026-07-10") and CONFIRMED before the calculator runs. The confirmation UX *is* the verification: confirm → confidence rises to 0.9; correct → the fact is fixed; ignore for 60 days → confidence halves (decay) and it gets re-asked instead of assumed.
>
> **Who writes what:** the only AGENT in this flow is the extractor (closed key set, code validates). Proposing defaults (`prefill.ts`), building the confirmation (`buildConfirmation`), reading your "haan/nahi" (`detectStance`, a regex), and writing defaults are all FUNCTIONS — no LLM ever invents a memory key, composes the confirmation text, or decides that an assumption was accepted.

```mermaid
%% see docs/mermaid/06-memory.mmd (rendered live in /admin/architecture)
flowchart TD
  U(["YOU (signed in): 'late fee kitni hogi?'"]):::term --> LOAD
  LOAD["LOAD MEMORY<br/>FUNCTION · route.ts + lib/memory/store.ts<br/>in: userId + threadId<br/>out: profile+facts (post-DECAY confidence) + thread PENDING"]:::fn --> INJ
  PROFDB[("gstpilot_user_profile<br/>DATA · email, sells, state")]:::data -.-> LOAD
  MEMDB[("gstpilot_user_memory<br/>DATA · fact, value, confidence,<br/>provenance, as_of, last_confirmed, kind")]:::data -.-> LOAD
  THRDB[("gstpilot_threads.pending<br/>DATA · WORKING memory: {tool, values,<br/>assumed, missing, rejected}")]:::data -.-> LOAD
  INJ["INJECT (3 places)<br/>FUNCTION · pipeline.ts<br/>1 intake context · 2 retrieval-rewrite hint · 3 slot pre-fill<br/>header forbids using memory as a legal source"]:::fn --> RESUME{"fresh pending<br/>on this thread?<br/>FUNCTION · isFresh (6h TTL)"}:::dec
  RESUME -->|"yes — you're answering our last ask"| MERGE["MERGE working memory<br/>FUNCTION · calculation.ts<br/>in: pending.values + THIS turn's fillSlots extraction<br/>out: values (your words this turn always win)"]:::fn
  RESUME -->|"no — a fresh question"| FILL["fillSlots (Phase 8b)<br/>AGENT · Haiku · clarify.ts<br/>extracts ONLY what YOU stated"]:::agent --> MERGE
  MERGE --> STANCE{"assumptions shown<br/>last turn?<br/>FUNCTION · detectStance (regex)"}:::dec
  STANCE -->|"corrected: 'nahi, nil tha'<br/>your value wins"| GRAD["GRADUATE / DROP<br/>FUNCTION · negation consumed by an explicit correction →<br/>untouched assumptions keep implicit consent;<br/>bare 'nahi' → ALL drop, asked cold, never re-proposed"]:::fn
  STANCE -->|"'haan' / answered the gaps<br/>(implicit consent)"| GRAD
  STANCE -->|"no assumptions pending"| MISS
  GRAD --> MISS{"required slots<br/>still missing?<br/>FUNCTION"}:::dec
  MISS -->|"yes → consult memory"| PROP["proposeDefaults<br/>FUNCTION · lib/memory/prefill.ts (NO model)<br/>in: missing slots + facts above CONF_USABLE 0.25<br/>out: ASSUMED values, each with its origin ('why')"]:::fn
  PROP -->|"something to propose"| CONF["CONFIRMATION — confirm-not-ask<br/>FUNCTION · buildConfirmation()<br/>shows every assumption + origin + date, asks 'sahi hai?'<br/>+ only the genuinely unknown slots<br/>GATE: calculator does NOT run on unconfirmed assumptions"]:::ask
  PROP -->|"nothing usable"| COLD["COLD ASK (Phase 8b)<br/>FUNCTION · buildClarification()"]:::ask
  CONF --> SAVEP["SAVE pending<br/>FUNCTION · route.ts<br/>out: thread.pending = {values, assumed, missing, rejected}"]:::fn
  COLD --> SAVEP
  SAVEP -.->|"your NEXT message re-enters at LOAD"| U
  MISS -->|"no → everything known & confirmed"| CALC["COMPUTE<br/>FUNCTION · calculators (deterministic, pre-cited)<br/>out: exact figure + citations · thread.pending CLEARED"]:::fn
  CALC --> LEARN["rememberAllDefaults<br/>FUNCTION · every non-date slot → kind=default,<br/>confidence 0.9, last_confirmed=now (decay clock restarts)"]:::fn
  LEARN -.-> MEMDB
  CALC --> DONE(["cited answer in your chat"]):::term
  DONE --> MEMX["MEMORY EXTRACT (after reply)<br/>AGENT · Haiku · lib/memory/extract.ts<br/>in: the exchange · out: durable facts, CLOSED set<br/>(sells/state/platforms/turnover_band/filing_frequency/observation:*)<br/>code validates keys; confidence starts 0.4; same value reinforces +0.1"]:::agent
  MEMX -.-> MEMDB
  PANEL["'JO MUJHE YAAD HAI' PANEL · /memory<br/>FUNCTION · view / edit (= confirm, 0.9) / DELETE<br/>shows post-decay % and 'as of' dates<br/>decay: confidence halves every 60 days unconfirmed"]:::fn
  MEMDB -.-> PANEL
  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
  classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

---

## 7 · The gates at a glance (safety spine)

| Gate | File | Actor | Threshold / check | On fail |
|---|---|---|---|---|
| **G1** schema | `intake.ts` | LIBRARY · zod | intake JSON valid + enums | re-ask; malformed x2 → T3 |
| **serviceError** | `intake.ts` | FUNCTION | transient (429/5xx/net) vs parse | honest "try again" |
| **T3 tier** | `pipeline.ts` | FUNCTION | is it a dispute? | escalate to CA |
| **G2** floor | `pipeline.ts` | FUNCTION | best cosine **≥ 0.45** | abstain |
| **G4** citation | `verify-citations.ts` | FUNCTION | every claim cites a REAL retrieved source | regen → prune |
| **prune** | `verify-citations.ts` | FUNCTION | drop bad sentence, keep cited rest | abstain if nothing left |
| **G3** recompute | `g3-recompute.ts` | FUNCTION | every number in a cited source/tool | retry → abstain |
| **G5** claim-check | `pipeline.ts` | AGENT · Haiku | reply adds no new claim | ship approved draft |

**Models:** Haiku = intake · transform · fillSlots · rate-resolve · reply/G5 · memory-extract (after reply). Sonnet = only the RAG generation. Embeddings = `bge-m3` (local, 1024-dim).

## 8 · File index

| Stage | File |
|---|---|
| API + memory + SSE | `app/api/ask/route.ts` |
| Sign-up (email-as-id) | `app/api/user/route.ts` |
| Memory panel API + UI | `app/api/memory/route.ts` · `app/memory/page.tsx` |
| Working memory (pending) | `lib/memory/working.ts` |
| Durable memory store + decay | `lib/memory/store.ts` |
| Memory extraction (agent) | `lib/memory/extract.ts` |
| Slot pre-fill (memory→slots) | `lib/memory/prefill.ts` |
| Orchestrator (spine) | `lib/agents/pipeline.ts` |
| Intake + G1 + serviceError | `lib/agents/intake.ts` |
| Router + lane taxonomy | `lib/agents/lanes.ts` |
| ASK move (clarify) | `lib/agents/clarify.ts` |
| Tool schemas | `lib/tools/registry.ts` |
| Lanes | `lib/agents/lanes/{calculation,rate,timeline}.ts` |
| Rate data + lookup | `lib/rates/{table,lookup}.ts` |
| Calculators | `lib/calculators/index.ts` |
| RAG generation | `lib/agents/answer.ts` |
| Retrieval (Hinglish rewrite) | `lib/retrieval/{transform,search,embed,config}.ts` |
| Gates | `lib/gates/{verify-citations,g3-recompute}.ts` |
| Observability | `lib/observability/langfuse.ts` |
</content>


## 7 · Account boundaries and historical filing (2026-10-01)

The filing action is separate from general chat: one field extraction then the existing deterministic formula. The server-owned prepared example shares calculation and persistence without a provider call. Only the reviewed January 2022 GSTR-3B illustration is supported; it does not establish current liability. Provider names shown in older detailed diagrams denote their original roles; runtime selection is centralized in `lib/providers/client.ts`.

```mermaid
flowchart TD
  USER(["YOU: sign in or create an account"]):::term --> AUTH["ACCOUNT<br/>FUNCTION · Auth.js Credentials + bcrypt<br/>in: email and password<br/>out: signed cookie + revocable PostgreSQL session"]:::fn
  AUTH --> UI["WORKSPACE<br/>FUNCTION · AccountShell + owner generation<br/>in: verified account<br/>out: restored own conversations and memory"]:::fn
  UI --> CHOICE{"Choose an action"}:::dec
  CHOICE -->|Chat| CHAT["EXISTING CHAT PIPELINE<br/>intake, lane routing, citations, clarification<br/>confirmed memory and professional handoff<br/>see diagrams 1–6"]:::fn
  CHOICE -->|Filing analysis| FACTS["EDITABLE FACTS<br/>January 2022 GSTR-3B only<br/>user supplies due date and filing date"]:::fn
  CHOICE -->|Try with an example| SAMPLE["PREPARED EXAMPLE<br/>FUNCTION · server canonical ID<br/>fixed historical facts + validated slots<br/>no provider dispatch, even in live mode"]:::fn
  FACTS --> GUARD["REQUEST BOUNDARY<br/>FUNCTION · actor + expected owner + CSRF<br/>body, usage and capacity bounds"]:::fn
  GUARD --> EXTRACT["FIELD EXTRACTION<br/>AGENT · configured provider, one bounded call<br/>out: candidate inputs, not arithmetic"]:::agent
  EXTRACT --> CHECK{"FUNCTION · validate inputs + historical scope<br/>explicit supplied ISO dates, period, return and turnover"}:::dec
  SAMPLE --> CHECK
  CHECK -->|Missing or unsupported| LIMIT["CLARIFY OR STATE THE LIMIT<br/>FUNCTION · no extra model request"]:::term
  CHECK -->|Supported| CALC["HISTORICAL FORMULA<br/>FUNCTION · existing gstrLateFee<br/>out: days, daily fee, cap and illustrative amount"]:::fn
  CALC --> SAVE["SAVE AND STREAM<br/>FUNCTION · own thread + messages + inputs + sources<br/>prepared provenance remains permanent"]:::fn
  LIMIT --> SAVE
  SAVE --> VIEW["RESULT<br/>historical illustration + inputs and calculation<br/>official source links + owner feedback<br/>not a verified current liability or filing submission"]:::term
  VIEW --> EDIT["Analyze your own facts<br/>new ordinary draft; no silent sample-to-paid switch"]:::fn
  EDIT --> FACTS
  UI --> EXP["ACCOUNT CHANGE OR EXPIRY<br/>FUNCTION · abort and reject old JSON/SSE<br/>clear visible workspace before refreshing session"]:::fn
  DB[("PostgreSQL<br/>users, sessions, owner-bound conversations/memory<br/>usage ledger and limited read-only corpus")]:::data
  AUTH -.-> DB
  SAVE -.-> DB
  CHAT -.-> DB
  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
  classDef fix stroke:#ea580c,stroke-width:3px,stroke-dasharray:6 3;
  class AUTH,UI,GUARD,EXTRACT,CHECK,SAMPLE,SAVE,EXP fix;
```
