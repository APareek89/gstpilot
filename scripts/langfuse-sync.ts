// Syncs the golden set to a Langfuse dataset and pushes recorded eval runs as traces with
// scores. Run: pnpm langfuse:sync
// Idempotent both ways: dataset items upsert on their case id; eval runs are pushed with
// the run's uuid as trace id, so re-running the sync never duplicates.
// Why Langfuse at all when /admin/evals exists: Langfuse ties eval scores to the FULL model
// traces (Phase 5's generation calls land there too), keeps history hosted, and gives us
// side-by-side experiment comparison without building more admin UI.

import "dotenv/config";
import { getLangfuse } from "../lib/observability/langfuse";
import { loadGolden } from "../evals/run";
import { getServiceClient, TABLE_PREFIX } from "../lib/supabase";

const DATASET = "gstpilot-golden";

async function main() {
  const lf = getLangfuse();

  // 1. dataset upsert
  await lf.createDataset({
    name: DATASET,
    description: "GSTPilot golden set — schema evals/golden-schema.ts, guide docs/LABELING_GUIDE.md",
  }).catch(() => { /* exists — fine */ });

  const cases = loadGolden();
  for (const c of cases) {
    await lf.createDatasetItem({
      datasetName: DATASET,
      id: c.id, // stable id => upsert, not duplicate
      input: { question: c.question },
      expectedOutput: {
        intent: c.expected_intent,
        tier: c.expected_tier,
        unanswerable: c.unanswerable,
        relevant_chunk_ids: c.relevant_chunk_ids,
        facts: c.expected_answer_facts,
      },
      metadata: { status: c.status, policy_version: c.policy_version },
    });
  }
  console.log(`✓ dataset '${DATASET}': ${cases.length} items upserted`);

  // 2. eval runs -> traces with scores
  const { data: runs } = await getServiceClient()
    .from(`${TABLE_PREFIX}eval_runs`)
    .select("id, created_at, sut, cases, report")
    .order("created_at", { ascending: true });

  for (const run of runs ?? []) {
    const rep = run.report as any;
    const trace = lf.trace({
      id: run.id, // uuid reuse => idempotent
      name: "golden-eval-run",
      timestamp: new Date(run.created_at),
      metadata: { sut: run.sut, cases: run.cases, report: rep },
    });
    if (rep.retrieval) trace.score({ name: "recall_at_10", value: rep.retrieval.recall_at_10 });
    if (rep.answers) {
      trace.score({ name: "false_answer_rate", value: rep.answers.false_answer_rate });
      trace.score({ name: "fact_match_rate", value: rep.answers.fact_match_rate });
    }
    if (rep.tiers) trace.score({ name: "t3_recall", value: rep.tiers.t3_recall });
  }
  console.log(`✓ pushed ${runs?.length ?? 0} eval runs as traces with scores`);

  await lf.flushAsync();
  await lf.shutdownAsync();
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
