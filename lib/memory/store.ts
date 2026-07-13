// BEHAVIORAL + PROCEDURAL MEMORY — the durable, per-user store (gstpilot_user_memory).
// Two kinds live in one table, kept distinct by `kind`:
//   • behavioral — observed facts about the user's business ("platforms: Amazon",
//     "filing_frequency: monthly", "observation: asks about footwear rates often").
//   • default    — procedural shortcuts the user CONFIRMED ("default:gstr_late_fee.return_type
//     = GSTR-3B") — next time we pre-fill instead of asking.
// Every fact carries confidence + provenance + as_of + last_confirmed, because the core risk of
// agent memory is a STALE fact applied confidently. Confidence starts LOW for model-extracted
// facts, rises only through the confirmation UX, and DECAYS with time since confirmation — an
// old unconfirmed fact quietly demotes itself back to "worth re-asking".

import { getServiceClient, TABLE_PREFIX } from "../supabase";

const MEMORY = `${TABLE_PREFIX}user_memory`;
const PROFILE = `${TABLE_PREFIX}user_profile`;

export type MemoryFact = {
  id: string;
  fact: string;                  // closed-set key, or observation:* / default:<tool>.<slot>
  value: string;
  confidence: number;            // stored, pre-decay
  kind: "behavioral" | "default";
  provenance: string | null;     // thread_id it was learned in
  as_of: string;
  last_confirmed: string | null;
};

export type MemoryBundle = {
  userId: string;
  profile: { email: string; sells: string | null; state: string | null };
  facts: MemoryFact[];
};

// Confidence policy, in one place so it's auditable:
const CONF_EXTRACTED = 0.4;   // a model read it in conversation — plausible, unverified
const CONF_REINFORCE = 0.1;   // the same value extracted again — a little more believable
const CONF_CONFIRMED = 0.9;   // the user said "haan sahi hai" to it — verified by a human
const DECAY_HALF_LIFE_DAYS = 60; // unconfirmed for 60 days → half the confidence
export const CONF_USABLE = 0.25; // below this (post-decay) we stop proposing it as a default

// effectiveConfidence — the stored confidence discounted by age. Time since the user last
// confirmed (or since we learned it) halves the score every DECAY_HALF_LIFE_DAYS. This is the
// "stale memory = confident wrong answer" defense: decay never deletes a fact, it just pushes
// it back below the proposal threshold so the agent re-asks instead of assuming.
export function effectiveConfidence(f: Pick<MemoryFact, "confidence" | "as_of" | "last_confirmed">): number {
  const anchor = Date.parse(f.last_confirmed ?? f.as_of);
  const days = Math.max(0, (Date.now() - anchor) / 86_400_000);
  return f.confidence * Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

// loadMemory — everything we know about a user, in one read: profile (the two onboarding
// answers) + all durable facts. Returns null for anonymous/unknown users so every caller
// degrades to exactly the Phase-8b behavior (memory is an enhancement, never a dependency).
export async function loadMemory(userId: string | undefined | null): Promise<MemoryBundle | null> {
  if (!userId) return null;
  const s = getServiceClient();
  const { data: profile } = await s.from(PROFILE).select("email, sells, state").eq("user_id", userId).maybeSingle();
  if (!profile) return null;
  const { data: facts } = await s
    .from(MEMORY)
    .select("id, fact, value, confidence, kind, provenance, as_of, last_confirmed")
    .eq("user_id", userId)
    .order("as_of", { ascending: false });
  return { userId, profile, facts: (facts ?? []) as MemoryFact[] };
}

// getFact — merged view of one behavioral fact. A memory row (learned in conversation, newer)
// shadows the onboarding profile answer for sells/state; everything else lives only in memory.
// Only returns facts still above the usability floor after decay.
export function getFact(bundle: MemoryBundle, fact: string): { value: string; source: "profile" | "memory"; asOf: string; confirmed: boolean } | null {
  const row = bundle.facts.find((f) => f.fact === fact && f.kind === "behavioral");
  if (row && effectiveConfidence(row) >= CONF_USABLE) {
    return { value: row.value, source: "memory", asOf: row.as_of, confirmed: !!row.last_confirmed };
  }
  if (fact === "sells" && bundle.profile.sells) return { value: bundle.profile.sells, source: "profile", asOf: "", confirmed: true };
  if (fact === "state" && bundle.profile.state) return { value: bundle.profile.state, source: "profile", asOf: "", confirmed: true };
  return null;
}

// getDefault — a confirmed procedural default for one tool slot ("default:gstr_late_fee.
// return_type"), if it's still confident enough to propose. NOTE the contract: a default is
// only ever PROPOSED (it lands in pending.assumed and is shown for confirmation) — this
// function deciding "usable" never means "silently applied".
export function getDefault(bundle: MemoryBundle, tool: string, slot: string): { value: string; asOf: string } | null {
  const row = bundle.facts.find((f) => f.fact === `default:${tool}.${slot}` && f.kind === "default");
  if (!row || effectiveConfidence(row) < CONF_USABLE) return null;
  return { value: row.value, asOf: row.last_confirmed ?? row.as_of };
}

// memoryContextBlock — the injection text for intake + the RAG generation context. The header
// is a guardrail, not decoration: downstream models are told this is BACKGROUND, never a source
// for a rate/amount/eligibility — those must come from the user or a confirmation this turn.
export function memoryContextBlock(bundle: MemoryBundle | null): string {
  if (!bundle) return "";
  const lines: string[] = [];
  const seen = new Set(bundle.facts.filter((f) => f.kind === "behavioral").map((f) => f.fact));
  if (!seen.has("sells") && bundle.profile.sells) lines.push(`- sells: ${bundle.profile.sells}`);
  if (!seen.has("state") && bundle.profile.state) lines.push(`- state: ${bundle.profile.state}`);
  for (const f of bundle.facts) {
    if (f.kind !== "behavioral") continue;
    if (effectiveConfidence(f) < CONF_USABLE) continue;
    lines.push(`- ${f.fact}: ${f.value} (as of ${f.as_of.slice(0, 10)}${f.last_confirmed ? ", user-confirmed" : ", unconfirmed"})`);
  }
  if (!lines.length) return "";
  return [
    "KNOWN ABOUT THIS USER (stored memory — background context ONLY. Never use it as the source of a rate, an amount, or an eligibility conclusion; those need the user's words or an explicit confirmation in THIS conversation):",
    ...lines,
  ].join("\n");
}

// upsertFact — write one model-extracted behavioral fact. Re-seeing the SAME value nudges
// confidence up a little (reinforcement); a CHANGED value resets to low confidence with a fresh
// as_of (the world moved — the old belief doesn't transfer its trust to the new one).
export async function upsertFact(userId: string, fact: string, value: string, provenance: string | null): Promise<void> {
  const s = getServiceClient();
  const { data: existing } = await s.from(MEMORY).select("id, value, confidence").eq("user_id", userId).eq("fact", fact).maybeSingle();
  if (existing && existing.value === value) {
    await s.from(MEMORY).update({
      confidence: Math.min(0.7, (existing.confidence as number) + CONF_REINFORCE),
      provenance, as_of: new Date().toISOString(),
    }).eq("id", existing.id);
  } else if (existing) {
    await s.from(MEMORY).update({
      value, confidence: CONF_EXTRACTED, provenance, as_of: new Date().toISOString(), last_confirmed: null,
    }).eq("id", existing.id);
  } else {
    await s.from(MEMORY).insert({ user_id: userId, fact, value, confidence: CONF_EXTRACTED, provenance, kind: "behavioral" });
  }
}

// confirmFact — the confirmation UX just verified this fact (behavioral or a procedural
// default). Confidence jumps to the confirmed level and last_confirmed restarts the decay
// clock. This is the ONLY path to high confidence — a model can propose, only a human confirms.
export async function confirmFact(
  userId: string, fact: string, value: string, provenance: string | null,
  kind: "behavioral" | "default" = "behavioral"
): Promise<void> {
  const s = getServiceClient();
  const now = new Date().toISOString();
  await s.from(MEMORY).upsert(
    { user_id: userId, fact, value, confidence: CONF_CONFIRMED, provenance, kind, as_of: now, last_confirmed: now },
    { onConflict: "user_id,fact" }
  );
}
