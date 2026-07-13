# GSTPilot — the weekly dashboard

The numbers to look at, what each one means, and — the part that actually matters — **the first
question to ask when one moves.** A metric you can't act on is decoration. Every row below has a
"first move."

Sources: `/admin/evals` (eval runs), Langfuse (per-trace), `/admin/triage` (production 👎),
`/admin/traces` (retrieval flight-recorder).

---

## Read a change as a CLIFF or a SLOPE first

Before diagnosing *what* broke, classify *how* it broke — the shape tells you where to look:

- **Cliff** — a metric drops sharply between two runs with little code change. Something **broke
  discretely**: a format contract, a seam, a config. Cliffs have a single cause and a single commit.
- **Slope** — a metric drifts over many runs. Something is **wandering**: prompt rot, corpus drift,
  a model quietly re-tuned, tail latency creeping. Slopes have no single commit; they need a trend line.

> The mistake is treating a cliff like a slope (endless tuning when one commit broke a contract) or
> a slope like a cliff (reverting one commit when the whole trend is drifting). **Shape first.**

Three named cliff/creep patterns and their first question:

| Pattern | Looks like | First question |
|---|---|---|
| **Schema cliff** | a metric goes to ~0 in one run; parsing/validation errors spike | *What format contract broke?* A tag regex, a JSON shape, an id scheme, a prompt's output spec. (This is how fact_match hit 0 in Phase 5 — a notation break, not a knowledge loss.) |
| **Propagation cliff** | one layer's number is fine, the next layer's collapses | *Which seam broke?* Data crossing a boundary — retrieval→generation truncation, transform→search, embed-model vs stored-vectors. (The 6,000-char embed truncation was a seam between two phases.) |
| **Tail-latency creep** | p50 flat, p95/p99 rising over weeks | *What's wandering?* A retry loop, a giant chunk, a slow model call added to the hot path, a growing prompt. Watch p95, not the mean — the mean hides the unlucky user. |

---

## The gates — these are CLIFFS. Any move is an incident.

| Metric | Healthy | If it moves, first move |
|---|---|---|
| **false-answer rate** (unanswerable slice) | **0** | Non-zero = we bluffed on law we don't have. This is the catastrophic metric. Find the case in the nightly run, read its trace: did retrieval hand up a weak-but-plausible chunk (G2 floor too low), or did the gate let an uncited claim through? Never "tune" this — fix the specific hole. |
| **T3 recall** | **1.0** | < 1.0 = a dispute got answered as routine. Read the misclassified case; the intake classifier defaults *up* to T3 on doubt, so a miss means the prompt's T3 definition has a gap. |
| **citation validity** (invalid_tags) | **[]** | Non-empty = an answer cited a chunk it wasn't given. The deterministic gate should make this impossible — a non-empty result means the tag regex or the allowed-set assembly changed. Schema cliff. |
| **poison rate** | **0** | A must-not-contain string appeared. Read which case; usually a retrieval miss pulling an adjacent-but-wrong rate/section. |

The 25-case CI smoke asserts the first three on every PR. If the smoke is red, **do not merge** —
read the named failing case, don't retry hoping for green.

---

## The slopes — these are trends. Watch the line, not the point.

| Metric | Read it as | First move on a bad slope |
|---|---|---|
| **fact_match** (mean pass-rate, `EVAL_REPEAT`) | how often answers carry the specific number/date/form | It's a slope AND noisy (±0.03 even stabilized) — never react to one run. If the trend is down over a week: is it retrieval (the fact-bearing chunk not reaching the agent — check `/admin/traces`) or the gate (right chunk, but force-abstained — check for the 101-char abstention)? Those need opposite fixes. |
| **abstention rate** (answerable cases) | over-caution — the gate refusing groundable answers | Rising = the gate got stricter or the model's output style drifted from what the gate expects. This is the #1 fact_match suppressor. |
| **recall@10** (retrieval eval) | did the relevant chunk make the top-10 | A slope down usually means corpus/embedding drift. **If recall looks fine but fact_match is bad, the chunk is ranking but its content isn't reaching the answer** — a propagation problem, not a retrieval one. |
| **tokens / reply** (Langfuse) | cost + a latency proxy | Creep = a giant chunk entering more answers, or a prompt growing. Check the p95, and which chunks dominate the source block. |

---

## Production signal (the flywheel's fuel)

| Number | Where | First move |
|---|---|---|
| **👎 in queue** | `/admin/triage` | Each is a free test case. Triage it: pre-draft → **you verify every label** → approve. A 👎 you don't triage is a bug you've agreed to ship again. |
| **👎 rate** (👎 / replies) | Langfuse `user_feedback` | A rising rate on one intent (e.g. refunds) points the next fix. |
| **golden set version** | `evals/golden.json` `version` | It should go **up** every week. A flat version = a depreciating asset (the set is frozen while reality moves). |

---

## The weekly ritual (10 minutes)

1. **CI green?** Any smoke failure this week — was it caught pre-merge? (If a gate broke in prod, the smoke has a hole → add the case.)
2. **Gates at target?** false-answer 0, T3 recall 1.0, citation validity []. Any move = incident, classify cliff vs slope.
3. **Slopes trending?** fact_match / abstention / recall over the last ~7 nightly runs. Line, not point.
4. **Triage queue drained?** Every 👎 → golden (you approve). Version bumped.
5. **Tail latency?** p95 tokens/latency creeping? What entered the hot path.
