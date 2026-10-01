import type { MessageInput } from "./wire";
/** Synthetic ordinary-mock responses never assert unreviewed legal facts. Permanent
 * prepared examples are constructed by the owning application route instead. */
export function fixtureText(input: MessageInput): string {
  const first = input.messages[0]?.content;
  const prompt = typeof first === "string" ? first : "";
  if (prompt.startsWith("Classify this Indian GST question")) {
    const q = prompt.split("\nQuestion: ").at(-1)!.toLowerCase();
    let intent = "returns_filing", tier = "T1", lane = "procedure";
    if (/notice|drc-01|seizure|summons|penalty order|appeal/.test(q)) { intent = "notice_dispute"; tier = "T3"; lane = "escalate"; }
    else if (/income tax|customs|capital gain/.test(q)) { intent = "out_of_scope"; lane = "out_of_scope"; }
    else if (/\blate\b|\bfees?\b|interest/.test(q)) { intent = "late_fee_interest"; tier = "T2"; lane = "calculation"; }
    else if (/2 lakh|200000|2,00,000/.test(q)) { intent = "general_guidance"; tier = "T2"; lane = "calculation"; }
    return JSON.stringify({ intent, tier, lane, reason: "Synthetic mock classification; no model request." });
  }
  if (prompt.startsWith("You are filling the inputs for a tool")) {
    const convo = prompt.split("\nConversation:\n").at(-1)!;
    const dates = [...convo.matchAll(/\b20\d\d-\d\d-\d\d\b/g)].map(m => m[0]);
    return JSON.stringify({ tax_period: /\b(?:January|Jan)\s*2022\b|\b2022-01\b/i.test(convo) ? "2022-01" : null, return_type: /GSTR-3B/i.test(convo) ? "GSTR-3B" : /GSTR-1\b/i.test(convo) ? "GSTR-1" : null,
      due_date: dates[0] ?? null, filing_date: dates[1] ?? null, payment_date: dates[1] ?? null,
      nil_return: /non.nil|not nil|nil[^\n]{0,20}(false|nahi)/i.test(convo) ? false : /nil[^\n]{0,20}true|nil return/i.test(convo) ? true : null,
      annual_turnover_inr: convo.match(/(?:turnover|annual_turnover_inr)[^\d]{0,30}([\d,.]+\s*(?:lakh|crore)?)/i)?.[1] ?? null,
      tax_amount_inr: null });
  }
  if (prompt.startsWith("Extract ONE arithmetic operation")) {
    const question = prompt.split("Question: ").at(-1)!;
    return /(?:2 lakh|200000|2,00,000)/i.test(question) && /18/.test(question)
      ? JSON.stringify({ op: "percent_of", values: [18, 200000], label: "GST on the supplied figures (mock extraction)" }) : '{"op":"none"}';
  }
  if (prompt.startsWith("You prepare Indian GST questions")) return JSON.stringify({ rewritten: "GST return filing records", exact_tokens: [], hypothetical_answer: "", needs_clarification: false, doc_type_hint: "statute" });
  if (prompt.startsWith("You maintain a memory profile")) return '{"facts":[]}';
  if (prompt.startsWith("Rewrite this approved GST resolution")) return prompt.split("Approved resolution:\n").at(-1)!;
  if (prompt.startsWith("You are a verification checker.")) return "PASS";
  if (prompt.startsWith("Summarize this GST support conversation")) return "Synthetic mock conversation summary.";
  return "The sources I have don't cover this question. This is a prepared mock response, not verified legal advice.";
}
