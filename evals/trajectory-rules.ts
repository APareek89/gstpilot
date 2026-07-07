// Trajectory rules — process assertions over the pipeline's ordered step log.
// Outcome evals ask "was the answer right?"; trajectory evals ask "did the system take a
// legal path to it?" — a right answer via a forbidden path (reply reached on a T3, gates
// skipped) is a latent production incident that outcome metrics can't see.

import type { PipelineResult, TrajectoryStep } from "../lib/agents/pipeline";

export function checkTrajectory(r: PipelineResult): string[] {
  const v: string[] = [];
  const names = r.trajectory.map((s: TrajectoryStep) => s.name);
  const idx = (n: string) => names.indexOf(n);

  // 1. retrieval must precede resolution (never generate before looking)
  if (idx("resolution") !== -1 && !(idx("retrieval") !== -1 && idx("retrieval") < idx("resolution")))
    v.push("resolution ran without prior retrieval");

  // 2. T3 must never reach reply synthesis — escalation is a hard wall
  if (r.tier === "T3" && (idx("reply-synthesis") !== -1 || !r.escalated))
    v.push("T3 case reached the reply stage instead of CA handoff");

  // 3. no repeated identical calls (a loop symptom: same step name 3+ times)
  const counts = new Map<string, number>();
  for (const s of names) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [name, c] of counts) if (c >= 3) v.push(`step '${name}' repeated ${c}×`);

  // 4. bounded work. The spec said ≤8 assuming coarse steps; our log gives every FREE gate
  // its own line (9 for a full healthy path), so the loop-guard bound is 10 logged steps.
  if (r.trajectory.length > 10) v.push(`trajectory has ${r.trajectory.length} steps (max 10)`);

  return v;
}
