# The gate table (Phase 6)

Pipeline: intake → [G1] → (T3 → CA handoff) → retrieval → [G2] → resolution → [G4] → [G3] → reply → [G5] → user.
Ladder rule: catch each failure on the cheapest rung that can see it. Every failure path is
named-regeneration → abstention/escalation — safe, never silent.

| gate | checks | machine | on failure | cost |
|---|---|---|---|---|
| G1 | intake JSON valid, intent ∈ 12 labels, tier ∈ {T1,T2,T3}; T3 short-circuits to CA handoff | zod schema + enums | one re-ask → default **T3** (fail UP the risk ladder) | free |
| G2 | best dense cosine ≥ threshold (0.45 placeholder — Anand tunes; distributions overlap, so G2 only stops nothing-even-close retrievals; false-answer defense lives downstream) | threshold | skip generation → honest can't-answer + CA option | free |
| G4 *(Phase 5)* | cited ids ⊆ retrieved ∪ calculator ids; every claim-sentence tagged (bullets may inherit block tag) | set arithmetic + claim markers | named regen → abstain | free |
| G3 | every figure (₹/%/days/months) in the draft re-found in cited chunk text or calculator output, notation-normalized | plain code recompute | named regen → abstain | free |
| G5 | "does the reply claim anything beyond the approved resolution? list violations or PASS" | haiku (verification-only) | ship the approved resolution instead of the rewrite | ~1s, ~₹0.05 |

Why G5 may be a model when G3 must not be: verification is an easier task than generation,
and semantic leakage (a rephrase that quietly strengthens a claim) is invisible to string
checks — a reader is the only detector. Numbers, by contrast, are perfectly visible to code,
so spending a model there would add nondeterminism to a solved problem.

Trajectory rules (evals/trajectory-rules.ts): retrieval-before-resolution ·
T3-never-reaches-reply · no step repeated 3× · ≤10 logged steps (spec said 8 coarse steps;
our log lines every free gate separately — 9 for a healthy full path).

Tier eval (60 cases): accuracy 0.867 · **T3 recall 1.0** ✓ · errors lean safe (T1→T3 over-escalation:
1; T2→T1 under-tiering: 6 — harmless today since T1/T2 share a path, revisit when T2 gets
extra treatment).
