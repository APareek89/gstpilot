// CI SMOKE — the absolute gates, asserted HARD so a regression fails the PR.
// These three are not slopes we improve over time (like fact_match) — they are CLIFFS the
// product must never fall off, so unlike answer.eval.test.ts (guard-rails only) these are real
// expect() assertions:
//   1. T3 recall = 1.0     — a dispute/notice must NEVER be answered as a routine question.
//   2. false-answer = 0    — never a confident answer about law we don't have.
//   3. citation validity   — no answer may cite a chunk retrieval didn't actually return.
// 25-case subset (all T3 + a deterministic slice of unanswerable + answerable) keeps it cheap
// enough to run per-PR; the full fact_match suite runs nightly.

import "dotenv/config";
import { describe, expect, it } from "vitest";
import { loadGolden } from "./run";
import { classifyIntake } from "../lib/agents/intake";
import { answerQuestion } from "../lib/agents/answer";

const all = loadGolden();
const T3 = all.filter((c) => c.expected_tier === "T3");
const UNANS = all.filter((c) => c.unanswerable).slice(0, 9);
const ANSWERABLE = all.filter((c) => !c.unanswerable && c.expected_tier !== "T3").slice(0, Math.max(0, 25 - T3.length - UNANS.length));
const ABSTAIN = ["don't cover", "do not cover", "cannot answer", "consult a ca", "outside the scope", "not covered"];

describe(`CI smoke — absolute gates (${T3.length}+${UNANS.length}+${ANSWERABLE.length} cases)`, () => {
  // GATE 1 — every T3 escalates. Cheapest gate (one haiku classify each).
  it("T3 recall = 1.0 — every dispute escalates to a CA", async () => {
    for (const c of T3) {
      const { intake } = await classifyIntake(c.question);
      expect(intake.tier, `${c.id} "${c.question}" must be T3`).toBe("T3");
    }
  }, 300_000);

  // GATE 2 — never answer what we can't source.
  it("false-answer = 0 — abstains on the unanswerable slice", async () => {
    for (const c of UNANS) {
      const a = (await answerQuestion(c.question)).answer.toLowerCase();
      expect(ABSTAIN.some((m) => a.includes(m)), `${c.id} must abstain: "${c.question}"`).toBe(true);
    }
  }, 600_000);

  // GATE 3 — a cited tag must be a chunk retrieval actually returned (never invented).
  it("citation validity — no answer cites an unretrieved chunk", async () => {
    for (const c of ANSWERABLE) {
      const r = await answerQuestion(c.question);
      expect(r.gate?.invalid_tags ?? [], `${c.id} cited chunks it wasn't given`).toEqual([]);
    }
  }, 600_000);
});
