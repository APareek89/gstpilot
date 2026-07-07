// The golden-case schema — the shape of GSTPilot's constitution.
// Every future layer (retrieval, tier classifier, answering agents, gates) is graded against
// cases in this shape. Each field exists to grade ONE layer in isolation, because a blended
// "quality score" can't tell you which layer broke: relevant_chunk_ids grades retrieval,
// expected_tier grades the classifier, expected_answer_facts grades generation,
// must_not_contain catches specific poisons, unanswerable feeds the false-answer metric.

export type Tier = "T1" | "T2" | "T3";

export const INTENTS = [
  "rate_lookup",        // what % applies to X
  "registration",       // who must register, where, how
  "itc_eligibility",    // can I claim / must I reverse credit
  "ecommerce_liability",// TCS s52, 9(5), ECO-vs-seller questions
  "returns_filing",     // which form, due dates, process
  "late_fee_interest",  // consequences of delay (amounts, caps)
  "refund_export",      // refunds, zero-rating, LUT
  "eway_bill",          // movement documents
  "composition",        // composition scheme questions
  "place_of_supply",    // which state's tax / inter vs intra
  "notice_dispute",     // demands, penalties, appeals (T3 territory)
  "out_of_scope",       // not GST law in our corpus (income tax, SGST acts, customs…)
] as const;
export type Intent = (typeof INTENTS)[number];

export type GoldenCase = {
  id: string;                       // stable: "g001" — never renumber, tests reference these
  question: string;                 // exactly as a seller would type it (incl. Hinglish)
  expected_intent: Intent;
  expected_tier: Tier;              // T1 routine · T2 money/deadline · T3 escalate-to-CA
  unanswerable: boolean;            // true → correct behavior is honest abstention
  relevant_chunk_ids: string[];     // grades retrieval (recall@10); empty iff unanswerable
  expected_answer_facts: string[];  // exact numbers/dates/strings the answer MUST contain
  must_not_contain: string[];       // strings whose presence auto-fails the answer
  policy_version: string;           // law-as-of date the labels were verified against
  provenance: {
    author: string;                 // who wrote the question
    verified_by: string | null;     // human who checked labels against source PDFs
    verified_on: string | null;
  };
  status: "draft" | "verified" | "retired"; // only "verified" cases gate CI
  note?: string;
};

// Plain validation (no schema library — readable, zero deps). Returns problems, [] = valid.
export function validateCase(c: GoldenCase): string[] {
  const p: string[] = [];
  if (!/^g\d{3}$/.test(c.id)) p.push(`${c.id}: id must look like g001`);
  if (!c.question?.trim()) p.push(`${c.id}: empty question`);
  if (!INTENTS.includes(c.expected_intent)) p.push(`${c.id}: unknown intent '${c.expected_intent}'`);
  if (!["T1", "T2", "T3"].includes(c.expected_tier)) p.push(`${c.id}: bad tier`);
  if (c.unanswerable && c.relevant_chunk_ids.length) p.push(`${c.id}: unanswerable but has chunk ids`);
  if (!c.unanswerable && !c.relevant_chunk_ids.length) p.push(`${c.id}: answerable but no chunk ids`);
  if (c.unanswerable && c.expected_intent !== "out_of_scope" && c.expected_tier !== "T3")
    p.push(`${c.id}: unanswerable in-scope cases should usually be T3 (escalate) — double-check`);
  if (c.status === "verified" && !c.provenance.verified_by) p.push(`${c.id}: verified without verifier`);
  return p;
}
