// Query transformation — runs BEFORE retrieval, two layers:
//
// 1. DETERMINISTIC reference parser (regex, no model): "section 52", "rule 86A" are identity
//    references — similarity search is the wrong tool for identity, so these resolve straight
//    to chunk ids and get pinned to the top. Deterministic wins wherever it can apply:
//    free, instant, cannot hallucinate.
//
// 2. MODEL pass (one haiku call, temp 0, strict JSON) producing:
//    - rewritten: seller phrasing → the statute's vocabulary ("TCS kitna" → "collect tax at source")
//    - exact_tokens: identifiers that must survive verbatim (GSTR-3B, 16(4), HSN 64, ₹1800).
//      TRUST BOUNDARY: each token is verified by substring check against the RAW question —
//      the model may only echo what the user actually wrote, never mint new identifiers.
//    - hypothetical_answer: a short fake ANSWER passage for meaning-search. Why embed a fake
//      answer instead of the question? Because the corpus contains answers, not questions —
//      a question's embedding lives in "question space", while a hypothetical answer is
//      phrased like the statute itself and lands measurably nearer the true chunks.
//    - needs_clarification: flagged when the question is too ambiguous to answer safely.
//    Falls back to the original query on any failure — degraded, never blocked.

import Anthropic from "@anthropic-ai/sdk";

export type Transformation = {
  original: string;
  rewritten: string;          // keyword channel input
  hyde: string | null;        // dense channel input (hypothetical answer), null on fallback
  exact_tokens: string[];     // verbatim-verified identifiers, appended to keyword input
  needs_clarification: boolean;
  direct_ids: string[];       // identity references; search drops any that don't exist
};

// "section 16(4) of CGST act" → CGST-ACT/s16 · "IGST section 13" → IGST-ACT/s13 ·
// "rule 86A" → CGST-RULES/r86A. Subsection brackets stripped: chunks are whole sections.
export function parseReferences(query: string): string[] {
  const ids = new Set<string>();
  const igst = /\bigst\b/i.test(query);
  for (const m of query.matchAll(/\bsections?\s+(\d{1,3}[A-Z]{0,2})\b/gi)) {
    ids.add(`${igst ? "IGST-ACT" : "CGST-ACT"}/s${m[1].toUpperCase()}`);
  }
  for (const m of query.matchAll(/\brules?\s+(\d{1,3}[A-Z]{0,2})\b/gi)) {
    ids.add(`CGST-RULES/r${m[1].toUpperCase()}`);
  }
  return [...ids];
}

const TRANSFORM_PROMPT = (q: string) => `You prepare Indian GST questions for a legal search engine. Output ONLY JSON:
{"rewritten": "question in CGST/IGST Act vocabulary (expand: TCS -> collect tax at source; ITC -> input tax credit; Amazon/Flipkart/Meesho/Swiggy/Zomato/ECO -> electronic commerce operator; translate Hinglish)",
 "exact_tokens": ["identifiers copied VERBATIM from the question: form names, section/rule numbers, HSN codes, amounts, dates — [] if none"],
 "hypothetical_answer": "2-3 sentences of a PLAUSIBLE answer written in dry statutory register (as if quoting the Act/rules/notification). Invented details are fine — this is a search probe, never shown to anyone.",
 "needs_clarification": false or true (true only if the question cannot be safely interpreted at all)}

Question: ${q}`;

let anthropic: Anthropic | null = null;

export async function transformQuery(query: string): Promise<Transformation> {
  const direct_ids = parseReferences(query);
  const fallback: Transformation = {
    original: query, rewritten: query, hyde: null,
    exact_tokens: [], needs_clarification: false, direct_ids,
  };
  try {
    anthropic ??= new Anthropic();
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0,
      messages: [{ role: "user", content: TRANSFORM_PROMPT(query) }],
    });
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    const p = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    const lowerQ = query.toLowerCase();
    return {
      original: query,
      rewritten: typeof p.rewritten === "string" && p.rewritten.trim().length > 3 ? p.rewritten.trim() : query,
      hyde: typeof p.hypothetical_answer === "string" && p.hypothetical_answer.trim().length > 20 ? p.hypothetical_answer.trim() : null,
      // the substring check: a token the user never typed gets silently dropped
      exact_tokens: (Array.isArray(p.exact_tokens) ? p.exact_tokens : [])
        .map(String)
        .filter((t: string) => t.length >= 2 && lowerQ.includes(t.toLowerCase())),
      needs_clarification: p.needs_clarification === true,
      direct_ids,
    };
  } catch {
    return fallback;
  }
}
