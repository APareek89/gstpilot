# Golden-set labeling guide (v1.1 — edited by Claude, ratified by Anand)

Every case gets five judgment labels. This guide defines each with contrastive pairs, so two
people labeling the same question independently land on the same answer. If a real case ever
forces a rule to change, bump this guide's version AND the policy_version of re-checked cases.

## The 10-second tier decision

1. Has a proceeding already started (notice, seizure, penalty order, audit, appeal)? → **T3. Stop.**
2. Does the answer compute or commit THIS user's money or deadline? → **T2.**
3. Otherwise (how the rule works, what rate, which form) → **T1.**
4. Torn between two? → **the higher tier wins.** (T3 recall must be 1.0 — over-escalating a
   routine question costs a little; under-escalating a notice costs the user real harm.)

## expected_tier — the risk ladder (from the product brief)

| tier | meaning | system behavior | examples |
|---|---|---|---|
| **T1** | routine information; being wrong is cheap to correct | answer with citations | "footwear ka rate?", "GSTR-3B due date?" |
| **T2** | money or a deadline rides on the answer | answer, but only through validation gates; calculators in code | "kitna late fee lagega?", "ITC reverse karna padega?", "refund kitna milega?" |
| **T3** | notice, penalty proceedings, dispute, or anything a wrong answer makes worse | do NOT answer substantively → "consult a CA" + clean handoff summary | "department se notice aaya hai", "penalty ka order mila", "appeal kaise karu" |

**Contrastive pairs:**
- "late fee **kya hoti hai** GSTR-1 pe?" → **T1** (how the rule works) vs
  "meri GSTR-1 **8 mahine late** hai, kitna lagega?" → **T2** (their money, computed).
- "e-way bill kab chahiye?" → **T1** vs
  "goods **seize ho gaye** e-way bill ke bina, ab kya karu?" → **T3** (proceedings started).
- The tie-breaker rule: **if unsure between two tiers, pick the higher one.** T3 recall must
  be 1.0 — the one unforgivable mistake is labeling a real T3 as T1/T2.

## expected_intent
One label from the closed list in `evals/golden-schema.ts`. Pick what the user NEEDS, not the
words they used: "Swiggy pe GST kaun bharega" mentions a rate nowhere but is
`ecommerce_liability`. `out_of_scope` is reserved for questions whose ANSWER isn't in GST law
at all (income tax, customs, SGST section numbers, professional tax).

## unanswerable
`true` when the honest response is "the sources don't cover this". Two flavours both count:
(a) out-of-scope law (income tax TDS 194-O), (b) in-scope but absent from our corpus (state
SGST act sections — we deliberately excluded them). NOT unanswerable: hard-but-answerable
questions; those are just difficult cases.

## relevant_chunk_ids
The chunks a perfect retriever would surface — the ones a CA would actually cite. Rules:
include the provision AND its operative amendment when both matter; prefer the specific
provision over generic levy sections (s16 beats s9 for an ITC question); 1–4 ids typical.
Find ids via the Chunk Inspector (search text) — never from memory.

## expected_answer_facts
Exact strings/numbers a correct answer must contain, machine-checkable after normalization:
`"₹50 per day"` `"section 16(4)"` `"30th November"` `"18%"`. Only facts you personally
verified in the source PDF. Empty list = we only grade retrieval/tier for this case.

## must_not_contain
Poison strings that auto-fail: an old rate the 2025 overhaul replaced ("12%" on a footwear
answer), a repealed provision ("section 43A"), or "consult a CA" appearing on a T1 rate
lookup (over-abstention is also a failure).

## status
`draft` (labels unverified) → `verified` (Anand checked every fact against the source PDF;
only these gate CI) → `retired` (law changed; keep for history, exclude from runs).

## Common labeling mistakes (each found in a real draft)

1. **Expecting law that doesn't exist.** "footwear rate in Gurgaon" expecting NCR-specific
   content — GST rates are India-uniform; location changes the CGST/SGST-vs-IGST split, not
   the rate. Verify the answer EXISTS before labeling where it lives.
2. **Labeling by vocabulary instead of need.** "Swiggy pe GST kaun bharega" contains no rate
   words but is ecommerce_liability, not rate_lookup.
3. **Marking hard questions unanswerable.** Unanswerable means the corpus cannot answer it,
   not that answering is complicated.
4. **Facts from memory.** Every expected_answer_fact comes from a source PDF opened during
   verification — GST numbers changed in 2018, 2021, 2022 and 2025; memory serves stale law.
5. **Generic chunk over specific.** For "can I claim ITC on X", cite s16/s17, not s9 (levy) —
   the levy section is topically near everything and proves nothing.
