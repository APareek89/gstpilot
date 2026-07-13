// The first full question→answer path:
// transform → hybrid retrieval → grounded generation (pinned sonnet, calculator tools)
// → deterministic citation gate → ONE named-errors regeneration → abstain.
//
// Why regeneration names the errors instead of blindly retrying: a blind retry samples the
// same distribution that just failed — the same mistake is the likeliest outcome. Naming
// ("tag [CGST-ACT/s99] is not among your sources"; "this sentence is untagged: …") turns
// a resample into a targeted edit, which models are far better at.
// Every run is traced to Langfuse (best-effort; observability never blocks answering).

import Anthropic from "@anthropic-ai/sdk";
import { hybridSearch, type SearchResult } from "../retrieval/search";
import { verifyCitations, pruneUngrounded, ABSTAIN_PHRASE, type CitationCheck } from "../gates/verify-citations";
import { gstrLateFee, delayedPaymentInterest, generalArithmetic, registrationThreshold, refundExportRule89 } from "../calculators";
import { getLangfuse, recordGeneration, type LfParent } from "../observability/langfuse";
import { getServiceClient, TABLE_PREFIX } from "../supabase";

export const GENERATION_MODEL = "claude-sonnet-4-6"; // pinned — changing it is an eval'd migration

export type AnswerResult = {
  answer: string;
  abstained: boolean;
  citations: string[];
  gate: CitationCheck | null;
  regenerated: boolean;
  retrieval: SearchResult;
  needsClarification: boolean;   // transform judged the question un-interpretable as written
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: "gstr_late_fee",
    description: "Compute GSTR-1/GSTR-3B late fee exactly (per-day amounts and turnover caps from the notifications). ALWAYS use this instead of computing fees yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        due_date: { type: "string", description: "ISO date yyyy-mm-dd" },
        filing_date: { type: "string", description: "ISO date yyyy-mm-dd" },
        nil_return: { type: "boolean" },
        annual_turnover_inr: { type: "number" },
      },
      required: ["due_date", "filing_date", "nil_return", "annual_turnover_inr"],
    },
  },
  {
    name: "delayed_payment_interest",
    description: "Compute interest on delayed GST payment under section 50 exactly. ALWAYS use this instead of computing interest yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        tax_amount_inr: { type: "number" },
        due_date: { type: "string" },
        payment_date: { type: "string" },
      },
      required: ["tax_amount_inr", "due_date", "payment_date"],
    },
  },
  {
    name: "general_arithmetic",
    description: "Do exact arithmetic — ALWAYS use this instead of computing any number in prose (e.g. GST = value × rate). ops: multiply, sum, subtract, divide, percent_of (values = [percent, base]). Returns no citation; cite the RATE/rule source on the sentence, not this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        op: { type: "string", enum: ["multiply", "sum", "subtract", "divide", "percent_of"] },
        values: { type: "array", items: { type: "number" } },
      },
      required: ["op", "values"],
    },
  },
  {
    name: "registration_threshold",
    description: "Check if a seller must register for GST under section 22 (aggregate-turnover thresholds). ALWAYS use this instead of stating the threshold from memory.",
    input_schema: {
      type: "object" as const,
      properties: {
        annual_turnover_inr: { type: "number" },
        supply_type: { type: "string", enum: ["goods", "services", "both"] },
        special_category_state: { type: "boolean" },
      },
      required: ["annual_turnover_inr", "supply_type", "special_category_state"],
    },
  },
  {
    name: "refund_export_rule89",
    description: "Compute the export/zero-rated ITC refund under Rule 89(4): (zero-rated turnover × net ITC) ÷ adjusted total turnover. ALWAYS use this instead of computing the refund yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        zero_rated_turnover_inr: { type: "number" },
        net_itc_inr: { type: "number" },
        adjusted_total_turnover_inr: { type: "number" },
      },
      required: ["zero_rated_turnover_inr", "net_itc_inr", "adjusted_total_turnover_inr"],
    },
  },
];

const SYSTEM = `You are GSTPilot, answering Indian GST questions for small e-commerce sellers, STRICTLY from the source blocks provided.

Four rules, all mandatory:
1. CITE EVERY CLAIM: every sentence stating anything about the law ends with the source tag in square brackets, e.g. [CGST-ACT/s16]. Only tags from the provided sources may be used.
2. PERMISSION TO NOT KNOW: if the sources do not answer the question (or any part), say exactly: "${ABSTAIN_PHRASE}" for that part. This is a correct, successful answer. Never fill gaps from memory — your memory of rates, dates and thresholds is not a source.
3. OPTIONS, NOT DIRECTIVES: describe what the law provides and what options exist; do not instruct the user what they must do in their specific case.
4. FLAG CONFLICTS: if sources disagree (e.g. an older and newer rate), say so explicitly and cite both.

For any late-fee or interest AMOUNT, call the calculator tool — never compute money in prose. Answer in the user's language mix (Hinglish is fine), briefly and plainly.

FORMAT: plain sentences and simple "- " bullets only — NO markdown headings, NO tables. Every sentence must be independently citation-checkable, and layout hides claims from the check.
Numbers: state every amount, duration, percentage and threshold in DIGITS with an English unit — "₹50,000", "3 months", "18%", "7 days" — Hinglish restatement after is fine.
Tags: cite with the source id EXACTLY as given in its id attribute, e.g. [CGST-ACT/s17] — put subsections in the sentence text, never inside the brackets. EVERY bullet line ends with its own tag.
Completeness: when a source states the specific number, deadline, form name or condition that answers the question, INCLUDE it — a correct answer names the specifics, not just the rule's existence.`;

// Generation reads FULL chunk text (capped per chunk), not the 200-char list snippets —
// you cannot ground an answer in a preview. The cap is 12,000 chars (~3k tokens): big enough
// that a giant like s54/r89 delivers its whole refund procedure (the tail we now embed whole),
// small enough that eight sources stay within a sane prompt budget. Was 4,500 — which truncated
// exactly the sub-rule specifics fact_match needs.
const GEN_SOURCE_CHARS = 12_000;
async function sourcesBlock(retrieval: SearchResult): Promise<{ block: string; chunkTextById: Map<string, string> }> {
  const ids = retrieval.fused.map((c) => c.id);
  const { data } = await getServiceClient()
    .from(`${TABLE_PREFIX}legal_chunks`)
    .select("id, heading_path, text")
    .in("id", ids);
  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  const chunkTextById = new Map((data ?? []).map((r) => [r.id as string, r.text as string]));
  const block = ids
    .map((id) => {
      const c = byId.get(id);
      return c
        ? `<source id="${id}" heading="${(c.heading_path as string[]).join(" › ")}">\n${(c.text as string).slice(0, GEN_SOURCE_CHARS)}\n</source>`
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return { block, chunkTextById };
}

async function generate(
  anthropic: Anthropic,
  messages: Anthropic.MessageParam[],
  parent?: LfParent
): Promise<{ text: string; toolCitationIds: string[]; toolOutputs: string[] }> {
  // Tool loop: the model proposes a calculation, code executes it, the model continues.
  // Calculators return the citation ids of THEIR legal basis (s47, the late-fee cap
  // notifications). Those are code-vouched sources — as trustworthy as retrieval — so we
  // collect them for the citation gate's allowed set. Each round is recorded as a generation
  // node so the sonnet call (and any tool round) is visible in the trace tree.
  const toolCitationIds = new Set<string>();
  const toolOutputs: string[] = [];
  for (let round = 0; round < 4; round++) {
    const res = await recordGeneration(parent,
      { name: round === 0 ? "sonnet-generation" : `sonnet-tool-round-${round}`, model: GENERATION_MODEL, input: messages },
      () => anthropic.messages.create({
        model: GENERATION_MODEL,
        max_tokens: 1200,
        temperature: 0,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      }),
      (r) => ({ output: r.content, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    if (res.stop_reason !== "tool_use") {
      return {
        text: res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n"),
        toolCitationIds: [...toolCitationIds],
        toolOutputs,
      };
    }
    messages = [...messages, { role: "assistant", content: res.content }];
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const out =
        block.name === "gstr_late_fee" ? gstrLateFee(block.input as any)
        : block.name === "delayed_payment_interest" ? delayedPaymentInterest(block.input as any)
        : block.name === "general_arithmetic" ? generalArithmetic(block.input as any)
        : block.name === "registration_threshold" ? registrationThreshold(block.input as any)
        : block.name === "refund_export_rule89" ? refundExportRule89(block.input as any)
        : { error: "unknown tool" };
      if ("citation_ids" in out) out.citation_ids.forEach((id) => toolCitationIds.add(id));
      toolOutputs.push(JSON.stringify(out));
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
    }
    messages = [...messages, { role: "user", content: results }];
  }
  return { text: ABSTAIN_PHRASE, toolCitationIds: [...toolCitationIds], toolOutputs }; // runaway loop — abstain
}

export type ResolveExtras = { toolOutputs: string[]; chunkTextById: Map<string, string> };

// `userHint` (Phase 8c): the durable-memory block for a signed-in user. It flows to the query
// transform (bias retrieval toward their business) and into the generation context as labelled
// background. It never weakens the gate: legal claims still cite retrieved chunks only.
export async function answerQuestion(question: string, extraFeedback?: string, context?: string, parent?: LfParent, userHint?: string): Promise<AnswerResult & ResolveExtras> {
  const lf = getLangfuse();
  // Nest under the turn's trace when we're part of the pipeline (so it's ONE trace, not a stray
  // second "answer" trace); create our own only when called standalone (e.g. an eval).
  const ownsTrace = !parent;
  const root = parent ?? lf.trace({ name: "answer", input: question });
  const span = root.span({ name: extraFeedback ? "resolution-retry" : "resolution", input: question });

  const retrieval = await hybridSearch(question, "agent", span, userHint);
  span.event({ name: "retrieval", metadata: { traceId: retrieval.traceId, top: retrieval.fused.map((c) => c.id) } });

  const providedIds = retrieval.fused.map((c) => c.id);
  const anthropic = new Anthropic();
  const { block, chunkTextById } = await sourcesBlock(retrieval);
  const baseMessages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${block}\n\n${userHint ? `${userHint}\n\n` : ""}${context ? `Conversation so far (for reference):\n${context}\n\n` : ""}User question (answer THIS, in their words): ${question}${extraFeedback ? `\n\nIMPORTANT prior-attempt feedback to fix: ${extraFeedback}` : ""}`,
    },
  ];

  const genSpan = span.span({ name: "generation-1" });
  const gen1 = await generate(anthropic, baseMessages, genSpan);
  let answer = gen1.text;
  genSpan.end({ output: answer });

  // allowed citations = retrieved chunks + the legal basis vouched by calculator code
  let allowedIds = [...providedIds, ...gen1.toolCitationIds];
  let gate = verifyCitations(answer, allowedIds);
  let regenerated = false;

  if (!gate.ok) {
    regenerated = true;
    const errors = [
      ...gate.invalid_tags.map((t) => `The tag [${t}] is NOT among your provided sources — remove or replace it.`),
      ...gate.untagged_sentences.map((s) => `This claim has no citation tag: "${s}"`),
      `Your ONLY allowed tags are: ${allowedIds.map((id) => `[${id}]`).join(" ")}`,
    ].join("\n");
    const regenSpan = span.span({ name: "generation-2-named-errors" });
    const gen2 = await generate(anthropic, [
      ...baseMessages,
      { role: "assistant", content: answer },
      { role: "user", content: `Your answer failed the citation check:\n${errors}\n\nRewrite the full answer fixing exactly these problems. Same rules apply. If you cannot support a claim from the sources, replace it with: "${ABSTAIN_PHRASE}"` },
    ], regenSpan);
    answer = gen2.text;
    regenSpan.end({ output: answer });
    allowedIds = [...allowedIds, ...gen2.toolCitationIds];
    gate = verifyCitations(answer, allowedIds);
  }

  // "Abstained" means the WHOLE answer is a refusal — either the gate forced it, or the
  // reply contains the phrase and cites nothing. Using the phrase for one sub-point while
  // answering the rest (rule 2 encourages that) is a partial answer, not an abstention.
  let abstained = answer.toLowerCase().includes(ABSTAIN_PHRASE) && gate.cited.length === 0;
  if (!gate.ok) {
    // Gentler enforcement (was: discard the whole answer on any gate failure — the over-abstention
    // that suppressed nearly every RAG answer). Drop ONLY the ungrounded/fake-cited sentences and
    // keep the properly-cited remainder. Full abstention ONLY if nothing grounded survives. The
    // hard safety holds: no uncited or invented-citation claim ever reaches the user.
    const pruned = pruneUngrounded(answer, allowedIds);
    if (pruned.hasGroundedClaim) {
      answer = pruned.text;
      gate = verifyCitations(answer, allowedIds);
      abstained = answer.toLowerCase().includes(ABSTAIN_PHRASE) && gate.cited.length === 0;
    } else {
      answer = `${ABSTAIN_PHRASE.charAt(0).toUpperCase() + ABSTAIN_PHRASE.slice(1)}. Aap kisi CA se consult kar sakte hain is sawal ke liye.`;
      abstained = true;
    }
  }

  span.end({ output: answer, metadata: { abstained, regenerated, gate_ok: gate.ok, cited: gate.cited } });
  // Score the citation gate on the turn's trace (works whether we own it or it's the pipeline's).
  if ("score" in root && typeof (root as { score?: unknown }).score === "function") {
    (root as { score: (b: { name: string; value: number }) => void }).score({ name: "citation_gate", value: gate.ok ? 1 : 0 });
  }
  if (ownsTrace) {
    (root as { update: (b: { output: string }) => void }).update({ output: answer });
    await lf.flushAsync().catch(() => {}); // standalone: flush now; in-pipeline the pipeline flushes
  }

  return {
    answer, abstained, citations: gate.cited, gate, regenerated, retrieval,
    needsClarification: retrieval.transformation.needs_clarification,
    toolOutputs: [...gen1.toolOutputs, ...(regenerated ? [] : [])],
    chunkTextById,
  };
}
