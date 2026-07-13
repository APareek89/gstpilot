# GSTPilot — changing a pinned model

Every model in GSTPilot is **pinned** to an exact snapshot, on purpose:

- `GENERATION_MODEL = "claude-sonnet-4-6"` (`lib/agents/answer.ts`) — the answer writer.
- `claude-haiku-4-5-20251001` — intake/G1, query transform, reply synthesis, G5, triage pre-draft.
- `EMBEDDING.modelId = "Xenova/bge-m3"` (`lib/retrieval/config.ts`) — the retriever. **Its `revision`
  must be pinned to a commit hash before any re-embed you rely on** — a silent upstream weight update
  shifts every vector with no error anywhere (see LEARNING_LOG session 4).

**Why pin:** a model is a dependency like any other. An un-pinned model means the product's behavior
changes when a vendor ships, not when *you* ship — and you find out from a 👎, not a diff. Pinning
turns "the model changed" into a deliberate, tested, reversible event.

**A new snapshot is a migration, not a config tweak.** Never bump the string and deploy. Run the 2×2
on the golden set first.

---

## The 2×2 — before cutover, run four cells on the golden set

A model change and a prompt change are **entangled**: prompts are tuned to a model's quirks (the
citation gate's heuristics are fitted to Sonnet's current output style; see LEARNING_LOG session 6).
If you swap the model and the number moves, you can't tell whether the *model* is worse or your
*old prompt* just doesn't fit the *new model*. The 2×2 separates them.

|                   | **Old prompt**        | **New prompt (re-tuned for new model)** |
|-------------------|-----------------------|------------------------------------------|
| **Old model**     | **A — baseline**      | **B**                                    |
| **New model**     | **C — naive swap**    | **D — candidate**                        |

Run all four on the golden set (`pnpm eval:answer:full`, plus the smoke gates). What each cell
**isolates**:

- **A (old model, old prompt) — the baseline.** The number you must not regress against. Everything
  is read relative to A.
- **C (new model, old prompt) — the naïve swap.** This is what you'd ship if you *only* changed the
  string. **C vs A is the pure model effect, holding the prompt fixed.** If C ≥ A, the new model is at
  least as good on your current harness. If C < A, don't conclude the model is worse yet — it may just
  be mis-prompted (that's what D tests).
- **B (old model, new prompt) — the prompt effect, holding the model fixed.** Tells you whether your
  re-tuned prompt helps *independent* of the model. If B > A, some of your "new model" win is really a
  prompt win you could have had anyway — don't credit it to the model.
- **D (new model, new prompt) — the real candidate.** What you'd actually ship. **D is the cutover
  decision.** But read it *with* B and C: D beating A only counts as a model win to the extent
  **C ≥ A** and **D − C > B − A** (the new model adds beyond what the prompt alone bought you).

**The trap the 2×2 catches:** shipping D because "D > A", when actually C < A (the new model is
worse) and D only looks good because the new prompt is doing all the work — a prompt you could have
applied to the old, cheaper, known-good model. Without B and C you'd have paid for a downgrade and
called it an upgrade.

---

## Cutover checklist

1. **Read the migration guide** for the new snapshot (breaking params, thinking/effort changes,
   output-format shifts) — a 400 from a removed parameter is a wasted 2×2. Use the `claude-api` skill.
2. **Branch.** Bump the pinned string in one commit so it's revertible.
3. **Run the 2×2** on the golden set — all four cells, gates + fact_match. Record A/B/C/D in the PR.
4. **Decision rule:** ship D only if the **absolute gates hold** (false-answer 0, T3 recall 1.0,
   citation validity) in D **and** D is a genuine model win over the prompt-only gain (D − C > B − A).
   A gate regression in D is an automatic no, regardless of fact_match.
5. **Embedding model is special:** a new embedding snapshot means **re-embed every chunk** (vectors
   from two model versions must never coexist — cosine across versions is meaningless) and re-run the
   retrieval eval. Pin the new `revision` to a commit hash in the same PR.
6. **Prompt heuristics fitted to the old model:** audit the citation gate's claim-markers and
   bullet-inheritance rules, and the calculators' formats — a style shift in the new model can flood
   false gate-abstentions (visible as an abstention-rate spike) or let untagged claims through
   (invisible — trust the eval, not the vibes).
7. **After cutover:** watch the `/admin/triage` 👎 rate for a week. A model change that passed the
   golden set can still surprise you on real traffic the golden set doesn't cover yet — which is the
   flywheel's whole point.
