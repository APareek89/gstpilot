// THE THIRD MOVE — ASK. Before this file, the agent had only two moves: answer, or abstain.
// A question that is answerable IN PRINCIPLE but missing an input (a late fee with no dates)
// had nowhere to go but abstention. This adds the missing move: read the tool's required-input
// schema, extract whatever the conversation already supplied, and — if a required input is
// still missing — ask ONE bundled, friendly question for the gaps instead of giving up.
//
// Two functions, cleanly split: fillSlots() is "model proposes" (a cheap extraction, then
// deterministic validation with a strict trust boundary — never fabricate a value the user
// didn't state); buildClarification() is pure code turning the missing slots into one message.

import Anthropic from "../providers/client";
import type { ToolSpec, SlotSpec } from "../tools/registry";
import type { AssumedSlot } from "../memory/working";
import { recordGeneration, type LfParent } from "../observability/langfuse";

// The result of trying to fill a tool's inputs from the conversation: the values we could
// confidently extract, and the required slots still empty. missing.length === 0 means the
// tool can run now; otherwise those slots are exactly what we ask for.
export type SlotFill = {
  values: Record<string, string | number | boolean>;
  missing: SlotSpec[];
};

const EXTRACT_PROMPT = (spec: ToolSpec, convo: string, today: string) => `You are filling the inputs for a tool that will ${spec.purpose}. Read the conversation and extract ONLY values the user actually stated. If a value was not given at all, use null — NEVER invent a date, amount or choice the user never referred to.

Today's date is ${today}. RESOLVE relative dates to an absolute ISO date yyyy-mm-dd using today:
- "today"/"aaj" → ${today}; "yesterday"/"kal" (past) → the day before; "5 days back"/"5 din pehle" → 5 days before today; "last week"/"pichhle hafte" → ~7 days before; "2 months ago"/"2 mahine pehle" → that month. Compute the actual calendar date.
For AMOUNTS, copy the number and its unit word EXACTLY as the user wrote it — e.g. "100 crore", "1.5 lakh", "40 lakh", "₹1,50,000". Do NOT convert to digits yourself; the code expands them precisely (converting large numbers by hand is error-prone).
For yes/no in any language: "no"/"nahi"/"nahin" → false; "yes"/"haan"/"ha" → true.

Inputs to fill:
${spec.slots
  .map((s) => {
    const kind =
      s.type === "enum" ? `one of ${JSON.stringify(s.options)}`
      : s.type === "date" ? `absolute ISO date yyyy-mm-dd (resolve relative dates using today)`
      : s.type === "boolean" ? `true or false`
      : `the amount VERBATIM with its unit word, e.g. "100 crore" or "₹1,50,000" — do NOT expand to digits`;
    return `- "${s.name}": ${s.ask} — ${kind}${s.example ? ` (e.g. ${s.example})` : ""}`;
  })
  .join("\n")}

Output ONLY JSON: an object with every input name as a key, each set to the extracted value or null.

Conversation:
${convo}`;

let anthropic: Anthropic | null = null;

// fillSlots — extract a tool's inputs from (earlier context + the current question), validate
// each against its declared type, and report which required ones are still missing. The
// validation is the safety net: a model may echo "20 Jan" as a date, but only a value that
// PASSES the type check (parses as a date / a number / one of the enum options) is accepted —
// anything else is treated as not-given, which is the safe direction (we ask rather than
// compute on a mis-read). On any model/parse failure we fall back to "everything missing",
// so a broken extractor degrades into asking, never into a wrong number.
export async function fillSlots(spec: ToolSpec, question: string, context?: string, parent?: LfParent, strictErrors = false): Promise<SlotFill> {
  const convo = context ? `${context}\nUser: ${question}` : `User: ${question}`;
  const today = new Date().toISOString().slice(0, 10); // the clock the extractor was missing
  const values: Record<string, string | number | boolean> = {};
  try {
    anthropic ??= new Anthropic();
    const res = await recordGeneration(parent, { name: `fill-slots:${spec.name}`, model: "claude-haiku-4-5-20251001", input: convo },
      () => anthropic!.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: "user", content: EXTRACT_PROMPT(spec, convo, today) }],
      }),
      (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    for (const s of spec.slots) {
      const v = parsed?.[s.name];
      const clean = validate(s, v);
      if (clean !== null) values[s.name] = clean;
    }
  } catch (error) {
    if (strictErrors) throw error;
    /* extraction failed → values stays empty → all required slots reported missing → we ask */
  }
  const missing = spec.slots.filter((s) => s.required && !(s.name in values));
  return { values, missing };
}

// validate — the trust boundary in code. Returns the cleaned value or null (= not usable, so
// treat as not given). Dates must parse; numbers must be finite; booleans must be real
// booleans; enums must be one of the offered options (case-insensitive match to the canonical).
function validate(s: SlotSpec, v: unknown): string | number | boolean | null {
  if (v === null || v === undefined || v === "") return null;
  switch (s.type) {
    case "date": {
      const str = String(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(str) && !Number.isNaN(Date.parse(str)) ? str : null;
    }
    case "number": {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      // Deterministic backstop for word-amounts the model may echo verbatim ("10 crore", "2 lakh").
      let str = String(v).toLowerCase().replace(/[,₹\s]/g, "");
      const mult = /crore|cr\b|करोड़/.test(str) ? 1e7 : /lakh|lac|लाख/.test(str) ? 1e5 : 1;
      str = str.replace(/crore|cr|करोड़|lakh|lac|लाख/g, "");
      const n = Number(str) * mult;
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    case "boolean":
      return typeof v === "boolean" ? v : null;
    case "enum": {
      const match = (s.options ?? []).find((o) => o.toLowerCase() === String(v).toLowerCase());
      return match ?? null;
    }
  }
}

// buildClarification — pure formatting: turn the missing slots into ONE warm, bundled Hinglish
// question. Bundled (not one slot per turn) so the user answers everything in a single reply;
// options are spelled out inline so a choice slot reads like a menu, not an interrogation.
// This text is a QUESTION, not a legal claim, so it carries no citation and never touches the
// citation gate — asking for input is not asserting law.
export function buildClarification(spec: ToolSpec, missing: SlotSpec[]): string {
  const lines = missing.map((s) => {
    const opts = s.type === "enum" && s.options ? ` (${s.options.join(" / ")})` : "";
    return `- ${s.ask}${opts}`;
  });
  const purpose = spec.purpose.charAt(0).toUpperCase() + spec.purpose.slice(1);
  return [
    `${purpose} — ye main aapke liye kar sakta hoon. Bas itni detail chahiye:`,
    ...lines,
    "",
    "Ek hi message mein bata dein, main exact nikaal deta hoon.",
  ].join("\n");
}

// buildConfirmation — the CONFIRM-NOT-ASK upgrade of buildClarification (Phase 8c). When
// memory can pre-fill some slots, the cold ask becomes: show every assumption WITH its origin
// ("aapne pichhli baar confirm kiya tha"), ask "sahi hai?", and only then list what's still
// genuinely missing. Also a PURE FUNCTION — an LLM never writes this text, and (the legal
// non-negotiable) the assumed values are only PROPOSED here: the calculator won't run on them
// until the user's next message confirms (detectStance / an explicit correction).
export function buildConfirmation(
  spec: ToolSpec, assumed: Record<string, AssumedSlot>, missing: SlotSpec[]
): string {
  const showValue = (name: string, v: string | number | boolean): string => {
    if (typeof v === "boolean") return v ? "haan" : "nahi";
    if (typeof v === "number") return name.endsWith("_inr") ? `₹${v.toLocaleString("en-IN")}` : String(v);
    return String(v);
  };
  const assumedLines = Object.entries(assumed).map(([name, a]) => {
    const slot = spec.slots.find((s) => s.name === name);
    return `- ${slot?.ask ?? name}: ${showValue(name, a.value)} (${a.why})`;
  });
  const missingLines = missing.map((s) => {
    const opts = s.type === "enum" && s.options ? ` (${s.options.join(" / ")})` : "";
    return `- ${s.ask}${opts}`;
  });
  const purpose = spec.purpose.charAt(0).toUpperCase() + spec.purpose.slice(1);
  return [
    `${purpose} — aapke baare mein jo yaad hai, usse maan ke chal raha hoon:`,
    ...assumedLines,
    "",
    ...(missingLines.length
      ? [`Sahi hai? Saath mein bas ye bata dein:`, ...missingLines, "", "Ek hi message mein — koi assumption galat ho to wahi correct kar dein."]
      : [`Sahi hai? "Haan" bol dein to main exact nikaal deta hoon — kuch galat ho to wahi correct kar dein.`]),
  ].join("\n");
}
