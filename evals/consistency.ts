// Consistency runs: every T2 and T3 golden case ×5 through the full pipeline.
// Reported as pass^5 (case passes only if ALL 5 runs pass), not average — because a user
// doesn't experience your average: 4-of-5 right is an 80% average but a 0 in pass^5, and
// pass^5 is the number that predicts "will the same seller asking twice get burned once".
// Run: pnpm exec tsx evals/consistency.ts

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { askGSTPilot } from "../lib/agents/pipeline";
import { checkTrajectory } from "./trajectory-rules";
import { loadGolden } from "./run";
import { normalizeNumbers } from "../lib/gates/g3-recompute";

const RUNS = 5;

async function main() {
  const cases = loadGolden().filter((c) => c.expected_tier !== "T1");
  const rows: any[] = [];
  let trajViolations = 0, trajChecks = 0;

  for (const c of cases) {
    const passes: boolean[] = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await askGSTPilot(c.question);
        trajChecks++;
        const tv = checkTrajectory(r);
        if (tv.length) trajViolations++;
        let pass: boolean;
        if (c.expected_tier === "T3") pass = r.escalated;                    // the whole point of T3
        else if (c.unanswerable) pass = r.abstained;
        else {
          const a = normalizeNumbers(r.reply);
          pass = !r.abstained && !r.escalated &&
            c.expected_answer_facts.every((f) => a.includes(normalizeNumbers(f)));
          if (!c.expected_answer_facts.length) pass = !r.abstained && !r.escalated;
        }
        passes.push(pass && tv.length === 0);
      } catch { passes.push(false); }
    }
    const p5 = passes.every(Boolean);
    rows.push({ id: c.id, tier: c.expected_tier, passes: passes.map(Number).join(""), pass5: p5 });
    console.log(p5 ? "✓" : "✗", c.id, c.expected_tier, passes.map(Number).join(""));
  }

  const byTier = (t: string) => rows.filter((r) => r.tier === t);
  const p5rate = (xs: any[]) => xs.length ? (xs.filter((r) => r.pass5).length / xs.length).toFixed(3) : "n/a";
  const summary = {
    t2_pass5: p5rate(byTier("T2")), t3_pass5: p5rate(byTier("T3")),
    trajectory_rule_rate: ((1 - trajViolations / Math.max(trajChecks, 1))).toFixed(3),
    rows,
  };
  console.log("SUMMARY", JSON.stringify({ ...summary, rows: undefined }));
  writeFileSync("docs/CONSISTENCY.json", JSON.stringify(summary, null, 1) + "\n");
}

main().catch((e) => { console.error("CONSISTENCY FAILED:", e.message); process.exit(1); });
