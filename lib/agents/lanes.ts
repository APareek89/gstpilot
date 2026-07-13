// THE LANES — the question TYPES the router sorts every question into. The old pipeline was
// one rigid pipe (retrieve → generate → gate) that treated a rate lookup, a money calculation
// and a "how do I…" identically. Different question types want different machinery: a rate is
// a FACT you look up, a late fee is a CALCULATION you run, a procedure is a PASSAGE you cite,
// a "has this changed?" is a TIMELINE you sort. Naming the lanes is step one; routing to the
// right handler (and asking for inputs when a lane needs them) is what kills wrongful
// abstentions. This file holds only the vocabulary + the guidance the classifier reads —
// the handlers live per-lane, and the router lives in pipeline.ts.

import type { PendingState } from "../memory/working";
import type { MemoryBundle } from "../memory/store";

// What every lane handler returns to the pipeline. `mode` is a short free-text tag for the
// trajectory ("compute", "ask-condition", "flat", …); `citationIds` feed the SOURCES panel;
// `abstained` is true ONLY for an honest "I can't answer" — an ASK/offer is NOT an abstention.
// `pending` (Phase 8c) is the lane's instruction about the thread's WORKING MEMORY: an object =
// persist this gather-in-progress, null = clear it (done/abandoned), undefined = leave it alone.
export type LaneOutcome = {
  reply: string;
  abstained: boolean;
  mode: string;
  citationIds: string[];
  note: string;
  pending?: PendingState | null;
};

// What the pipeline hands each lane beyond the question (Phase 8c): the user's durable memory,
// the thread's persisted working memory, and the ids needed to write memories back. All
// optional — every lane must work exactly as before for an anonymous user with none of these.
export type LaneExtras = {
  memory?: MemoryBundle | null;
  pending?: PendingState | null;
  threadId?: string;
  userId?: string;
};

export const LANES = [
  "rate_lookup",       // the GST %/rate/exemption for a specific good or service
  "calculation",       // compute THIS user's money or deadline (late fee, interest, a figure)
  "procedure",         // how the law works — process, definitions, documents, general "how do I…"
  "eligibility",       // a yes/no threshold or eligibility check (must I register? composition?)
  "change_over_time",  // did/how something CHANGED over a time window
  "guidance",          // practical how-to/drafting help — what to write in a field, a sample
                       // description, a format. Common practice, not a legal provision: answered
                       // directly with a disclaimer, HARD-barred from stating rates/amounts/dates.
  "escalate",          // a live or threatened dispute — belongs with a CA (mirrors tier T3)
  "out_of_scope",      // not answerable from CGST/IGST law in our corpus
] as const;
export type Lane = (typeof LANES)[number];

// The guidance block injected into the intake prompt so ONE model call classifies intent,
// tier AND lane together. Written as short discriminating rules — the classifier picks the
// lane whose trigger fits, defaulting to `procedure` when a question is explanatory rather
// than a lookup/calc/timeline. Kept terse on purpose: long taxonomies make small models waffle.
export const LANE_GUIDE = `Also classify the question's LANE (its type), one of ${JSON.stringify(LANES)}:
- rate_lookup: asks the GST rate / % / exemption for a specific product or service ("edible oil ka rate", "footwear GST %").
- calculation: needs a number computed for THIS user — a late fee, interest on delay, a refund amount, or arithmetic on figures they give.
- change_over_time: asks whether or how something CHANGED over a period ("has the footwear rate changed", "rate changes in last 6 months").
- eligibility: a yes/no threshold or eligibility check ("do I have to register?", "am I eligible for composition?").
- procedure: how the law works in general — a process, a definition, documents, a "how do I…". Use this when it's explanatory, not a lookup/calc/timeline.
- guidance: ONLY drafting/wording help — what to WRITE in a field, a sample product/invoice description, wording of an example ("description mein kya likhun?", "ek sample de do"). Pair with intent "general_guidance"; do NOT call these out_of_scope. NOT for government processes or legal requirements — "how do I get a refund/register/file/claim ITC" is procedure (the law answers it), not guidance.
- escalate: a live or threatened dispute (notice, penalty, seizure, appeal) — same trigger as tier T3.
- out_of_scope: not GST law in our corpus (income tax, customs, state SGST act sections).`;

// reconcileLane — a deterministic guard over the model's lane pick. The classifier reliably
// nails the INTENT ("late_fee_interest") but wavers on the LANE for generally-phrased questions
// ("what is the late fee for GST filing" → it says procedure, not calculation). Where an intent
// unambiguously implies a lane WE can serve better, the intent wins — because the calculation
// lane's "general rule + offer to compute" path handles the general phrasing at least as well
// as procedure/RAG, and (unlike RAG today) never force-abstains. Model proposes, code corrects.
// Substantive-law signals: a question carrying one of these is about what the LAW provides — it
// must ride a grounded lane, never the uncited guidance lane, whatever the classifier said.
const SUBSTANTIVE = /\brefund\b|\bregist(er|ration)\b|\bitc\b|input tax credit|e-?way|\bcomposition\b|\btcs\b|late fee|\binterest\b|\bpenalt|notice|appeal|\bexempt/i;

export function reconcileLane(intent: string, modelLane: Lane, question?: string): Lane {
  // GUIDANCE GUARD (deterministic, two layers): the guidance lane answers UNCITED, so it is only
  // allowed for pure drafting/wording help. (a) A substantive INTENT in the guidance lane →
  // grounded procedure. (b) Even with intent general_guidance, a substantive KEYWORD in the
  // question ("how do i get a GST refund" was classified general_guidance live) → grounded
  // procedure. Model proposes, code corrects — losing citations is never worth a warmer tone.
  if (modelLane === "guidance" && (intent !== "general_guidance" || (question && SUBSTANTIVE.test(question)))) {
    return "procedure";
  }
  // TRUST a specific, actionable model pick. The classifier only wavers on the weak defaults
  // (procedure/eligibility/any); when it commits to calculation/rate_lookup/change_over_time it
  // read the question shape well — an intent override here would break correct picks (e.g. a
  // general-math question the model rightly called `calculation`).
  if (["calculation", "rate_lookup", "change_over_time"].includes(modelLane)) return modelLane;
  // Otherwise, let a strong intent pull a vaguely-classified question into the right lane.
  if (intent === "late_fee_interest") return "calculation";
  if (intent === "rate_lookup") return "rate_lookup";
  if (intent === "registration") return "calculation"; // handled by the registration_threshold tool
  if (intent === "general_guidance") return "guidance"; // practical help never belongs in out_of_scope
  return modelLane;
}

// pickCalcTool — for a calculation-lane question, choose which registered tool it wants.
// Keyword/intent rules, not a model call — cheap, and easy to read when it picks wrong.
// registration questions → the threshold check; interest words → the s50 tool; else late fee.
export function pickCalcTool(question: string, context?: string, intent?: string): "gstr_late_fee" | "delayed_payment_interest" | "registration_threshold" {
  const t = `${context ?? ""} ${question}`.toLowerCase();
  if (intent === "registration" || /\bregister\b|registration|gstin|gst number|threshold|turnover limit/.test(t)) return "registration_threshold";
  if (/\binterest\b|section\s*50|s50\b|delayed payment|byaaj|byaj/.test(t)) return "delayed_payment_interest";
  return "gstr_late_fee";
}
