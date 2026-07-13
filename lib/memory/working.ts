// WORKING MEMORY — the conversation's live, ephemeral state, now PERSISTED.
// Phase 8b's ASK re-derived everything from raw chat text every turn: fillSlots re-read the
// last 20 turns and re-extracted every value, every time. This file gives the thread ONE
// structured object (`pending`, stored as jsonb on gstpilot_threads) that says exactly where
// a clarification stands: which tool we're gathering for, which values are already in hand,
// which are ASSUMED from long-term memory (proposed, not yet confirmed!), and which are still
// missing. A clarification round now RESUMES instead of being reconstructed.
//
// This deliberately EXTENDS the Phase-8b SlotFill rather than adding a parallel store —
// `values` here are exactly fillSlots' values, plus bookkeeping. One object, one source of truth.

export type SlotValue = string | number | boolean;

// One memory-proposed slot value awaiting the user's yes/no. `why` is shown to the user in the
// confirmation ("aapne pichhli baar bataya tha") — an assumption must always carry its origin.
export type AssumedSlot = { value: SlotValue; why: string };

export type PendingState = {
  tool: string;                             // registry tool the ASK is gathering inputs for
  intent: string;                           // the intake intent that started the gather
  values: Record<string, SlotValue>;        // slots the USER stated (or confirmed) — trusted
  assumed: Record<string, AssumedSlot>;     // memory pre-fills SHOWN but not yet confirmed
  missing: string[];                        // required slot names we still have to ask for
  rejected?: string[];                      // slots whose assumption the user rejected — never re-propose this thread
  asked_at: string;                         // ISO timestamp of the ask/confirmation we sent
};

// A pending gather goes stale fast — a user coming back tomorrow is probably asking something
// new, and resuming a day-old half-filled late-fee form would be confusing, not helpful.
const PENDING_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function isFresh(p: PendingState | null | undefined): p is PendingState {
  if (!p?.tool || !p.asked_at) return false;
  return Date.now() - Date.parse(p.asked_at) < PENDING_TTL_MS;
}

// detectStance — did the user's reply CONFIRM or REJECT the assumptions we showed? Deterministic
// (a regex, not a model) because this is the trust boundary of the whole confirm-not-ask design:
// an assumption only graduates to a trusted value through THIS check or an explicit user-stated
// value. Word-boundary matching, negation checked FIRST ("nahi, GSTR-1 hai" must not read as a
// yes because "hai" resembles "haan"). "neutral" = the user answered the remaining questions
// without objecting to the shown assumptions — treated as implicit consent (they saw them and
// moved on), a deliberate UX decision recorded in the docs.
export function detectStance(message: string): "affirm" | "negate" | "neutral" {
  const t = ` ${message.toLowerCase()} `;
  if (/\b(nahi|nahin|no|nope|galat|wrong|incorrect|change|badal|alag)\b/.test(t)) return "negate";
  if (/\b(haan|han|ha|yes|yup|yeah|sahi|correct|theek|thik|right|ok|okay|bilkul)\b/.test(t)) return "affirm";
  return "neutral";
}
