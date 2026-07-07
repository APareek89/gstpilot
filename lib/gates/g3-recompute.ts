// G3 — recompute-don't-trust. Plain code, no model.
// Every number the resolution draft asserts (₹ amounts, %, day/month counts, years) must
// be findable — notation-normalized — in the text of a chunk that sentence cites, or in a
// calculator output. A model quoting a figure "from memory" that isn't in its cited source
// is exactly the failure our brief forbids; this gate makes it mechanically impossible.

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, eighteen: 18, twenty: 20, "twenty-five": 25, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  thousand: 1000, lakh: 100000, crore: 10000000,
};

export function normalizeNumbers(t: string): string {
  let s = t.toLowerCase();
  s = s.replace(/per\s*cent\.?|percent/g, "%").replace(/₹|rs\.?|rupees?/g, " ");
  s = s.replace(/\b([a-z-]+)\s+(hundred|thousand|lakh|crore)\b/g, (m, a, b) =>
    NUM_WORDS[a] ? String(NUM_WORDS[a] * NUM_WORDS[b]) : m);
  s = s.replace(/\b([a-z-]+)\b/g, (m) => (NUM_WORDS[m] !== undefined ? String(NUM_WORDS[m]) : m));
  s = s.replace(/(\d),(\d)/g, "$1$2");
  return s.replace(/[\s,.]+/g, " ").trim();
}

const TAG_RE = /\[([A-Z]+-[A-Z]+\/[A-Za-z0-9./-]+?)(?:\([^)\]]{1,10}\))?\]/g;
// numbers worth verifying: 2+ digit figures, percentages, and digit+unit pairs
const NUMBER_RE = /\d[\d]*(?:\.\d+)?\s*(?:%|days?|months?|years?|weeks?|crore|lakh)?/g;

export type G3Result = { ok: boolean; violations: string[] };

export function recomputeNumbers(
  draft: string,
  chunkTextById: Map<string, string>,
  calculatorOutputs: string[]
): G3Result {
  const violations: string[] = [];
  const calcNorm = normalizeNumbers(calculatorOutputs.join(" "));

  for (const line of draft.split("\n")) {
    const tags = [...line.matchAll(TAG_RE)].map((m) => m[1]);
    const sources = tags.map((t) => chunkTextById.get(t) ?? "").join(" ");
    const sourceNorm = normalizeNumbers(sources) + " " + calcNorm;
    const lineNorm = normalizeNumbers(line);

    for (const numMatch of lineNorm.matchAll(NUMBER_RE)) {
      const token = numMatch[0].trim();
      const bare = token.match(/^\d+(?:\.\d+)?/)![0];
      if (bare.length < 2 && !token.includes("%")) continue; // single digits: too noisy to police
      // GSTR-1/3B, section numbers etc. are identifiers, not asserted figures — skip if the
      // digit is glued to a letter in the original line.
      if (new RegExp(`[a-z-]${bare}|${bare}[a-z]`, "i").test(lineNorm.replace(/\s/g, ""))) continue;
      if (!sourceNorm.includes(bare)) {
        violations.push(`figure "${token}" in "${line.trim().slice(0, 90)}" not found in cited source(s) [${tags.join(",") || "none"}] or calculator output`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}
