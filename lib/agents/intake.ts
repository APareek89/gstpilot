// INTAKE — the first agent: classify intent + risk tier. One haiku call, strict JSON.
// G1 sits directly on its output: zod gives us a one-line, machine-checked guarantee that
// what the model produced has exactly the right shape and vocabulary (parse, don't trust).
// Failure policy: one re-ask; a second failure defaults to T3 — when unsure about risk,
// fail UP the ladder (worst case: a routine question meets a CA), never down.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { INTENTS } from "../../evals/golden-schema";

export const IntakeSchema = z.object({
  intent: z.enum(INTENTS),
  tier: z.enum(["T1", "T2", "T3"]),
  reason: z.string().max(300),
});
export type Intake = z.infer<typeof IntakeSchema>;

const PROMPT = (q: string) => `Classify this Indian GST question from a small e-commerce seller. Output ONLY JSON:
{"intent": one of ${JSON.stringify(INTENTS)},
 "tier": "T1" | "T2" | "T3",
 "reason": "one line"}

Tier rules (when torn, pick the HIGHER tier):
- T3: a proceeding has already started or is threatened — notice (DRC-01/SCN), penalty order, seizure/detention, audit summons, bank attachment, appeal, fraud allegation. Also anything where a wrong answer worsens a live dispute.
- T2: the answer computes or commits THIS user's money or a deadline (their late fee, their ITC reversal, their refund).
- T1: how the law works in general — rates, procedures, definitions, due dates in the abstract.
"out_of_scope" intent = not answerable from CGST/IGST law (income tax, customs, state professional tax, SGST act sections).

Question: ${q}`;

let anthropic: Anthropic | null = null;

export async function classifyIntake(question: string): Promise<{ intake: Intake; g1_retries: number }> {
  anthropic ??= new Anthropic();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: "user", content: PROMPT(question) }],
      });
      const raw = res.content[0].type === "text" ? res.content[0].text : "";
      const parsed = IntakeSchema.parse(JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, "")));
      return { intake: parsed, g1_retries: attempt };
    } catch {
      /* retry once */
    }
  }
  // G1 double failure: risk-unknown = treat as maximum risk.
  return {
    intake: { intent: "notice_dispute", tier: "T3", reason: "intake failed twice — defaulting to escalation" },
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
