// Validates evals/golden.json (v2 schema). Run: pnpm golden:validate
// Two layers of checking: (1) schema/label validity via validateCase() — closed intent set,
// tier sanity, unanswerable consistency; (2) database truth — every relevant_chunk_id must
// exist AND be in-force law. A golden set pointing at imaginary or superseded chunks would
// redefine "correct" as failure (or as hallucinated law). Exit code 0 = safe to commit.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCase, type GoldenCase } from "../evals/golden-schema";
import { getServiceClient, TABLE_PREFIX } from "../lib/supabase";

async function main() {
  const golden = JSON.parse(readFileSync(join(process.cwd(), "evals", "golden.json"), "utf8"));
  const cases: GoldenCase[] = golden.cases;
  const problems: string[] = [];

  // layer 1: schema + labeling rules
  for (const c of cases) problems.push(...validateCase(c));
  const ids = cases.map((c) => c.id);
  new Set(ids).size !== ids.length && problems.push("duplicate case ids");

  // layer 2: every referenced chunk exists and is in force
  const allChunkIds = [...new Set(cases.flatMap((c) => c.relevant_chunk_ids))];
  const { data } = await getServiceClient()
    .from(`${TABLE_PREFIX}legal_chunks`)
    .select("id, status")
    .in("id", allChunkIds);
  const found = new Map((data ?? []).map((r: { id: string; status: string }) => [r.id, r.status]));
  for (const c of cases) {
    for (const id of c.relevant_chunk_ids) {
      if (!found.has(id)) problems.push(`${c.id}: chunk '${id}' does not exist`);
      else if (found.get(id) !== "in_force") problems.push(`${c.id}: chunk '${id}' is ${found.get(id)}`);
    }
  }

  const by = (f: (c: GoldenCase) => string) =>
    [...cases.reduce((m, c) => m.set(f(c), (m.get(f(c)) ?? 0) + 1), new Map())].map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`cases=${cases.length} | ${by((c) => (c.unanswerable ? "unanswerable" : "answerable"))}`);
  console.log(`tiers: ${by((c) => c.expected_tier)} | status: ${by((c) => c.status)}`);

  if (problems.length) {
    problems.forEach((p) => console.log("✗ " + p));
    process.exit(1);
  }
  console.log("✓ golden set valid");
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
