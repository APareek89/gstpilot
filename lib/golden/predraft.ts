// Haiku pre-draft of golden labels (Phase 8 flywheel, step 1). Given a production failure — the
// question, the chunk ids retrieval ACTUALLY returned, and the failure reason — a cheap model
// proposes the structured labels (intent, tier, candidate relevant chunk ids, expected facts).
//
// THIS IS A SPEED-UP ON TYPING, NOT THE TRUTH. The labels feed zero-tolerance gates (T3 recall,
// false-answer, citation validity), so ⚠️ a human must verify every field against source before
// the case is marked "verified". The model NEVER invents identity: candidate chunk ids are
// filtered to the ids retrieval actually saw, and the whole thing fails soft to a blank draft —
// a human filling in blanks is fine; a crash in the triage queue is not.

import Anthropic from "@anthropic-ai/sdk";
import { INTENTS, type Intent, type Tier } from "../../evals/golden-schema";

export type PredraftInput = {
  question: string;
  retrievedIds: string[];  // ids retrieval returned — the model may ONLY pick relevant ids from these
  failureReason: string;   // e.g. "wrong" | "unclear" | "didnt_answer" | "gate-abstention"
};

export type PredraftLabels = {
  question: string;
  expected_intent: Intent;
  expected_tier: Tier;
  unanswerable: boolean;
  relevant_chunk_ids: string[];
  expected_answer_facts: string[];
  must_not_contain: string[];
};

const PROMPT = (i: PredraftInput) => `You are drafting a REGRESSION TEST CASE from a GST answer a user marked bad. Output ONLY JSON:
{"expected_intent": one of ${JSON.stringify(INTENTS)},
 "expected_tier": "T1" (how the law works in general) | "T2" (computes/commits THIS user's money or a deadline) | "T3" (a notice/penalty/seizure/appeal/dispute — escalate),
 "unanswerable": true ONLY if this cannot be answered from CGST/IGST law (income tax, customs, state acts, professional tax), else false,
 "relevant_chunk_ids": [1-3 ids that SHOULD answer this, chosen ONLY from: ${JSON.stringify(i.retrievedIds)}. [] if unanswerable],
 "expected_answer_facts": [specific numbers/dates/form-names/thresholds the answer MUST contain — [] if you are not certain, do NOT guess],
 "must_not_contain": [strings that would make the answer wrong — [] if none obvious]}

Question: ${i.question}
Why the user rejected it: ${i.failureReason}
A human will verify every field against the source PDFs. When unsure, prefer [] over a guess.`;

let anthropic: Anthropic | null = null;

const BLANK = (q: string): PredraftLabels => ({
  question: q, expected_intent: "out_of_scope", expected_tier: "T3",
  unanswerable: false, relevant_chunk_ids: [], expected_answer_facts: [], must_not_contain: [],
});

export async function predraftGolden(i: PredraftInput): Promise<PredraftLabels> {
  anthropic ??= new Anthropic();
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 400, temperature: 0,
      messages: [{ role: "user", content: PROMPT(i) }],
    });
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    const p = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    const allowed = new Set(i.retrievedIds);
    return {
      question: i.question,
      expected_intent: (INTENTS as readonly string[]).includes(p.expected_intent) ? p.expected_intent : "out_of_scope",
      expected_tier: (["T1", "T2", "T3"] as string[]).includes(p.expected_tier) ? p.expected_tier : "T3",
      unanswerable: p.unanswerable === true,
      // identity guard: only ids retrieval actually saw — the model can never mint a chunk id
      relevant_chunk_ids: (Array.isArray(p.relevant_chunk_ids) ? p.relevant_chunk_ids : []).map(String).filter((x: string) => allowed.has(x)),
      expected_answer_facts: (Array.isArray(p.expected_answer_facts) ? p.expected_answer_facts : []).map(String),
      must_not_contain: (Array.isArray(p.must_not_contain) ? p.must_not_contain : []).map(String),
    };
  } catch {
    return BLANK(i.question);
  }
}
