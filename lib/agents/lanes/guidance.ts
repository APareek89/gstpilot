// THE GUIDANCE LANE — practical help, honestly labelled. "What do I write in the description
// field? Give me an example" is not a legal ruling: it's drafting help where COMMON PRACTICE is
// the answer. Before this lane, such questions had nowhere to go — the RAG path force-abstained
// (no chunk says how to word a product description) and, worse, a taxonomy hole once escalated
// one to a CA. This lane answers them directly, warmly, with ONE concrete example.
//
// How it stays inside the safety bars while being un-rigid:
//   • HARD PROMPT RULES: no rates, amounts, limits, dates or section numbers from model memory —
//     anything like that is replaced with a pointer back to the grounded paths ("mujhse poochh
//     lein, main source ke saath bataunga"). So the lane can never smuggle in a wrong number.
//   • G6 in CODE: after generation, a regex sweep rejects any slipped % / ₹-amount / section
//     reference and strips that line — the model is instructed AND checked, like every gate.
//   • A standing DISCLAIMER is appended by code (not the model): this is general guidance /
//     common practice, not legal advice, and the exact legal requirement is one question away.

import Anthropic from "@anthropic-ai/sdk";
import type { LaneOutcome, LaneExtras } from "../lanes";
import { GENERATION_MODEL } from "../answer";
import { memoryContextBlock } from "../../memory/store";
import { recordGeneration, type LfParent } from "../../observability/langfuse";

const GUIDANCE_PROMPT = (question: string, context?: string, memBlock?: string) => `You are GSTPilot, helping a small Indian e-commerce seller with a PRACTICAL how-to question — drafting help, formats, wording, examples. This is common-practice guidance, NOT a legal ruling.

HARD RULES (violating any of these is a failure):
1. NEVER state a GST rate/percentage, a monetary amount or limit, a date/deadline, or a section/rule/notification number. You do not have sources open — if the answer would need one, write exactly: (exact requirement ke liye mujhse alag se poochh lein — main source ke saath bataunga)
2. Present everything as common practice ("aam taur pe", "aksar log"), never as a legal requirement.
3. Match the user's language mix (Hinglish stays Hinglish). Warm, direct, under 150 words.
4. Give ONE concrete, realistic example the user can copy and adapt.
5. Plain sentences and "- " bullets only — no headings, no bold.

${memBlock ? `${memBlock}\n\n` : ""}${context ? `Conversation so far:\n${context}\n\n` : ""}Question: ${question}`;

// G6 — the code-side check on guidance output: catch a slipped rate/amount/section reference and
// drop that line (the same drop-the-sentence policy as pruneUngrounded). The patterns are the
// exact things this lane is forbidden to assert: percentages, ₹/lakh/crore amounts, statute refs.
const FORBIDDEN = /\d+(\.\d+)?\s*%|₹\s*[\d,]+|\b\d+\s*(lakh|crore)\b|\bsection\s+\d+|\brule\s+\d+|\bnotification\s+(no\.?\s*)?\d+/i;

function stripForbiddenLines(text: string): { clean: string; dropped: number } {
  const lines = text.split("\n");
  const kept = lines.filter((l) => !FORBIDDEN.test(l));
  return { clean: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), dropped: lines.length - kept.length };
}

const DISCLAIMER =
  "⚠️ Ye general guidance hai (common practice) — legal advice nahi. Exact legal requirement chahiye to wahi sawaal poochh lein, main source ke saath bataunga.";

let anthropic: Anthropic | null = null;

export async function runGuidanceLane(question: string, context?: string, _intent?: string, parent?: LfParent, extras?: LaneExtras): Promise<LaneOutcome> {
  try {
    anthropic ??= new Anthropic();
    const memBlock = memoryContextBlock(extras?.memory ?? null);
    const res = await recordGeneration(parent, { name: "guidance", model: GENERATION_MODEL, input: question },
      () => anthropic!.messages.create({
        model: GENERATION_MODEL,
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: "user", content: GUIDANCE_PROMPT(question, context, memBlock || undefined) }],
      }),
      (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    const { clean, dropped } = stripForbiddenLines(raw);
    if (!clean) {
      // everything the model wrote was forbidden material — refuse to wing it
      return {
        reply: `Iska theek-thaak practical jawab dene ke liye mujhe exact requirement source se dekhni padegi — sawaal thoda specific karke poochhein (kis form/document ke liye likhna hai?). ${DISCLAIMER}`,
        abstained: false, mode: "guidance-blocked", citationIds: [], note: "G6 stripped everything",
      };
    }
    return {
      reply: `${clean}\n\n${DISCLAIMER}`,
      abstained: false, mode: "guidance", citationIds: [],
      note: dropped ? `G6 dropped ${dropped} line(s)` : "practical guidance",
    };
  } catch {
    // model unavailable → an honest nudge, never a fake answer and never a CA escalation
    return {
      reply: "Abhi thodi technical dikkat hai — ek minute mein dobara poochh lein.",
      abstained: false, mode: "guidance-error", citationIds: [], note: "guidance call failed",
    };
  }
}
