// The golden-append pipeline (Phase 8 flywheel, step 2). Turns an APPROVED production failure
// into a permanent golden case: assigns the next stable id, stamps production provenance + the
// source trace id, bumps the dataset version, VALIDATES, then writes evals/golden.json.
//
// Why version-bump on every append: the golden set IS the product's spec. A spec change that
// isn't versioned can't be diffed, blamed, or rolled back. Why validate before writing: one
// malformed case breaks every future eval run — fail loudly here, not mysteriously at 2am in CI.
// Why status is caller-controlled: only a HUMAN-approved case becomes "verified" (gates CI);
// an un-approved capture stays "draft" (recorded, never gating) — because these labels feed
// zero-tolerance gates, and a wrong "expected fact" would teach CI to enforce a wrong answer.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateCase, type GoldenCase } from "../../evals/golden-schema";

const GOLDEN_PATH = join(process.cwd(), "evals", "golden.json");

type GoldenFile = { _readme?: string; version: string; cases: GoldenCase[] };

// The label fields a draft must carry; append supplies id/status/provenance/version/trace.
export type GoldenDraft = Pick<
  GoldenCase,
  "question" | "expected_intent" | "expected_tier" | "unanswerable" |
  "relevant_chunk_ids" | "expected_answer_facts" | "must_not_contain"
> & { note?: string };

function readGolden(): GoldenFile {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
}

// Next stable id = max existing g-number + 1. Ids are NEVER reused or renumbered — tests
// reference them by hand.
function nextId(cases: GoldenCase[]): string {
  const max = cases.reduce((m, c) => {
    const n = Number(c.id.replace(/\D/g, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `g${String(max + 1).padStart(3, "0")}`;
}

// Patch-bump the dataset version per appended case (2.0.0 → 2.0.1 → …).
function bumpVersion(version: string): string {
  const p = (version || "2.0.0").split(".").map((x) => Number(x) || 0);
  return `${p[0] ?? 2}.${p[1] ?? 0}.${(p[2] ?? 0) + 1}`;
}

export type AppendResult = { ok: boolean; id: string; version: string; problems: string[] };

// Append one production case. `approvedBy` non-null ⇒ status "verified" (it WILL gate CI) and
// must only be set after a human checked every label against source. null ⇒ "draft" (captured,
// never gates). Returns problems (and writes NOTHING) if the assembled case fails validation.
export function appendGoldenCase(
  draft: GoldenDraft,
  opts: { sourceTraceId?: string; approvedBy?: string | null; policyVersion?: string; today?: string }
): AppendResult {
  const file = readGolden();
  const id = nextId(file.cases);
  const approvedBy = opts.approvedBy ?? null;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const gc: GoldenCase = {
    ...draft,
    id,
    status: approvedBy ? "verified" : "draft",
    policy_version: opts.policyVersion ?? today,
    source_trace_id: opts.sourceTraceId,
    provenance: { author: "production", verified_by: approvedBy, verified_on: approvedBy ? today : null },
  };

  const problems = validateCase(gc);
  if (problems.length) return { ok: false, id, version: file.version ?? "2.0.0", problems };

  file.cases.push(gc);
  file.version = bumpVersion(file.version);
  writeFileSync(GOLDEN_PATH, JSON.stringify(file, null, 2) + "\n");
  return { ok: true, id, version: file.version, problems: [] };
}
