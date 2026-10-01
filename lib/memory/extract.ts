// MEMORY EXTRACTION — the new agent: after each answered turn, one cheap Haiku pass reads the
// exchange and pulls out DURABLE facts about the user's business. Durable means true next week
// ("sells on Amazon", "files monthly"), not per-question detail ("this return was 5 days late").
// The fact vocabulary is a CLOSED SET plus a small observation escape hatch — the same
// three-tier discipline as chunk enrichment: the model exercises judgment only inside a
// vocabulary code defined, and code validates everything before it touches the database.
//
// Runs fire-and-forget AFTER the reply is sent (memory writing must never add latency or risk
// to answering), recorded as a generation node on the SAME pipeline trace via its traceId.

import Anthropic from "../providers/client";
import { upsertFact } from "./store";
import { getLangfuse, recordGeneration } from "../observability/langfuse";

// The closed fact vocabulary. Adding a fact type = adding it here + (if slot-fillable) a
// mapping in prefill.ts — nowhere else.
export const FACT_KEYS = ["sells", "state", "platforms", "turnover_band", "filing_frequency"] as const;

const EXTRACT_PROMPT = (userMsg: string, reply: string) => `You maintain a memory profile of a small Indian e-commerce seller, from their GST support chat. Read ONE exchange and extract only DURABLE facts the USER stated about their own business — things still true next month. NEVER infer a fact the user didn't state; NEVER extract from the assistant's words (except a user-confirmed assumption); per-question details (a specific date, one return's delay) are NOT durable facts.

Allowed fact keys (use EXACTLY these):
- "sells": what they sell (e.g. "footwear", "sarees and kurtis")
- "state": their Indian state (e.g. "Maharashtra")
- "platforms": where they sell (e.g. "Amazon", "Amazon, Flipkart", "own website")
- "turnover_band": annual turnover as they stated it (e.g. "45 lakh", "1.2 crore")
- "filing_frequency": how often they file returns (e.g. "monthly", "quarterly")
- "observation:<short-slug>": one other durable business fact worth remembering (max 1, e.g. "observation:exports" = "exports to UAE")

Output ONLY JSON: {"facts": [{"fact": "...", "value": "..."}]} — an empty list if nothing durable was stated. When in ANY doubt whether the user stated a fact, OMIT it — a missing memory costs one extra question later; a wrong memory costs a wrong assumption.

User said: ${userMsg}
Assistant replied: ${reply.slice(0, 600)}`;

let anthropic: Anthropic | null = null;

// extractAndStoreMemories — the full after-turn pass: extract → validate against the closed
// set → upsert (confidence starts LOW; see store.ts). Every failure is swallowed by design:
// a broken memory extractor degrades to "the app learns nothing this turn", never to a broken
// answer or an invented fact (invalid keys and oversized values are dropped in code).
export async function extractAndStoreMemories(
  userId: string, threadId: string, userMsg: string, reply: string, traceId?: string
): Promise<void> {
  try {
    anthropic ??= new Anthropic();
    // Re-attach to the turn's pipeline trace by id, so this node appears in the SAME tree the
    // rest of the turn logged to (one trace per turn stays true even for after-reply work).
    const trace = traceId ? getLangfuse().trace({ id: traceId }) : undefined;
    const res = await recordGeneration(trace, { name: "memory-extract", model: "claude-haiku-4-5-20251001", input: userMsg },
      () => anthropic!.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: "user", content: EXTRACT_PROMPT(userMsg, reply) }],
      }),
      (r) => ({ output: r.content[0].type === "text" ? r.content[0].text : "", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }));
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
    const facts: { fact: string; value: string }[] = Array.isArray(parsed?.facts) ? parsed.facts : [];
    for (const f of facts.slice(0, 4)) {
      const key = String(f?.fact ?? "").trim();
      const value = String(f?.value ?? "").trim().slice(0, 200);
      const validKey = (FACT_KEYS as readonly string[]).includes(key) || /^observation:[a-z0-9-]{2,40}$/.test(key);
      if (!validKey || !value) continue; // the code-side trust boundary
      await upsertFact(userId, key, value, threadId);
    }
    await getLangfuse().flushAsync().catch(() => {});
  } catch {
    /* memory is best-effort — an extraction failure must never surface to the user */
  }
}
