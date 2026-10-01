// INTAKE — the first agent: classify intent + risk tier. One haiku call, strict JSON.
// G1 sits directly on its output: zod gives us a one-line, machine-checked guarantee that
// what the model produced has exactly the right shape and vocabulary (parse, don't trust).
// Failure policy: one re-ask; a second failure defaults to T3 — when unsure about risk,
// fail UP the ladder (worst case: a routine question meets a CA), never down.

import Anthropic, { ProviderError } from "../providers/client";
import { z } from "zod";
import { INTENTS } from "../../evals/golden-schema";
import { LANES, LANE_GUIDE, type Lane } from "./lanes";
import { recordGeneration, type LfParent } from "../observability/langfuse";

export const IntakeSchema = z.object({
  intent: z.enum(INTENTS),
  tier: z.enum(["T1", "T2", "T3"]),
  lane: z.enum(LANES),
  reason: z.string().max(300),
});
export type Intake = z.infer<typeof IntakeSchema>;

const PROMPT = (q: string) => `Classify this Indian GST question from a small e-commerce seller. Output ONLY JSON:
{"intent": one of ${JSON.stringify(INTENTS)},
 "tier": "T1" | "T2" | "T3",
 "lane": one of ${JSON.stringify(LANES)},
 "reason": "one line"}

Tier rules (when torn, pick the HIGHER tier):
- T3: a proceeding has already started or is threatened — notice (DRC-01/SCN), penalty order, seizure/detention, audit summons, bank attachment, appeal, fraud allegation. Also anything where a wrong answer worsens a live dispute.
- T2: the answer computes or commits THIS user's money or a deadline (their late fee, their ITC reversal, their refund).
- T1: how the law works in general — rates, procedures, definitions, due dates in the abstract.
"out_of_scope" intent = not answerable from CGST/IGST law (income tax, customs, state professional tax, SGST act sections).
"general_guidance" intent = drafting/wording help ONLY — what to WRITE somewhere (a sample product/invoice description, wording, a format/example). Pair it with lane "guidance", NOT out_of_scope. It is NEVER for how to obtain/apply/claim/register/file anything with the government — those take their substantive intent (refund_export, registration, returns_filing, …).

${LANE_GUIDE}

Question: ${q}`;

let anthropic: Anthropic | null = null;

// repairIntake — deterministic repair of the model's KNOWN vocabulary slips BEFORE zod judges it.
// The bug this fixes (seen live, Phase 8c): with conversation context, the classifier answered
// intent="procedure" — a LANE word, not an intent — and zod's rejection at temperature 0 repeated
// identically, so a benign "what do I write in the description field?" failed twice and FAILED UP
// to a wrong T3 escalation. Repair rules are narrow and auditable: lowercase/trim the enums, map a
// lane-word-as-intent to the intent that lane implies, clamp an over-long reason. The tier — the
// safety-critical field — is deliberately NEVER repaired: an invalid tier still fails to zod and
// takes the cautious T3 default. Parse, repair the vocabulary, never repair the risk.
function repairIntake(p: Record<string, unknown>): Record<string, unknown> {
  const out = { ...p };
  if (typeof out.intent === "string") out.intent = out.intent.trim().toLowerCase();
  if (typeof out.lane === "string") out.lane = out.lane.trim().toLowerCase();
  if (typeof out.reason === "string") out.reason = out.reason.slice(0, 300);
  const intents = INTENTS as readonly string[];
  if (typeof out.intent === "string" && !intents.includes(out.intent) && (LANES as readonly string[]).includes(out.intent)) {
    // The model answered with a lane word. Each lane implies a sensible intent home:
    const laneToIntent: Record<string, string> = {
      procedure: "general_guidance", guidance: "general_guidance", eligibility: "registration",
      calculation: "late_fee_interest", rate_lookup: "rate_lookup",
      change_over_time: "rate_lookup", escalate: "notice_dispute", out_of_scope: "out_of_scope",
    };
    // keep the model's lane pick if it was valid — only the intent field was mislabeled
    if (typeof out.lane !== "string" || !(LANES as readonly string[]).includes(out.lane)) out.lane = out.intent;
    out.intent = laneToIntent[out.intent as string];
  }
  return out;
}

// A provider failure may already be billed. Never resubmit it automatically.
// Only a fully received, metered response with invalid classification JSON gets
// one bounded semantic re-ask; persistent invalid classification fails up to T3.
export async function classifyIntake(question: string, parent?: LfParent): Promise<{ intake: Intake; g1_retries: number; serviceError?: boolean }> {
  anthropic ??= new Anthropic();
  let parseFailures = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await recordGeneration(parent, { name: "intake", model: "claude-haiku-4-5-20251001", input: question },
        () => anthropic!.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300, // headroom so a verbose `reason` can't truncate the JSON
          temperature: 0,
          messages: [{ role: "user", content: PROMPT(question) }],
        }),
        (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
      const raw = res.content[0].type === "text" ? res.content[0].text : "";
      const parsed = IntakeSchema.parse(repairIntake(JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""))));
      return { intake: parsed, g1_retries: parseFailures };
    } catch (e) {
      if (e instanceof ProviderError || !(e instanceof SyntaxError || e instanceof z.ZodError)) {
        return { intake: { intent: "out_of_scope", tier: "T1", lane: "out_of_scope", reason: "intake service temporarily unavailable" }, g1_retries: parseFailures, serviceError: true };
      }
      // a genuine parse/validation failure — re-ask once, then give up to the T3 fallback
      parseFailures++;
      if (parseFailures >= 2) break;
    }
  }

  // Repeated unparseable output: risk-unknown → fail up cautiously (better a routine question meets
  // a CA than a risky one gets a confident answer). Honest reason, not "failed twice".
  return {
    intake: { intent: "notice_dispute", tier: "T3", lane: "escalate", reason: "could not classify this question reliably — routing to a professional to be safe" },
    g1_retries: 2,
  };
}

// The T3 handoff: a factual summary a CA can act on — never legal advice.
export function caHandoff(question: string, intake: Intake): string {
  return [
    "Yeh sawal ek chal rahe ya sambhavit legal proceeding se juda lagta hai, isliye main ispe legal advice nahi dunga — ek CA se consult karna hi sahi rasta hai.",
    "",
    "Aap apne CA ko yeh summary de sakte hain:",
    `- Question: ${question}`,
    `- Category: ${intake.intent} (risk tier ${intake.tier})`,
    `- Why escalated: ${intake.reason}`,
    "",
    "Time-sensitive ho sakta hai (notices/appeals ki deadlines hoti hain) — jaldi consult karein.",
  ].join("\n");
}
