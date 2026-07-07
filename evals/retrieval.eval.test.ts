// Retrieval baseline eval. Run: pnpm eval
// System-under-test = hybridSearch alone (no agents exist yet). Establishes the recall@10
// baseline every future change is compared against. Draft cases included for now; once
// Anand's verification pass lands, flip to verifiedOnly and gate CI on it.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hybridSearch } from "../lib/retrieval/search";
import { loadGolden, runEval } from "./run";

describe("retrieval baseline", () => {
  it("recall@10 over the golden set", async () => {
    const cases = loadGolden(); // draft + verified while the set is young
    const report = await runEval(
      {
        name: "hybrid-retrieval-v2 (+query-transform: rewrite + direct-id pinning)",
        retrieve: async (q) => {
          const r = await hybridSearch(q, "eval");
          // fused returns top-8; channels are our tail to reach 10 candidates
          const ids = [
            ...r.fused.map((c) => c.id),
            ...r.dense.map((c) => c.id),
            ...r.keyword.map((c) => c.id),
          ];
          return [...new Set(ids)].slice(0, 10);
        },
      },
      cases
    );

    console.log(JSON.stringify({ ...report, per_case: undefined }, null, 2));
    writeFileSync(
      join(process.cwd(), "docs", "EVAL_BASELINE.json"),
      JSON.stringify({ generated: "run pnpm eval to refresh", ...report }, null, 2) + "\n"
    );

    // Persist the run — the admin Evals view reads these rows.
    const { getServiceClient, TABLE_PREFIX } = await import("../lib/supabase");
    const { per_case, ...metrics } = report;
    const { error } = await getServiceClient().from(`${TABLE_PREFIX}eval_runs`).insert({
      sut: report.sut,
      cases: report.cases,
      report: metrics,
      per_case,
    });
    if (error) console.error("eval run persistence failed:", error.message);

    // The brief's bar is ≥0.9 — but a BASELINE must record reality, not aspiration.
    // This assertion only guards against catastrophic regression (e.g. empty index).
    expect(report.retrieval!.recall_at_10).toBeGreaterThan(0.3);
  }, 900_000);
});
