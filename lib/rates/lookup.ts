// RATE LOOKUP — turn "chappal ka rate?" into a table entry, then into a pre-cited rate.
// Two model touches, both "propose from a CLOSED list, code confirms" (so the model can never
// invent an item or a rate): (1) resolveItem maps the user's words — English OR Hindi — to a
// canonical table item; (2) for price-conditional items, resolveConditionSide reads whether the
// user's product is below/above the threshold, or asks. Everything the model returns is checked
// against the table; the rate itself is never model-produced — it is read from the table.

import Anthropic from "@anthropic-ai/sdk";
import { RATES, RATE_ITEMS, findBySynonym, findByItem, type RateEntry } from "./table";
import { recordGeneration, type LfParent } from "../observability/langfuse";

let anthropic: Anthropic | null = null;

// resolveItem — which table item is the user asking about? Deterministic synonym match first
// (free, instant, catches "footwear"/"joota"/"chappal"); if that misses, one haiku call picks
// from the CLOSED list of canonical items (handles Hindi/odd phrasing), and we confirm the pick
// is really in the table. Returns null when nothing matches — the lane then abstains honestly.
export async function resolveItem(question: string, context?: string, parent?: LfParent): Promise<RateEntry | null> {
  const direct = findBySynonym(question) ?? (context ? findBySynonym(context) : null);
  if (direct) return direct;
  try {
    anthropic ??= new Anthropic();
    const res = await recordGeneration(parent, { name: "rate-resolve-item", model: "claude-haiku-4-5-20251001", input: question },
      () => anthropic!.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        temperature: 0,
        messages: [{
          role: "user",
          content: `Which ONE item is this GST-rate question about? Pick EXACTLY one from this list, or reply "none" if none fits. Reply with only the item text.\n\nItems:\n${RATE_ITEMS.map((i) => `- ${i}`).join("\n")}\n\nQuestion: ${context ? context + "\n" : ""}${question}`,
        }],
      }),
      (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    const pick = res.content[0].type === "text" ? res.content[0].text.trim().replace(/^-\s*/, "") : "none";
    return findByItem(pick);
  } catch {
    return null;
  }
}

export type RateLookup =
  | { kind: "flat"; rate: number; entry: RateEntry }
  | { kind: "resolved"; rate: number; side: "below" | "above"; entry: RateEntry }
  | { kind: "ask"; entry: RateEntry };

// lookupRate — given the entry, produce the rate. Flat items resolve immediately. Conditional
// items (footwear, apparel) need to know which side of the threshold the product is on: we ask
// the model to read that from the conversation, and if it can't tell, we return "ask" so the
// lane puts the threshold question to the user (the ASK move, for rates).
export async function lookupRate(entry: RateEntry, question: string, context?: string, parent?: LfParent): Promise<RateLookup> {
  if (entry.rate !== undefined && !entry.condition) return { kind: "flat", rate: entry.rate, entry };
  if (!entry.condition) return { kind: "flat", rate: entry.rate ?? 0, entry };

  const side = await resolveConditionSide(entry, question, context, parent);
  if (side === "unknown") return { kind: "ask", entry };
  const tier = side === "below"
    ? entry.condition.tiers.find((t) => t.upto !== undefined)
    : entry.condition.tiers.find((t) => t.above !== undefined);
  return { kind: "resolved", rate: tier?.rate ?? 0, side, entry };
}

// resolveConditionSide — read from the conversation whether the product's per-unit value is at/
// below or above the threshold. Closed answer set ("below"/"above"/"unknown") so a vague
// question safely yields "unknown" → we ask rather than guess. Handles "kam"/"zyada"/"under
// 2500"/"3000 rupees" across languages because a model reads it, not a brittle regex.
async function resolveConditionSide(entry: RateEntry, question: string, context?: string, parent?: LfParent): Promise<"below" | "above" | "unknown"> {
  const c = entry.condition!;
  try {
    anthropic ??= new Anthropic();
    const res = await recordGeneration(parent, { name: "rate-condition-side", model: "claude-haiku-4-5-20251001", input: `${entry.item} vs ₹${c.threshold}` },
      () => anthropic!.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 20,
        temperature: 0,
        messages: [{
          role: "user",
          content: `A GST rate for ${entry.item} depends on its SALE PRICE ${c.unit}: ₹${c.threshold} is the boundary. Decide ONLY from the per-unit sale price/value. IMPORTANT: a QUANTITY of items (e.g. "10000 shoes", "500 pairs") is NOT a price — if the user gave only a quantity, or no price at all, reply "unknown". Is the user's per-unit price at/below ₹${c.threshold}, or above it? Reply ONLY "below", "above", or "unknown".\n\n${context ? context + "\n" : ""}User: ${question}`,
        }],
      }),
      (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    // Strip decoration before matching: with long contexts the model sometimes answers
    // "**below**" (markdown bold), and a bare startsWith read that as "unknown" — the
    // Phase-8c session-2 bug. Tolerate formatting, stay strict on the vocabulary.
    const a = res.content[0].type === "text" ? res.content[0].text.trim().toLowerCase().replace(/[^a-z]/g, "") : "unknown";
    return a.startsWith("below") ? "below" : a.startsWith("above") ? "above" : "unknown";
  } catch {
    return "unknown";
  }
}
