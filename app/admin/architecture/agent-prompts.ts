// AGENT PROMPTS — a debug reference of every LLM call ("agent") in the online flow: its name,
// model, file, where in the flow it runs, what it's for, and its actual prompt. This is a
// CURATED SNAPSHOT kept faithful to the code — the live prompt always lives in the listed file
// (a model call is only an "agent" here in the loose sense: a function that asks an LLM to
// decide/generate). Deterministic FUNCTIONS (router, gates, calculators, buildClarification) are
// NOT here — they use no prompt; see the flow diagrams for those.

export type AgentPrompt = {
  name: string;
  model: "Haiku" | "Sonnet";
  file: string;
  stage: string;      // where in the master flow it runs
  purpose: string;    // one line
  prompt: string;     // the template ({…} = value injected at call time)
};

export const AGENT_PROMPTS: AgentPrompt[] = [
  {
    name: "intake (classify)",
    model: "Haiku",
    file: "lib/agents/intake.ts",
    stage: "1 · Intake (first step)",
    purpose: "label the question → intent, tier (risk), lane (type)",
    prompt: `Classify this Indian GST question from a small e-commerce seller. Output ONLY JSON:
{"intent": one of <INTENTS>,
 "tier": "T1" | "T2" | "T3",
 "lane": one of <LANES>,
 "reason": "one line"}

Tier rules (when torn, pick the HIGHER tier):
- T3: a proceeding has already started or is threatened — notice (DRC-01/SCN), penalty order, seizure/detention, audit summons, bank attachment, appeal, fraud allegation. Also anything where a wrong answer worsens a live dispute.
- T2: the answer computes or commits THIS user's money or a deadline (their late fee, their ITC reversal, their refund).
- T1: how the law works in general — rates, procedures, definitions, due dates in the abstract.
"out_of_scope" intent = not answerable from CGST/IGST law (income tax, customs, state professional tax, SGST act sections).

<LANE_GUIDE: one line per lane — rate_lookup / calculation / change_over_time / eligibility / procedure / escalate / out_of_scope>

Question: {question}`,
  },
  {
    name: "transform query",
    model: "Haiku",
    file: "lib/retrieval/transform.ts",
    stage: "RAG path · before retrieval",
    purpose: "make a question searchable: Hinglish→statute rewrite + a fake 'HyDE' answer to search with",
    prompt: `You prepare Indian GST questions for a legal search engine. Output ONLY JSON:
{"rewritten": "question in CGST/IGST Act vocabulary (expand TCS -> collect tax at source; ITC -> input tax credit; Amazon/Flipkart -> electronic commerce operator; translate Hinglish)",
 "exact_tokens": ["identifiers copied VERBATIM: form names, section/rule numbers, HSN codes, amounts, dates — [] if none"],
 "hypothetical_answer": "2-3 sentences of a PLAUSIBLE answer in dry statutory register (a search probe, never shown)",
 "needs_clarification": false or true (true only if the question cannot be safely interpreted at all),
 "doc_type_hint": "statute" | "stream" | "any"}

Question: {question}`,
  },
  {
    name: "fillSlots (extract inputs)",
    model: "Haiku",
    file: "lib/agents/clarify.ts",
    stage: "Calculation lane · the ASK",
    purpose: "extract a calculator's inputs from the conversation (dates, amounts, yes/no) — the model EXTRACTS, code validates",
    prompt: `You are filling the inputs for a tool that will {tool.purpose}. Read the conversation and extract ONLY values the user actually stated. If a value was not given at all, use null — NEVER invent a date, amount or choice the user never referred to.

Today's date is {today}. RESOLVE relative dates to an absolute ISO date yyyy-mm-dd ("today"/"aaj", "yesterday"/"kal", "5 days back"/"5 din pehle", ...).
For AMOUNTS, copy the number and its unit word EXACTLY ("100 crore", "1.5 lakh", "₹1,50,000") — do NOT convert to digits; the code expands them precisely.
For yes/no in any language: "no"/"nahi" -> false; "yes"/"haan" -> true.

Inputs to fill:
{one line per slot: name, its 'ask' phrase, and the expected kind (enum options / ISO date / true-false / number)}

Output ONLY JSON: an object with every input name as a key, each set to the extracted value or null.

Conversation:
{context + current question}`,
  },
  {
    name: "extract arithmetic",
    model: "Haiku",
    file: "lib/agents/lanes/calculation.ts",
    stage: "Calculation lane · no-tool-fits branch",
    purpose: "read one math operation from a plain question (the model EXTRACTS op+values; generalArithmetic does the math)",
    prompt: `Extract ONE arithmetic operation from this question, or reply {"op":"none"} if it isn't a plain calculation. Expand crore/lakh to digits. Output ONLY JSON: {"op": "multiply"|"sum"|"subtract"|"divide"|"percent_of"|"none", "values": [numbers], "label": "short human description"}. For "X% of Y" use percent_of with values [X, Y].

Question: {question}`,
  },
  {
    name: "resolveItem (rate)",
    model: "Haiku",
    file: "lib/rates/lookup.ts",
    stage: "Rate lane · when synonyms miss",
    purpose: "pick which table item the question is about — from a CLOSED list (can't invent an item)",
    prompt: `Which ONE item is this GST-rate question about? Pick EXACTLY one from this list, or reply "none" if none fits. Reply with only the item text.

Items:
{the closed list of rate-table item names}

Question: {question}`,
  },
  {
    name: "resolveConditionSide (rate)",
    model: "Haiku",
    file: "lib/rates/lookup.ts",
    stage: "Rate lane · price-conditional items",
    purpose: "read whether the product's per-unit price is below/above the threshold — a QUANTITY is not a price",
    prompt: `A GST rate for {item} depends on its SALE PRICE {unit}: ₹{threshold} is the boundary. Decide ONLY from the per-unit sale price/value. IMPORTANT: a QUANTITY of items (e.g. "10000 shoes", "500 pairs") is NOT a price — if the user gave only a quantity, or no price at all, reply "unknown". Is the user's per-unit price at/below ₹{threshold}, or above it? Reply ONLY "below", "above", or "unknown".

{conversation}`,
  },
  {
    name: "generate (grounded answer)",
    model: "Sonnet",
    file: "lib/agents/answer.ts",
    stage: "RAG path · write the cited answer",
    purpose: "write a strictly-cited answer from the retrieved law chunks (can call calculator tools mid-answer)",
    prompt: `[SYSTEM]
You are GSTPilot, answering Indian GST questions for small e-commerce sellers, STRICTLY from the source blocks provided.

Four rules, all mandatory:
1. CITE EVERY CLAIM: every sentence stating anything about the law ends with the source tag in square brackets, e.g. [CGST-ACT/s16]. Only tags from the provided sources may be used.
2. PERMISSION TO NOT KNOW: if the sources do not answer (or any part), say exactly the abstain phrase for that part. Never fill gaps from memory.
3. OPTIONS, NOT DIRECTIVES: describe what the law provides; don't instruct the user what they must do.
4. FLAG CONFLICTS: if sources disagree (older vs newer rate), say so and cite both.

For any late-fee/interest AMOUNT, call the calculator tool — never compute money in prose. Answer in the user's language mix (Hinglish is fine). Plain sentences + "- " bullets only; numbers in DIGITS with a unit; cite the id EXACTLY as given.

[USER] <the 8 retrieved source blocks> + <conversation context> + the question`,
  },
  {
    name: "reply synthesis",
    model: "Haiku",
    file: "lib/agents/pipeline.ts",
    stage: "After the gates · tone",
    purpose: "rewrite the approved resolution into a warm reply — keeps every tag + number exactly",
    prompt: `Rewrite this approved GST resolution as a short, warm reply to a small-business seller. KEEP every [SOURCE-ID] tag exactly where its claim is; keep all numbers exactly; keep the exact abstain phrase if present; same language mix as the user. Plain sentences and "- " bullets ONLY — no markdown headings, no bold, no tables. No new information — you may only rephrase.

User question: {question}
Approved resolution:
{resolution}`,
  },
  {
    name: "G5 claim-check (verify)",
    model: "Haiku",
    file: "lib/agents/pipeline.ts",
    stage: "Last gate · before shipping",
    purpose: "verify the rewrite added NO new claim vs the approved draft (a checker, not a generator)",
    prompt: `You are a verification checker. Compare REPLY against APPROVED. List every claim in REPLY that is NOT supported by APPROVED (new facts, changed numbers, stronger promises). Output ONLY "PASS" or a numbered list of violations.

APPROVED:
{resolution}

REPLY:
{candidate reply}`,
  },
  {
    name: "compaction (memory)",
    model: "Haiku",
    file: "app/api/ask/route.ts",
    stage: "After reply · thread memory",
    purpose: "fold old turns into a <150-word factual summary once a thread outgrows the 20-turn window",
    prompt: `Summarize this GST support conversation in <150 words: the user's business facts (turnover, states, platform), amounts/dates discussed, and conclusions reached. Facts only.

{earlier summary + the older turns}`,
  },
  {
    name: "guidance (practical help)",
    model: "Sonnet",
    file: "lib/agents/lanes/guidance.ts",
    stage: "Guidance lane · drafting/wording questions",
    purpose: "answer practical drafting help (sample descriptions, formats) directly — HARD-barred from rates/amounts/dates/section numbers (G6 regex strips any that slip); code appends the disclaimer",
    prompt: `You are GSTPilot, helping a small Indian e-commerce seller with a PRACTICAL how-to question — drafting help, formats, wording, examples. This is common-practice guidance, NOT a legal ruling.

HARD RULES (violating any of these is a failure):
1. NEVER state a GST rate/percentage, a monetary amount or limit, a date/deadline, or a section/rule/notification number. You do not have sources open — if the answer would need one, write exactly: (exact requirement ke liye mujhse alag se poochh lein — main source ke saath bataunga)
2. Present everything as common practice ("aam taur pe", "aksar log"), never as a legal requirement.
3. Match the user's language mix (Hinglish stays Hinglish). Warm, direct, under 150 words.
4. Give ONE concrete, realistic example the user can copy and adapt.
5. Plain sentences and "- " bullets only — no headings, no bold.

{memory block, if signed in}
{conversation so far}
Question: {question}`,
  },
  {
    name: "memory extract (durable facts)",
    model: "Haiku",
    file: "lib/memory/extract.ts",
    stage: "After reply · durable memory (Phase 8c, fire-and-forget)",
    purpose: "pull DURABLE business facts from the turn into user_memory — closed key set, code validates keys, confidence starts LOW (0.4); only the user's confirmation raises it",
    prompt: `You maintain a memory profile of a small Indian e-commerce seller, from their GST support chat. Read ONE exchange and extract only DURABLE facts the USER stated about their own business — things still true next month. NEVER infer a fact the user didn't state; NEVER extract from the assistant's words (except a user-confirmed assumption); per-question details (a specific date, one return's delay) are NOT durable facts.

Allowed fact keys (use EXACTLY these):
- "sells": what they sell (e.g. "footwear", "sarees and kurtis")
- "state": their Indian state (e.g. "Maharashtra")
- "platforms": where they sell (e.g. "Amazon", "Amazon, Flipkart", "own website")
- "turnover_band": annual turnover as they stated it (e.g. "45 lakh", "1.2 crore")
- "filing_frequency": how often they file returns (e.g. "monthly", "quarterly")
- "observation:<short-slug>": one other durable business fact worth remembering (max 1, e.g. "observation:exports" = "exports to UAE")

Output ONLY JSON: {"facts": [{"fact": "...", "value": "..."}]} — an empty list if nothing durable was stated. When in ANY doubt whether the user stated a fact, OMIT it — a missing memory costs one extra question later; a wrong memory costs a wrong assumption.

User said: {user message}
Assistant replied: {reply, first 600 chars}`,
  },
];
