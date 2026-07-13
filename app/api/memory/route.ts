// /api/memory — the user's window into (and control over) what the agent remembers.
// Memory you can't see is surveillance; memory you can see and DELETE is a feature. GET returns
// every stored fact with its post-decay confidence and dates so the panel can show "as of …";
// PATCH lets the user correct a value (their edit counts as a confirmation — who knows their
// business better?); DELETE removes a fact outright.
//
// ⚠️ HUMAN TASK (Anand): this table is business PII (turnover, platforms, state). A real
// deployment needs a consent step at sign-up, a retention policy, and encryption-at-rest
// review before real sellers touch it. Tracked in LEARNING_LOG.

import { NextRequest } from "next/server";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";
import { effectiveConfidence, CONF_USABLE } from "@/lib/memory/store";

const MEMORY = `${TABLE_PREFIX}user_memory`;
const PROFILE = `${TABLE_PREFIX}user_profile`;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  const s = getServiceClient();
  const { data: profile } = await s.from(PROFILE).select("email, sells, state, created_at").eq("user_id", userId).maybeSingle();
  if (!profile) return Response.json({ error: "unknown user" }, { status: 404 });
  const { data: facts } = await s
    .from(MEMORY)
    .select("id, fact, value, confidence, kind, as_of, last_confirmed")
    .eq("user_id", userId)
    .order("kind", { ascending: true })
    .order("as_of", { ascending: false });
  return Response.json({
    profile,
    facts: (facts ?? []).map((f) => ({
      ...f,
      // the panel shows the DECAYED number — the one the agent actually acts on
      effective_confidence: Number(effectiveConfidence(f as { confidence: number; as_of: string; last_confirmed: string | null }).toFixed(2)),
      stale: effectiveConfidence(f as { confidence: number; as_of: string; last_confirmed: string | null }) < CONF_USABLE,
    })),
  });
}

// PATCH — the user corrects a remembered value. A direct edit is the strongest confirmation
// there is, so confidence goes to confirmed level and the decay clock restarts.
export async function PATCH(req: NextRequest) {
  const { userId, id, value } = await req.json();
  if (!userId || !id || typeof value !== "string" || !value.trim()) {
    return Response.json({ error: "userId, id and value required" }, { status: 400 });
  }
  const s = getServiceClient();
  const now = new Date().toISOString();
  const { error } = await s.from(MEMORY)
    .update({ value: value.trim().slice(0, 200), confidence: 0.9, as_of: now, last_confirmed: now })
    .eq("id", id).eq("user_id", userId); // user_id in the filter: nobody edits another user's memory
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { userId, id } = await req.json();
  if (!userId || !id) return Response.json({ error: "userId and id required" }, { status: 400 });
  const s = getServiceClient();
  const { error } = await s.from(MEMORY).delete().eq("id", id).eq("user_id", userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
