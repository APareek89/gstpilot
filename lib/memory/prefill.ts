// SLOT PRE-FILL — the deterministic bridge from durable memory to a tool's input slots.
// Given a tool spec and what we remember, propose values for slots we'd otherwise ask about.
// Proposals go into pending.assumed and are SHOWN to the user for confirmation — this file
// never fills a trusted value directly. That's the whole legal-safety design: every one of
// these slots changes a computed number or an eligibility answer, so memory may only PROPOSE.
//
// All mappings are plain code (no model): each one names its memory source in `why`, which the
// confirmation message shows to the user ("aapke profile se", "pichhli baar confirm kiya tha").

import type { ToolSpec, SlotSpec } from "../tools/registry";
import type { AssumedSlot, SlotValue } from "./working";
import { type MemoryBundle, getFact, getDefault } from "./store";

// States where the CGST Act's lower registration thresholds apply (s22 special category, as the
// registry's ask-phrase describes: NE states, Himachal, Uttarakhand, J&K). Used to propose the
// boolean from the remembered state — proposal only, confirmed by the user before use.
const SPECIAL_CATEGORY_STATES = [
  "arunachal pradesh", "assam", "manipur", "meghalaya", "mizoram", "nagaland", "sikkim",
  "tripura", "himachal pradesh", "uttarakhand", "jammu and kashmir", "jammu & kashmir", "j&k",
];

// parseInrAmount — "45 lakh" / "1.2 crore" / "₹4,50,000" → rupees. Same expansion rules as the
// clarifier's validate(); duplicated deliberately small rather than exporting a private helper.
function parseInrAmount(text: string): number | null {
  let str = text.toLowerCase().replace(/[,₹\s]/g, "");
  const mult = /crore|cr\b|करोड़/.test(str) ? 1e7 : /lakh|lac|लाख/.test(str) ? 1e5 : 1;
  str = str.replace(/crore|cr|करोड़|lakh|lac|लाख/g, "");
  const n = Number(str) * mult;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Does the remembered "sells" text look like services rather than goods? Tiny keyword rule —
// it only shapes a PROPOSAL the user confirms, so a miss costs one correction, never a wrong answer.
function sellsToSupplyType(sells: string): "goods" | "services" {
  return /service|consult|software|design|agency|freelanc|marketing|repair|coaching|classes/i.test(sells)
    ? "services" : "goods";
}

// proposeDefaults — for each still-missing slot of `spec`, look for something remembered that
// could fill it. Priority: (1) a user-CONFIRMED procedural default for this exact tool+slot,
// (2) a behavioral fact that maps deterministically. Returns only proposals — the caller puts
// them in pending.assumed and builds the confirmation.
export function proposeDefaults(
  spec: ToolSpec, missing: SlotSpec[], bundle: MemoryBundle | null
): Record<string, AssumedSlot> {
  const out: Record<string, AssumedSlot> = {};
  if (!bundle) return out;

  for (const slot of missing) {
    // (1) a confirmed per-user default for this tool+slot always wins
    const def = getDefault(bundle, spec.name, slot.name);
    if (def) {
      const v = coerce(slot, def.value);
      if (v !== null) { out[slot.name] = { value: v, why: `aapne pichhli baar confirm kiya tha (${def.asOf.slice(0, 10)})` }; continue; }
    }

    // (2) behavioral facts that map onto this slot
    if (slot.name === "annual_turnover_inr") {
      const band = getFact(bundle, "turnover_band");
      const n = band && parseInrAmount(band.value);
      if (band && n) out[slot.name] = { value: n, why: `aapne bataya tha turnover ~${band.value}` };
    }
    if (slot.name === "return_type") {
      const freq = getFact(bundle, "filing_frequency");
      // monthly/quarterly filers' late-fee questions are almost always the GSTR-3B they file
      if (freq && /month|quarter|mahina|har mah/i.test(freq.value)) {
        out[slot.name] = { value: "GSTR-3B", why: `aap ${freq.value} file karte hain — normally GSTR-3B` };
      }
    }
    if (slot.name === "supply_type") {
      const sells = getFact(bundle, "sells");
      if (sells) out[slot.name] = { value: sellsToSupplyType(sells.value), why: `aap ${sells.value} bechte hain` };
    }
    if (slot.name === "special_category_state") {
      const state = getFact(bundle, "state");
      if (state) {
        const special = SPECIAL_CATEGORY_STATES.some((s) => state.value.toLowerCase().includes(s));
        out[slot.name] = { value: special, why: `aap ${state.value} mein hain` };
      }
    }
  }
  return out;
}

// coerce — a stored default is a string; the slot may want a number/boolean/enum. Same
// validation direction as the clarifier: an unusable stored value is dropped (we ask instead),
// never bent into shape.
function coerce(slot: SlotSpec, stored: string): SlotValue | null {
  switch (slot.type) {
    case "enum": return (slot.options ?? []).find((o) => o.toLowerCase() === stored.toLowerCase()) ?? null;
    case "boolean": return stored === "true" ? true : stored === "false" ? false : null;
    case "number": return parseInrAmount(stored);
    case "date": return null; // dates are per-case facts — never a sensible durable default
  }
}
