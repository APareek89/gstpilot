// The eval harness. Takes ANY system-under-test — today just retrieval, later the tier
// classifier and the full answering pipeline — runs it over the golden set, and reports
// PER-METRIC results, never one blended score. Why never blended: 0.9 recall × 0.5 tier
// accuracy and 0.5 recall × 0.9 tier accuracy both average to "0.7, seems fine" — the
// blend hides WHICH layer is broken, which is the only thing a score is for.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GoldenCase, Tier } from "./golden-schema";

// A system-under-test implements whatever layers it has; the harness grades what's present.
export type SystemUnderTest = {
  name: string;
  /** return chunk ids, best first (at least 10 for recall@10) */
  retrieve?: (question: string) => Promise<string[]>;
  /** return the final user-facing answer text */
  answer?: (question: string) => Promise<string>;
  /** return the risk tier */
  classifyTier?: (question: string) => Promise<Tier>;
};

// Per-case outcome — what the admin Evals view renders row by row.
export type CaseResult = {
  id: string;
  question: string;
  tier: Tier;
  unanswerable: boolean;
  hit: boolean | null;        // retrieval: relevant chunk in top-10 (null if not graded)
  first_rank: number | null;  // rank of first relevant hit
};

export type EvalReport = {
  sut: string;
  cases: number;
  per_case: CaseResult[];
  retrieval?: {
    recall_at_10: number;                       // answerable cases where ≥1 relevant chunk in top-10
    top_hit_ranks: Record<string, number>;      // distribution: rank of first relevant hit
    misses: { id: string; question: string }[];
  };
  answers?: {
    fact_match_rate: number;                    // verified facts present (normalized substring)
    poison_rate: number;                        // answers containing a must_not_contain string
    false_answer_rate: number;                  // UNANSWERABLE slice: answered instead of abstaining
  };
  tiers?: {
    accuracy: number;
    confusion: Record<string, Record<string, number>>; // expected -> predicted -> count
    t3_recall: number;                          // reported ALONE — the 1.0 bar
  };
};

const norm = (t: string) => t.toLowerCase().replace(/[\s,.]+/g, " ");

// Fact matching needs number-aware normalization: the statute spells numbers out ("fifty
// thousand rupees", "two hundred per cent."), answers use digits ("₹50,000", "200%").
// Both sides get converted to digit form before the substring check — still deterministic,
// still cheap, just no longer blind to notation.
const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  lakh: 100000, crore: 10000000,
};
function normFact(t: string): string {
  let s = t.toLowerCase();
  s = s.replace(/per\s*cent\.?|percent/g, "%").replace(/₹|rs\.?|rupees?/g, " ");
  // "twenty-five thousand" / "fifty thousand" / "two hundred" → digits (simple two-word products)
  s = s.replace(/\b([a-z-]+)\s+(hundred|thousand|lakh|crore)\b/g, (m, a, b) =>
    NUM_WORDS[a] ? String(NUM_WORDS[a] * NUM_WORDS[b]) : m);
  s = s.replace(/\b([a-z-]+)\b/g, (m) => (NUM_WORDS[m] !== undefined ? String(NUM_WORDS[m]) : m));
  s = s.replace(/(\d),(\d)/g, "$1$2"); // 50,000 → 50000
  return s.replace(/[\s,.]+/g, " ").trim();
}

// Abstention detector for the false-answer metric: the honest "sources don't cover this".
const ABSTAIN_MARKERS = ["don't cover", "do not cover", "cannot answer", "consult a ca", "outside the scope", "not covered by"];

export function loadGolden(opts: { verifiedOnly?: boolean } = {}): GoldenCase[] {
  const all: GoldenCase[] = JSON.parse(
    readFileSync(join(process.cwd(), "evals", "golden.json"), "utf8")
  ).cases;
  const active = all.filter((c) => c.status !== "retired");
  return opts.verifiedOnly ? active.filter((c) => c.status === "verified") : active;
}

export async function runEval(sut: SystemUnderTest, cases: GoldenCase[]): Promise<EvalReport> {
  const perCase = new Map<string, CaseResult>(
    cases.map((c) => [c.id, {
      id: c.id, question: c.question, tier: c.expected_tier,
      unanswerable: c.unanswerable, hit: null, first_rank: null,
    }])
  );
  const report: EvalReport = { sut: sut.name, cases: cases.length, per_case: [] };

  if (sut.retrieve) {
    const answerable = cases.filter((c) => !c.unanswerable);
    let hits = 0;
    const ranks: Record<string, number> = {};
    const misses: { id: string; question: string }[] = [];
    for (const c of answerable) {
      const top = (await sut.retrieve(c.question)).slice(0, 10);
      const rank = top.findIndex((id) => c.relevant_chunk_ids.includes(id)) + 1;
      const pc = perCase.get(c.id)!;
      pc.hit = rank > 0;
      pc.first_rank = rank > 0 ? rank : null;
      if (rank > 0) {
        hits++;
        ranks[String(rank)] = (ranks[String(rank)] ?? 0) + 1;
      } else {
        misses.push({ id: c.id, question: c.question });
      }
    }
    report.retrieval = {
      recall_at_10: +(hits / answerable.length).toFixed(3),
      top_hit_ranks: ranks,
      misses,
    };
  }

  if (sut.answer) {
    const answerable = cases.filter((c) => !c.unanswerable);
    const unanswerable = cases.filter((c) => c.unanswerable);
    let factCases = 0, factOk = 0, poisoned = 0, falseAnswers = 0;
    for (const c of answerable) {
      const a = norm(await sut.answer(c.question));
      if (c.expected_answer_facts.length) {
        factCases++;
        const aFact = normFact(a);
        if (c.expected_answer_facts.every((f) => aFact.includes(normFact(f)))) factOk++;
      }
      if (c.must_not_contain.some((m) => a.includes(norm(m)))) poisoned++;
    }
    for (const c of unanswerable) {
      const a = norm(await sut.answer(c.question));
      if (!ABSTAIN_MARKERS.some((m) => a.includes(m))) falseAnswers++;
    }
    report.answers = {
      fact_match_rate: factCases ? +(factOk / factCases).toFixed(3) : NaN,
      poison_rate: +(poisoned / answerable.length).toFixed(3),
      false_answer_rate: +(falseAnswers / Math.max(unanswerable.length, 1)).toFixed(3),
    };
  }

  if (sut.classifyTier) {
    const confusion: Record<string, Record<string, number>> = {};
    let correct = 0;
    let t3Total = 0, t3Caught = 0;
    for (const c of cases) {
      const predicted = await sut.classifyTier(c.question);
      confusion[c.expected_tier] ??= {};
      confusion[c.expected_tier][predicted] = (confusion[c.expected_tier][predicted] ?? 0) + 1;
      if (predicted === c.expected_tier) correct++;
      if (c.expected_tier === "T3") {
        t3Total++;
        if (predicted === "T3") t3Caught++;
      }
    }
    report.tiers = {
      accuracy: +(correct / cases.length).toFixed(3),
      confusion,
      t3_recall: t3Total ? +(t3Caught / t3Total).toFixed(3) : NaN,
    };
  }

  report.per_case = [...perCase.values()];
  return report;
}
