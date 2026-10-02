import {historicalCoverage} from "../repositories/corpus";
// THE PIPELINE — the supervised team. Orchestrates:
// intake → [G1 zod+enum, T3 short-circuit] → retrieval → [G2 relevance floor] →
// resolution (Phase 5 grounded generation + [G4 citations]) → [G3 recompute numbers] →
// reply synthesis → [G5 haiku unsupported-claim check] → user.
// Every step appends to an ordered TRAJECTORY (logged to Langfuse) so eval rules can assert
// process properties: retrieval-before-resolution, T3-never-reaches-reply, steps ≤ 8.

import Anthropic from "../providers/client";
import { classifyIntake, caHandoff, type Intake } from "./intake";
import { answerQuestion } from "./answer";
import { runCalculationLane, tryGeneralMath } from "./lanes/calculation";
import {isPlainArithmetic} from './arithmetic-scope';
import { runRateLane } from "./lanes/rate";
import { runTimelineLane } from "./lanes/timeline";
import { runGuidanceLane } from "./lanes/guidance";
import { reconcileLane, type Lane, type LaneOutcome, type LaneExtras } from "./lanes";
import { isFresh, detectStance, type PendingState } from "../memory/working";
import { memoryContextBlock, type MemoryBundle } from "../memory/store";
import { ABSTAIN_PHRASE } from "../gates/verify-citations";
import { recomputeNumbers } from "../gates/g3-recompute";
import { beginBlindspotExecution, getLangfuse, recordGeneration } from "../observability/langfuse";

const HAIKU = "claude-haiku-4-5-20251001";

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
  // Working-memory instruction back to the route: object = persist on the thread, null = clear,
  // undefined = leave whatever is stored untouched.
  pending?: PendingState | null;
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

export type PipelineOpts = {
  context?: string;
  onStep?: (s: TrajectoryStep) => void;
  threadId?: string;
  userId?: string;              // → Langfuse userId: every trace attributable to a person
  memory?: MemoryBundle | null; // durable memory (profile + facts), loaded by the route
  pending?: PendingState | null; // the thread's persisted working memory (a gather in progress)
};

export async function askGSTPilot(question: string, opts: PipelineOpts = {}): Promise<PipelineResult> {
  const lf = getLangfuse();
  // ONE trace per user turn. sessionId = the conversation thread → Langfuse groups every turn of a
  // conversation into one SESSION (the "see the whole session" view). All sub-steps (intake, the
  // sonnet generation, gates, reply) nest UNDER this trace as generation nodes — no more a second
  // stray "answer" trace per turn.
  const trace = lf.trace({ name: "pipeline", input: question, sessionId: opts.threadId, userId: opts.userId });
  const blindspotExecution = beginBlindspotExecution(trace.id, question, opts.threadId);
  // Every successful exit goes through one boundary: end the agent root, mark the execution
  // completed, and flush its model nodes before returning the answer to the API route.
  const complete = async (result: PipelineResult): Promise<PipelineResult> => {
    await blindspotExecution.complete(result.reply);
    return result;
  };
  const trajectory: TrajectoryStep[] = [];
  let n = 0;
  const log = (name: string, ok: boolean, t0: number, note?: string) => {
    const st = { step: ++n, name, ok, ms: Date.now() - t0, note };
    trajectory.push(st);
    opts.onStep?.(st);
    trace.event({ name, metadata: { ok, note } });
  };

  // 1. intake + G1 (zod inside classifyIntake; double-failure defaults to T3)
  // Memory injection (a): the durable-memory block joins the intake input as CONTEXT — it helps
  // the classifier read a vague question ("mera product" = footwear), and its header forbids
  // using it as a source of rates/amounts. It is NOT merged into opts.context, which also feeds
  // fillSlots — the slot extractor must only ever see the user's own words.
  let t0 = Date.now();
  const memBlock = memoryContextBlock(opts.memory ?? null);
  const intakeInput = [memBlock, opts.context ? `${opts.context}\n\nCurrent question: ${question}` : question].filter(Boolean).join("\n\n");
  const { intake, g1_retries, serviceError } = await classifyIntake(intakeInput, trace);

  // Service hiccup (not a real classification): say so honestly and let the user retry, rather
  // than escalating a routine question to a CA on a transient API blip.
  if (serviceError) {
    const reply = "Abhi thodi technical dikkat aa rahi hai (service busy) — ek minute baad dobara try karein. Aapka sawaal safe hai, koi galat jawab nahi diya gaya.";
    log("intake", false, t0, "service unavailable");
    trace.update({ output: reply, metadata: { service_error: true } });
    await lf.flushAsync().catch(() => {});
    return complete({ reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: false, trajectory });
  }
  log("intake", true, t0, `${intake.intent}/${intake.tier}`);
  log("G1-schema", g1_retries < 2, t0, g1_retries ? `retries=${g1_retries}` : undefined);

  // T3 short-circuit: proceedings belong with a professional, not a language model.
  if (intake.tier === "T3") {
    t0 = Date.now();
    const reply = caHandoff(question, intake);
    log("ca-handoff", true, t0);
    trace.update({ output: reply, metadata: { escalated: true } });
    await lf.flushAsync().catch(() => {});
    return complete({ reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: true, abstained: false, trajectory });
  }

  // The bundled calculators/rate table are learning examples, not a current law corpus.
  // Only plain arithmetic supplied by the user bypasses the dated-source coverage boundary.
  const plainArithmetic = isPlainArithmetic(question, intake.lane);
  if (plainArithmetic) {
    // Deliberately exclude prior legal context, remembered defaults and pending
    // calculators. Failure to extract math does not authorize another lane.
    const math = await tryGeneralMath(question, undefined, trace);
    log('supplied-arithmetic', !!math, Date.now());
    return complete({reply:math?.reply ?? 'Please supply one arithmetic operation and its numbers. I cannot infer a legal rate or liability.',traceId:trace.id,tier:intake.tier,intent:intake.intent,escalated:false,abstained:!math,trajectory});
  }
  if (!plainArithmetic && !(await historicalCoverage(question))) {
    const reply = "The reviewed sources here do not establish the answer for your period. I cannot verify current GST rates, thresholds, eligibility or deadlines. You can use Filing analysis for the explicitly dated January 2022 GSTR-3B illustration, or consult a qualified GST adviser.";
    log("source-coverage", false, Date.now(), "limited historical source coverage");
    return complete({reply,traceId:trace.id,tier:intake.tier,intent:intake.intent,escalated:false,abstained:true,trajectory});
  }
  if (!plainArithmetic && ['calculation','rate_lookup','change_over_time','guidance'].includes(intake.lane)) {
    const reply = "Use Filing analysis to review the January 2022 GSTR-3B inputs and historical formula. Other legal calculations and current rates are outside this source coverage.";
    return complete({reply,traceId:trace.id,tier:intake.tier,intent:intake.intent,escalated:false,abstained:true,trajectory});
  }

  // ROUTER: intake now also picks a LANE (the question's TYPE). T3 already short-circuited.
  // The calculation lane owns the third move (ASK): it fills its calculator's inputs from the
  // conversation, computes the exact figure when they're all present, or gives the general
  // cited rule + an offer to compute when they're missing — never a bare abstention. Every
  // OTHER lane still flows through the grounded RAG path below (unchanged for now).
  t0 = Date.now();
  let lane = reconcileLane(intake.intent, intake.lane, question);
  // Working-memory override: when a calculation gather is pending on this thread and the user's
  // message reads as a yes/no to our confirmation ("haan sahi hai" / "nahi, GSTR-1"), it belongs
  // to that gather even if the classifier — seeing a three-word message — picked another lane.
  if (isFresh(opts.pending) && lane !== "calculation" && detectStance(question) !== "neutral") {
    lane = "calculation";
  }
  log("router", true, t0, lane === intake.lane ? lane : `${lane} (was ${intake.lane})`);

  // Lanes that own their own deterministic answer (fact lookup / calculation / ASK). Each
  // returns a LaneOutcome; the rest fall through to the grounded RAG path below.
  const extras: LaneExtras = { memory: opts.memory ?? null, pending: opts.pending ?? null, threadId: opts.threadId, userId: opts.userId };
  const laneHandlers: Partial<Record<Lane, (q: string, ctx: string | undefined, intent: string | undefined, parent?: import("../observability/langfuse").LfParent, extras?: LaneExtras) => Promise<LaneOutcome>>> = {
    calculation: runCalculationLane,
    rate_lookup: runRateLane,
    change_over_time: runTimelineLane,
    guidance: runGuidanceLane,
  };
  const handler = laneHandlers[lane];
  if (handler) {
    t0 = Date.now();
    const laneSpan = trace.span({ name: `lane:${lane}`, input: question });
    const outcome = await handler(question, opts.context, intake.intent, laneSpan, extras);
    laneSpan.end({ output: outcome.reply, metadata: { mode: outcome.mode, note: outcome.note } });
    log(`lane:${lane}`, true, t0, `${outcome.mode}${outcome.note ? ` — ${outcome.note}` : ""}`);
    // Tidy: never show the internal [SOURCE-ID] placeholder, and drop any tag-only line left
    // behind when a sentence was pruned (e.g. a lone "[CGST-RULES/r89]" from the RAG fallback).
    const reply = outcome.reply
      .replace(/\[SOURCE-ID\]/gi, "")
      .replace(/^\s*(?:\[[A-Za-z-]+\/[^\]]+\]\s*)+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    trace.update({ output: reply, metadata: { lane, mode: outcome.mode } });
    await lf.flushAsync().catch(() => {});
    return complete({ reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: outcome.abstained, trajectory, pending: outcome.pending });
  }

  // 2+3. retrieval + resolution (answerQuestion = hybridSearch + grounded generation + G4).
  // Pass the trace so retrieval + the sonnet generation nest under THIS turn's trace (before,
  // answerQuestion opened a second, disconnected "answer" trace).
  t0 = Date.now();
  // Memory injection (b): the same memory block rides along as a retrieval/generation hint —
  // it biases the query rewrite ("mera product" → footwear) and gives the generator background;
  // the citation gate still forces every legal claim onto a retrieved chunk, memory or not.
  const res = await answerQuestion(question, undefined, opts.context, trace, memBlock || undefined);
  log("retrieval", true, t0, res.retrieval.fused.slice(0, 3).map((c) => c.id).join(","));

  // needs_clarification (blunt fallback): the transform judged the question un-interpretable
  // as written. Unlike the schema-driven ask, it can't name what's missing — so we give a
  // short generic nudge rather than abstain. Only fires when we ALSO couldn't ground an answer.
  if (res.needsClarification && res.abstained) {
    const reply = "Aapka sawal thoda aur spasht karein — konsa GST topic (rate, return, registration, refund…) aur kis cheez ke baare mein? Tabhi main sahi source se jawab de paunga.";
    log("clarify", true, t0, "needs_clarification");
    trace.update({ output: reply, metadata: { needs_clarification: true } });
    await lf.flushAsync().catch(() => {});
    return complete({ reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: false, trajectory });
  }

  // G2: relevance floor — if even the BEST chunk is weakly related, generation ran on sand.
  const bestDense = res.retrieval.dense[0]?.score ?? 0;
  const g2ok = res.retrieval.mode === 'keyword' ? res.retrieval.keyword.length > 0 && res.retrieval.fused.length > 0 : bestDense >= G2_MIN_RELEVANCE;
  log("G2-retrieval-floor", g2ok, t0, res.retrieval.mode === 'keyword' ? 'SQL keyword matches; no vector relevance claim' : `best cosine ${bestDense.toFixed(3)} vs ${G2_MIN_RELEVANCE}`);
  if (!g2ok) {
    const reply = `${ABSTAIN_PHRASE.charAt(0).toUpperCase() + ABSTAIN_PHRASE.slice(1)} — mere paas is topic pe koi seedha source nahi mila. Aap chahen to CA se confirm kar sakte hain.`;
    trace.update({ output: reply, metadata: { g2_blocked: true } });
    await lf.flushAsync().catch(() => {});
    return complete({ reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: true, trajectory });
  }
  log("resolution", !res.abstained, t0, res.regenerated ? "G4 regen used" : undefined);
  log("G4-citations", res.gate?.ok ?? false, t0);

  // G3: recompute-don't-trust — every figure re-verified against cited text / calculators.
  t0 = Date.now();
  let draft = res.answer;
  if (!res.abstained) {
    let g3 = recomputeNumbers(draft, res.chunkTextById, res.toolOutputs);
    if (!g3.ok) {
      const retry = await answerQuestion(question, `These figures failed number verification against their cited sources — fix or remove them:\n${g3.violations.join("\n")}`, opts.context, trace, memBlock || undefined);
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
      const rep = await recordGeneration(trace, { name: "reply-synthesis", model: HAIKU, input: draft },
        () => anthropic.messages.create({
          model: HAIKU, max_tokens: 900, temperature: 0,
          messages: [{ role: "user", content: REPLY_PROMPT(question, draft) }],
        }),
        (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
      const candidate = rep.content[0].type === "text" ? rep.content[0].text : draft;
      const check = await recordGeneration(trace, { name: "G5-claim-check", model: HAIKU, input: candidate },
        () => anthropic.messages.create({
          model: HAIKU, max_tokens: 300, temperature: 0,
          messages: [{ role: "user", content: G5_PROMPT(candidate, draft) }],
        }),
        (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
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

  // Safety net: the reply model can echo the literal "[SOURCE-ID]" placeholder from its own
  // formatting instructions (seen on abstentions, which carry no real tags to keep). A user must
  // never see internal notation — strip it and tidy the spacing it leaves behind.
  reply = reply.replace(/\[SOURCE-ID\]/gi, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:])/g, "$1").trim();

  trace.update({ output: reply, metadata: { tier: intake.tier, abstained: abstainedNow } });
  await lf.flushAsync().catch(() => {});
  return complete({ reply, traceId: trace.id, tier: intake.tier, intent: intake.intent, escalated: false, abstained: abstainedNow, trajectory });
}
