// THE PIPELINE — the supervised team. Orchestrates:
// intake → [G1 zod+enum, T3 short-circuit] → retrieval → [G2 relevance floor] →
// resolution (Phase 5 grounded generation + [G4 citations]) → [G3 recompute numbers] →
// reply synthesis → [G5 haiku unsupported-claim check] → user.
// Every step appends to an ordered TRAJECTORY (logged to Langfuse) so eval rules can assert
// process properties: retrieval-before-resolution, T3-never-reaches-reply, steps ≤ 8.

import Anthropic from "@anthropic-ai/sdk";
import { classifyIntake, caHandoff, type Intake } from "./intake";
import { answerQuestion } from "./answer";
import { ABSTAIN_PHRASE } from "../gates/verify-citations";
import { recomputeNumbers } from "../gates/g3-recompute";
import { getLangfuse } from "../observability/langfuse";

// G2 threshold: max dense cosine of the retrieval's best chunk. PLACEHOLDER until Anand
// tunes it on the golden score distributions (his ⚠️ task) — see docs/GATES.md.
export const G2_MIN_RELEVANCE = 0.45;

export type TrajectoryStep = { step: number; name: string; ok: boolean; ms: number; note?: string };
export type PipelineResult = {
  reply: string;
  traceId: string;
  tier: Intake["tier"];
  intent: Intake["intent"];
  escalated: boolean;   // T3 → CA handoff
  abstained: boolean;
  trajectory: TrajectoryStep[];
};

const REPLY_PROMPT = (question: string, resolution: string) => `Rewrite this approved GST resolution as a short, warm reply to a small-business seller. KEEP every [SOURCE-ID] tag exactly where its claim is; keep all numbers exactly; keep the exact phrase "${ABSTAIN_PHRASE}" if present; same language mix as the user. Plain sentences and "- " bullets ONLY — no markdown headings, no bold, no tables. No new information — you may only rephrase.

User question: ${question}
Approved resolution:
${resolution}`;

const G5_PROMPT = (reply: string, resolution: string) => `You are a verification checker. Compare REPLY against APPROVED. List every claim in REPLY that is NOT supported by APPROVED (new facts, changed numbers, stronger promises). Output ONLY "PASS" or a numbered list of violations.

APPROVED:
${resolution}

REPLY:
${reply}`;

export type PipelineOpts = { context?: string; onStep?: (s: TrajectoryStep) => void };

export async function askGSTPilot(question: string, opts: PipelineOpts = {}): Promise<PipelineResult> {
  const lf = getLangfuse();
  const trace = lf.trace({ name: "pipeline", input: question });
  const trajectory: TrajectoryStep[] = [];
  let n = 0;
  const log = (name: string, ok: boolean, t0: number, note?: string) => {
    const st = { step: ++n, name, ok, ms: Date.now() - t0, note };
    trajectory.push(st);
    opts.onStep?.(st);
    trace.event({ name, metadata: { ok, note } });
  };

  // 1. intake + G1 (zod inside classifyIntake; double-failure defaults to T3)
  let t0 = Date.now();
  const { intake, g1_retries } = await classifyIntake(opts.context ? `${opts.context}\n\nCurrent question: ${question}` : question);
  log("intake", true, t0, `${intake.intent}/${intake.tier}`);
  log("G1-schema", g1_retries < 2, t0, g1_retries ? `retries=${g1_retries}` : undefined);

  // T3 short-circuit: proceedings belong with a professional, not a language model.
  if (intake.tier === "T3") {
    t0 = Date.now();
    const reply = caHandoff(question, intake);
    log("ca-handoff", true, t0);
    trace.update({ output: reply, metadata: { escalated: true } });
    await lf.flushAsync().catch(() => {});
    return { reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: true, abstained: false, trajectory };
  }

  // 2+3. retrieval + resolution (answerQuestion = hybridSearch + grounded generation + G4)
  t0 = Date.now();
  const res = await answerQuestion(question, undefined, opts.context);
  log("retrieval", true, t0, res.retrieval.fused.slice(0, 3).map((c) => c.id).join(","));

  // G2: relevance floor — if even the BEST chunk is weakly related, generation ran on sand.
  const bestDense = res.retrieval.dense[0]?.score ?? 0;
  const g2ok = bestDense >= G2_MIN_RELEVANCE;
  log("G2-retrieval-floor", g2ok, t0, `best cosine ${bestDense.toFixed(3)} vs ${G2_MIN_RELEVANCE}`);
  if (!g2ok) {
    const reply = `${ABSTAIN_PHRASE.charAt(0).toUpperCase() + ABSTAIN_PHRASE.slice(1)} — mere paas is topic pe koi seedha source nahi mila. Aap chahen to CA se confirm kar sakte hain.`;
    trace.update({ output: reply, metadata: { g2_blocked: true } });
    await lf.flushAsync().catch(() => {});
    return { reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: true, trajectory };
  }
  log("resolution", !res.abstained, t0, res.regenerated ? "G4 regen used" : undefined);
  log("G4-citations", res.gate?.ok ?? false, t0);

  // G3: recompute-don't-trust — every figure re-verified against cited text / calculators.
  t0 = Date.now();
  let draft = res.answer;
  if (!res.abstained) {
    let g3 = recomputeNumbers(draft, res.chunkTextById, res.toolOutputs);
    if (!g3.ok) {
      const retry = await answerQuestion(question, `These figures failed number verification against their cited sources — fix or remove them:\n${g3.violations.join("\n")}`);
      draft = retry.answer;
      g3 = recomputeNumbers(draft, retry.chunkTextById, retry.toolOutputs);
      if (!g3.ok) draft = `${ABSTAIN_PHRASE.charAt(0).toUpperCase() + ABSTAIN_PHRASE.slice(1)}. Aap kisi CA se confirm kar lein.`;
    }
    log("G3-recompute", g3.ok, t0, g3.ok ? undefined : `${g3.violations.length} violations`);
  }

  // 4. reply synthesis + G5 (model verifying, not generating — verification is the easier task)
  t0 = Date.now();
  let reply = draft;
  const abstainedNow = draft.toLowerCase().includes(ABSTAIN_PHRASE) && (res.gate?.cited.length ?? 0) === 0;
  if (!abstainedNow) {
    try {
      const anthropic = new Anthropic();
      const rep = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001", max_tokens: 900, temperature: 0,
        messages: [{ role: "user", content: REPLY_PROMPT(question, draft) }],
      });
      const candidate = rep.content[0].type === "text" ? rep.content[0].text : draft;
      const check = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001", max_tokens: 300, temperature: 0,
        messages: [{ role: "user", content: G5_PROMPT(candidate, draft) }],
      });
      const verdict = check.content[0].type === "text" ? check.content[0].text.trim() : "FAIL";
      const g5ok = verdict.toUpperCase().startsWith("PASS");
      log("reply-synthesis", true, t0);
      log("G5-claim-check", g5ok, t0, g5ok ? undefined : verdict.slice(0, 120));
      // G5 failure policy: the APPROVED resolution is already safe — ship it instead of
      // the prettier-but-leaky rewrite. Tone is never worth a fabricated claim.
      reply = g5ok ? candidate : draft;
    } catch {
      reply = draft; // reply layer is cosmetic; its failure must never block a safe answer
      log("reply-synthesis", false, t0, "reply layer failed — shipping resolution as-is");
    }
  }

  trace.update({ output: reply, metadata: { tier: intake.tier, abstained: abstainedNow } });
  await lf.flushAsync().catch(() => {});
  return { reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: abstainedNow, trajectory };
}
