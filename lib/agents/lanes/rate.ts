// THE RATE LANE — answers "what's the GST rate for X?" as a looked-up FACT.
// Flow: resolve the item (English/Hindi) → look up the rate → answer PRE-CITED, or ASK the
// price-threshold question for conditional items (footwear/apparel), or abstain honestly when
// the item isn't in our table. Because the rate carries its own citation (like the calculators),
// this answer never depends on retrieval phrasing and never trips the citation gate — which is
// exactly why it fixes both the buried-rate ("dilution") and English-vs-Hinglish problems.

import { resolveItem, lookupRate } from "../../rates/lookup";
import type { RateEntry } from "../../rates/table";
import type { LaneOutcome, LaneExtras } from "../lanes";
import { getFact, getDefault, confirmFact } from "../../memory/store";
import type { LfParent } from "../../observability/langfuse";

// A quiet honesty line: the table is model-compiled and (for footwear/apparel) variant-sensitive,
// so we point the user at the notification for their exact product. Not shown for exempt/simple.
const CONFIRM = "Apne exact product/variant ke liye notification confirm kar lein.";

// A stable memory key per table item ("footwear (per pair)" → "footwear-per-pair") for the
// remembered price-band default: fact "default:rate_lookup.<slug>.side".
const slug = (item: string) => item.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function runRateLane(question: string, context?: string, _intent?: string, parent?: LfParent, extras?: LaneExtras): Promise<LaneOutcome> {
  const memory = extras?.memory ?? null;
  const entry = await resolveItem(question, context, parent);

  // Memory move #1 — resolve a VAGUE item from the profile, then CONFIRM before answering.
  // "mera product ka rate?" + profile says sells=footwear → we do NOT state the footwear rate
  // (a remembered fact would be driving a rate — the non-negotiable). We ask one warm yes/no;
  // the user's "haan" lands in the thread, and next turn the item resolves from plain context.
  if (!entry && memory) {
    const sells = getFact(memory, "sells");
    if (sells) {
      const viaMemory = await resolveItem(`${question}\n(The asker's profile says they sell: ${sells.value})`, context, parent);
      if (viaMemory) {
        return {
          reply: `Aap ${sells.value} bechte hain (aapke profile se) — kya aap ${viaMemory.item} ka GST rate poochh rahe hain? Haan bolein to source ke saath bata deta hoon; koi aur cheez hai to naam bata dein.`,
          abstained: false, mode: "confirm-item", citationIds: [], note: `memory-resolved ${viaMemory.item} — confirming`,
        };
      }
    }
  }
  if (!entry) {
    // Honest abstention — better than guessing a rate we don't hold.
    return {
      reply: "Is item ka GST rate mere rate-table mein abhi nahi hai, isliye main galat number nahi bataunga. Aap CBIC ki rate notification ya kisi CA se confirm kar sakte hain.",
      abstained: true, mode: "not-in-table", citationIds: [], note: "item not in rate table",
    };
  }

  const result = await lookupRate(entry, question, context, parent);

  if (result.kind === "ask") {
    // Memory move #2 — a CONFIRMED price-band default turns the cold threshold ask into a
    // one-tap confirmation. Shown with its date, never silently applied: the rate follows only
    // after the user's "haan" (which the next turn's condition-reader picks up from the thread).
    const remembered = memory ? getDefault(memory, "rate_lookup", `${slug(entry.item)}.side`) : null;
    if (remembered) {
      const c = entry.condition!;
      const sideText = remembered.value === "below"
        ? `₹${c.threshold.toLocaleString("en-IN")} ${c.unit} tak`
        : `₹${c.threshold.toLocaleString("en-IN")} ${c.unit} se zyada`;
      return {
        reply: `Pichhli baar aapne bataya tha ki aapke ${entry.item} ${sideText} ke hain (${remembered.asOf.slice(0, 10)} ko). Is baar bhi wahi maanoon? Haan bolein to rate source ke saath de deta hoon — alag hai to price bata dein.`,
        abstained: false, mode: "confirm-side", citationIds: [], note: `remembered ${entry.item} side=${remembered.value} — confirming`,
      };
    }
    // The ASK move, for rates: the % depends on the price threshold and we don't know which side.
    return {
      reply: `${entry.condition!.ask}\n\nBata dein to main sahi rate (source ke saath) de deta hoon.`,
      abstained: false, mode: "ask-condition", citationIds: [], note: `asked ${entry.item} threshold`,
    };
  }

  // The user just told (or confirmed) which side of the threshold their product is on — that's
  // a durable habit worth remembering as a per-user default for next time. Best-effort write.
  if (result.kind === "resolved" && extras?.userId) {
    confirmFact(extras.userId, `default:rate_lookup.${slug(entry.item)}.side`, result.side, extras.threadId ?? null, "default").catch(() => {});
  }

  const rate = result.rate;
  const cond = result.kind === "resolved"
    ? ` (${result.side === "below" ? `₹${entry.condition!.threshold.toLocaleString("en-IN")} ${entry.condition!.unit} tak` : `₹${entry.condition!.threshold.toLocaleString("en-IN")} ${entry.condition!.unit} se zyada`})`
    : "";
  return {
    reply: buildRateReply(entry, rate, cond),
    abstained: false, mode: result.kind, citationIds: [entry.citation], note: `${entry.item} ${rate}%`,
  };
}

// buildRateReply — the pre-cited answer. Names the item + rate, the exact notification (in prose)
// and its effective date, tags the real chunk id so the SOURCES card resolves, and adds the
// confirm hedge for conditional/compiled entries. 0% is phrased as "exempt", not "0% tax".
function buildRateReply(entry: RateEntry, rate: number, cond: string): string {
  const head = rate === 0
    ? `${cap(entry.item)}${cond} GST se exempt hai (0%).`
    : `${cap(entry.item)}${cond} pe GST ${rate}% hai.`;
  const src = `Ye ${entry.source_notif} ke hisaab se hai (effective ${entry.effective_date}). [${entry.citation}]`;
  const tail = entry.condition || !entry.verified ? `\n${CONFIRM}` : "";
  return `${head}\n${src}${tail}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
