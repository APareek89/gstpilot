// Full-path eval: the answering agent over all 60 golden cases. Run: pnpm eval:answer
// Grades what the retrieval eval can't: fact-match on answerable cases, poison strings,
// and the strictest bar in the product — false-answer rate on the 20 unanswerable cases,
// where a confident reply about law we don't have is the catastrophic outcome.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answerQuestion } from "../lib/agents/answer";
import { loadGolden, runEval } from "./run";

describe("full answer path", () => {
  it("fact match + false-answer over the golden set", async () => {
    const report = await runEval(
      {
        name: "full-path-v2 (subsection-tolerant gate + completeness + allowed-tags-named)",
        answer: async (q) => (await answerQuestion(q)).answer,
      },
      loadGolden()
    );

    console.log(JSON.stringify({ ...report, per_case: undefined }, null, 2));
    writeFileSync(
      join(process.cwd(), "docs", "EVAL_ANSWER.json"),
      JSON.stringify(report, null, 2) + "\n"
    );

    const { getServiceClient, TABLE_PREFIX } = await import("../lib/supabase");
    const { per_case, ...metrics } = report;
    await getServiceClient().from(`${TABLE_PREFIX}eval_runs`).insert({
      sut: report.sut, cases: report.cases, report: metrics, per_case,
    });

    // Guard rails only — targets (fact ≥ 0.8, false-answer = 0) are judged by humans
    // reading the report, not hidden inside an assertion that stops the data landing.
    expect(report.answers).toBeDefined();
  }, 3_600_000);
});
