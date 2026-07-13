// /api/user — the lightest possible sign-up: EMAIL AS IDENTITY, no password.
// POST {email} either creates a user or recognises a returning one (same email → same row →
// same memories). The browser keeps the returned user_id in localStorage; every /api/ask call
// carries it, which is how threads — and everything the agent learns — attach to a person.
// PATCH saves the two (and only two) onboarding facts: what they sell, and which state.
//
// ⚠️ HUMAN TASK (Anand, before any real deployment): this is a LEARNING-BUILD shortcut — anyone
// typing an email becomes that user. Real sign-in needs a magic-link (prove you own the inbox)
// plus an explicit consent step for storing business data. Flagged in LEARNING_LOG.

import { NextRequest } from "next/server";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";

const PROFILE = `${TABLE_PREFIX}user_profile`;

// POST — sign in / sign up with just an email. Upsert on the unique email column: a new email
// inserts a fresh row; a returning email leaves the existing row (and its sells/state) intact,
// so the response tells the UI whether onboarding is still needed.
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  const clean = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return Response.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  const s = getServiceClient();
  // upsert with ignoreDuplicates:false would overwrite sells/state with nulls — so instead:
  // try the read first, insert only when the user is genuinely new.
  const { data: existing } = await s.from(PROFILE).select("user_id, email, sells, state").eq("email", clean).maybeSingle();
  if (existing) return Response.json({ ...existing, returning: true });
  const { data, error } = await s.from(PROFILE).insert({ email: clean }).select("user_id, email, sells, state").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ...data, returning: false });
}

// PATCH — save the onboarding answers (or later edits from the memory panel).
export async function PATCH(req: NextRequest) {
  const { userId, sells, state } = await req.json();
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  const patch: Record<string, string> = {};
  if (typeof sells === "string" && sells.trim()) patch.sells = sells.trim();
  if (typeof state === "string" && state.trim()) patch.state = state.trim();
  const s = getServiceClient();
  const { data, error } = await s.from(PROFILE).update(patch).eq("user_id", userId).select("user_id, email, sells, state").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
