// THE CALCULATION LANE — the first lane to use the third move (ASK) end-to-end.
// A calculation question ("what late fee will I owe?") needs specific inputs; the old pipe
// had none, so it abstained. This lane instead: picks the right calculator, extracts its
// inputs from the conversation, and branches three ways —
//   • all inputs present  → run the calculator and return the EXACT, pre-cited number;
//   • inputs missing      → give the general cited RULE via retrieval, THEN offer to compute
//                           the exact figure once the user supplies the gaps (never a dead-end);
//   • GSTR-9 late fee     → our calculator only covers GSTR-3B/GSTR-1, so hand that to the
//                           general rule path honestly rather than compute the wrong rule.
// The exact-number path is deterministic and carries the calculator's own legal-basis citations
// (like every "model proposes, code disposes" tool), so it is grounded without touching the gate.

import Anthropic from "@anthropic-ai/sdk";
import { fillSlots, buildClarification, buildConfirmation } from "../clarify";
import { pickCalcTool, type LaneOutcome, type LaneExtras } from "../lanes";
import { TOOL_SPECS } from "../../tools/registry";
import { gstrLateFee, delayedPaymentInterest, registrationThreshold, generalArithmetic } from "../../calculators";
import { answerQuestion } from "../answer";
import { isFresh, detectStance, type PendingState, type SlotValue } from "../../memory/working";
import { proposeDefaults } from "../../memory/prefill";
import { confirmFact } from "../../memory/store";
import { recordGeneration, type LfParent } from "../../observability/langfuse";

// runCalculationLane — the whole lane. `context` is the earlier conversation (so a follow-up
// "GSTR-3B, due 20 Jan, filed 5 Feb, no, 40 lakh" fills the slots the first turn asked for).
// `intent` steers tool choice (registration questions → the threshold check).
// Phase 8c adds `extras`: durable memory (to PROPOSE defaults) and the thread's pending
// working-memory object (to RESUME a half-finished gather instead of re-deriving it).
export async function runCalculationLane(question: string, context?: string, intent?: string, parent?: LfParent, extras?: LaneExtras): Promise<LaneOutcome> {
  // RESUME: a fresh pending object means the last assistant turn was our own ask/confirmation —
  // this message is (almost certainly) the user answering it, so we stay on the SAME tool.
  const resuming = isFresh(extras?.pending) ? extras!.pending! : null;
  const toolName = resuming && resuming.tool in TOOL_SPECS
    ? (resuming.tool as keyof typeof TOOL_SPECS & string)
    : pickCalcTool(question, context, intent);

  // Fit-check: pickCalcTool always returns SOME legal calculator, but a calculation-lane question
  // may be plain arithmetic ("2 lakh ka 18% kitna") that fits none of them. Don't ask for late-fee
  // dates in that case — do the arithmetic (gate-free: it's math on the user's own numbers, not a
  // claim about the law), and if even that doesn't apply, hand off to the grounded RAG path.
  // (Skipped when resuming — mid-gather replies like "20 Jan, 5 Feb" match no tool keywords.)
  if (!resuming && !toolFits(toolName, question, context, intent)) {
    const math = await tryGeneralMath(question, context, parent);
    if (math) return math;
    const rag = await answerQuestion(question, undefined, context, parent);
    return { reply: rag.answer, abstained: rag.abstained, mode: "rag-fallback", citationIds: rag.citations, note: "no calculator fit → RAG" };
  }

  const spec = TOOL_SPECS[toolName];
  const { values: extracted } = await fillSlots(spec, question, context, parent);

  // Merge working memory: slots gathered in EARLIER turns carry over; anything the user said
  // THIS turn wins (a correction beats a stored value, always).
  const values: Record<string, SlotValue> = { ...(resuming?.values ?? {}), ...extracted };
  const rejected = new Set(resuming?.rejected ?? []);

  // Resolve the assumptions we showed last turn. Deterministic, in code (the trust boundary):
  //   • the user restated the slot explicitly → their value already won via `extracted`, and
  //     that counts as a confirmation of the corrected value;
  //   • the user affirmed ("haan sahi hai") or simply answered the remaining questions
  //     (implicit consent — they SAW the assumptions and moved on) → assumption graduates;
  //   • the user pushed back ("nahi…") → uncorrected assumptions are dropped and re-asked
  //     cold, and we do NOT re-propose them this thread.
  // Every graduated slot becomes a per-user PROCEDURAL DEFAULT (kind='default') — the learning
  // that turns next month's cold ask into a one-line confirmation.
  if (resuming && Object.keys(resuming.assumed).length) {
    const stance = detectStance(question);
    // Attribution rule for a "nahi…" reply: if the same message EXPLICITLY corrects one of the
    // shown assumptions ("nahi, nil nahi tha" while we assumed nil=haan), the negation is
    // CONSUMED by that correction — the untouched assumptions keep their implicit consent
    // (the user read them and objected to one specific thing). A bare "nahi" with no explicit
    // correction is ambiguous, so ALL assumptions drop and get re-asked cold — safe direction.
    const corrections = Object.entries(resuming.assumed).filter(([n, a]) => n in extracted && extracted[n] !== a.value);
    const negateConsumed = corrections.length > 0;
    for (const [name, a] of Object.entries(resuming.assumed)) {
      const correctedHere = name in extracted && extracted[name] !== a.value;
      if (correctedHere) continue; // user's value already won via `extracted` — a confirmation of the correction
      if (stance === "negate" && !negateConsumed) {
        rejected.add(name);        // ambiguous rejection — asked cold below, never re-proposed
        delete values[name];       // also scrubs a possible extractor ECHO of our own shown value
      } else {
        values[name] = a.value;    // affirmed / implicit consent / negation-consumed → trusted for THIS calc
      }
    }
  }

  // GSTR-9 late fee is a different rule (₹200/day, different notification) our calculator does
  // not encode — don't compute the GSTR-3B formula for it. Fall to the general cited rule.
  if (toolName === "gstr_late_fee" && values.return_type === "GSTR-9") {
    return generalPlusOffer(question, context, spec, spec.slots.filter((s) => s.required && !(s.name in values)), "annual→general",
      "annual return (GSTR-9) late fee is a different rule — giving the general position", parent);
  }

  const missing = spec.slots.filter((s) => s.required && !(s.name in values));

  // Missing inputs → FIRST consult durable memory for proposable defaults (confirm-not-ask),
  // THEN fall back to the Phase-8b cold ask for whatever memory can't cover.
  if (missing.length > 0) {
    const proposable = missing.filter((s) => !rejected.has(s.name));
    const assumed = proposeDefaults(spec, proposable, extras?.memory ?? null);
    const stillMissing = missing.filter((s) => !(s.name in assumed));
    const pendingBase = {
      tool: toolName, intent: intent ?? "", values, rejected: [...rejected],
      missing: stillMissing.map((s) => s.name), asked_at: new Date().toISOString(),
    };

    if (Object.keys(assumed).length > 0) {
      // CONFIRM-NOT-ASK: show every remembered value + its origin, ask "sahi hai?", and only
      // list what's genuinely unknown. The calculator does NOT run until the next turn confirms
      // — that pause IS the legal-safety rule (memory may propose, never decide a number).
      return {
        reply: buildConfirmation(spec, assumed, stillMissing),
        abstained: false, mode: "confirm-ask", citationIds: [],
        note: `assumed ${Object.keys(assumed).join(",")}${stillMissing.length ? `; asked ${stillMissing.map((s) => s.name).join(",")}` : ""}`,
        pending: { ...pendingBase, assumed },
      };
    }

    // Nothing to propose → the Phase-8b behavior, now with the gather persisted so the next
    // turn resumes from structure instead of re-reading raw chat.
    const outcome = await generalPlusOffer(question, context, spec, stillMissing, "general+offer",
      `asked for ${stillMissing.map((m) => m.name).join(", ")}`, parent);
    return { ...outcome, pending: { ...pendingBase, assumed: {} } };
  }

  // All inputs present → compute the exact figure. The calculator returns its own citations.
  // At this point every slot value was either stated by the user or explicitly confirmed — so
  // the durable ones (never dates) become this user's PROCEDURAL DEFAULTS for next time.
  rememberAllDefaults(extras, spec.name, values);
  if (toolName === "gstr_late_fee") {
    const r = gstrLateFee({
      due_date: values.due_date as string,
      filing_date: values.filing_date as string,
      nil_return: values.nil_return as boolean,
      annual_turnover_inr: values.annual_turnover_inr as number,
    });
    const reply = [
      `Aapka ${values.return_type ?? "GSTR-3B"} late fee: ₹${r.payable.toLocaleString("en-IN")}.`,
      `- ${r.days_late} days late × ₹${r.fee_per_day}/day = ₹${r.computed_fee.toLocaleString("en-IN")}${r.cap_applied !== null ? `, capped at ₹${r.cap_applied.toLocaleString("en-IN")}` : ""} (CGST+SGST combined). [CGST-ACT/s47]`,
      `- Per-day amounts and turnover caps from Notification 19/2021 & 20/2021 (Central Tax). [NOTIF-CT/nt-2021-019]`,
      `Aapke diye numbers: due ${values.due_date}, filed ${values.filing_date}, nil: ${values.nil_return ? "haan" : "nahi"}, turnover ₹${(values.annual_turnover_inr as number).toLocaleString("en-IN")}. Galat ho to sahi bata dein.`,
    ].join("\n");
    return { reply, abstained: false, mode: "compute", citationIds: r.citation_ids, note: `late fee ₹${r.payable}`, pending: null };
  }

  if (toolName === "registration_threshold") {
    const r = registrationThreshold({
      annual_turnover_inr: values.annual_turnover_inr as number,
      supply_type: values.supply_type as "goods" | "services" | "both",
      special_category_state: values.special_category_state as boolean,
    });
    const reply = [
      r.must_register ? "Haan — is turnover pe aapko GST registration lena chahiye." : "Sirf turnover ke hisaab se abhi registration zaroori nahi lagta.",
      `- ${r.explanation}. [CGST-ACT/s22]`,
      `- ${r.caveat} [CGST-ACT/s24]`,
      `Aapke diye: turnover ₹${(values.annual_turnover_inr as number).toLocaleString("en-IN")}, supply ${values.supply_type}, special-category state: ${values.special_category_state ? "haan" : "nahi"}. Galat ho to sahi bata dein.`,
    ].join("\n");
    return { reply, abstained: false, mode: "compute", citationIds: r.citation_ids, note: `register=${r.must_register}`, pending: null };
  }

  // delayed_payment_interest
  const r = delayedPaymentInterest({
    tax_amount_inr: values.tax_amount_inr as number,
    due_date: values.due_date as string,
    payment_date: values.payment_date as string,
  });
  const reply = [
    `Aapka interest: ₹${r.interest.toLocaleString("en-IN")}.`,
    `- ₹${(values.tax_amount_inr as number).toLocaleString("en-IN")} × 18% per annum × ${r.days}/365 days = ₹${r.interest.toLocaleString("en-IN")}. [CGST-ACT/s50]`,
    `Aapke diye numbers: tax ₹${(values.tax_amount_inr as number).toLocaleString("en-IN")}, due ${values.due_date}, paid ${values.payment_date}. Galat ho to sahi bata dein.`,
  ].join("\n");
  return { reply, abstained: false, mode: "compute", citationIds: r.citation_ids, note: `interest ₹${r.interest}`, pending: null };
}

// rememberAllDefaults — when a calculation RUNS, its slot values are all user-stated or
// user-confirmed, so each durable one is written as a per-user PROCEDURAL default (fact
// "default:<tool>.<slot>", kind 'default', high confidence). Dates are per-case facts and never
// stored. Best-effort: memory writes must never break a turn.
function rememberAllDefaults(extras: LaneExtras | undefined, tool: string, values: Record<string, SlotValue>): void {
  if (!extras?.userId) return;
  for (const [slot, value] of Object.entries(values)) {
    const slotSpec = TOOL_SPECS[tool]?.slots.find((s) => s.name === slot);
    if (!slotSpec || slotSpec.type === "date") continue;
    confirmFact(extras.userId, `default:${tool}.${slot}`, String(value), extras.threadId ?? null, "default").catch(() => {});
  }
}

// generalPlusOffer — the "never a dead-end" behavior: give the general cited RULE, then append
// a bundled offer to compute the exact figure. The rule comes from the tool's own encoded
// constants (deterministic, already cited — no gate dependency); only tools without a standing
// rule fall back to retrieval, and if even that can't ground it, a short honest lead so the
// user always gets a path forward instead of a refusal.
async function generalPlusOffer(
  question: string, context: string | undefined,
  spec: (typeof TOOL_SPECS)[string], missing: (typeof spec.slots),
  mode: LaneOutcome["mode"], note: string, parent?: LfParent
): Promise<LaneOutcome> {
  const offer = buildClarification(spec, missing.length ? missing : spec.slots.filter((s) => s.required));
  let lead: string;
  let citationIds: string[] = [];
  if (spec.generalRule) {
    lead = spec.generalRule;
    citationIds = [...spec.generalRule.matchAll(/\[([A-Z]+-[A-Z]+\/[A-Za-z0-9./-]+?)\]/g)].map((m) => m[1]);
  } else {
    const general = await answerQuestion(question, undefined, context, parent);
    lead = general.abstained ? "Iska exact amount aapki details pe depend karta hai." : general.answer;
    citationIds = general.citations;
  }
  return {
    reply: `${lead}\n\n${offer}`,
    abstained: false,               // offering to help is NOT an abstention
    mode,
    citationIds,
    note,
  };
}

// toolFits — does the picked legal calculator actually match the question? Guards against
// answering a plain-math question with the late-fee tool (its default). Keyword/intent rules.
function toolFits(toolName: string, question: string, context: string | undefined, intent?: string): boolean {
  const t = `${context ?? ""} ${question}`.toLowerCase();
  // Refund is not a late-fee/interest/registration calc — its formula (Rule 89) lives in the RAG
  // tool loop with the r89 chunks, so send refund questions there rather than the late-fee tool.
  if (/\brefund\b/.test(t)) return false;
  if (toolName === "registration_threshold") return intent === "registration" || /register|registration|gstin|threshold|turnover limit/.test(t);
  if (toolName === "delayed_payment_interest") return /\binterest\b|section\s*50|s50\b|delayed payment|byaaj|byaj/.test(t);
  // gstr_late_fee — the default; require an actual late-fee signal to accept it
  return intent === "late_fee_interest" || /late|fee|gstr|return|filing|\bfile\b/.test(t);
}

let anthropic: Anthropic | null = null;

// tryGeneralMath — extract ONE arithmetic operation from a plain-math question ("goods worth 2
// lakh at 18% GST") and compute it EXACTLY with the safe dispatcher. Returns null when it isn't a
// clean calculation (then the lane falls back to RAG). No citation: the rate here was given BY THE
// USER and the result is arithmetic — not an assertion about what the law says, so no gate.
async function tryGeneralMath(question: string, context?: string, parent?: LfParent): Promise<LaneOutcome | null> {
  try {
    anthropic ??= new Anthropic();
    const res = await recordGeneration(parent, { name: "extract-arithmetic", model: "claude-haiku-4-5-20251001", input: question },
      () => anthropic!.messages.create({
        model: "claude-haiku-4-5-20251001", max_tokens: 120, temperature: 0,
        messages: [{ role: "user", content: `Extract ONE arithmetic operation from this question, or reply {"op":"none"} if it isn't a plain calculation. Expand crore/lakh to digits. Output ONLY JSON: {"op": "multiply"|"sum"|"subtract"|"divide"|"percent_of"|"none", "values": [numbers], "label": "short human description"}. For "X% of Y" use percent_of with values [X, Y].\n\n${context ? context + "\n" : ""}Question: ${question}` }],
      }),
      (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    const p = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    if (!p || p.op === "none" || !Array.isArray(p.values)) return null;
    const r = generalArithmetic({ op: p.op, values: p.values.map(Number) });
    if (r.result === null) return null;
    return {
      reply: `${p.label ? cap(String(p.label)) : "Result"}: ₹${r.result.toLocaleString("en-IN")}.\n(${r.explanation}. Ye sirf arithmetic hai — figures aapke diye hue, koi legal claim nahi.)`,
      abstained: false, mode: "general-math", citationIds: [], note: `${r.op} = ${r.result}`,
    };
  } catch {
    return null;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
