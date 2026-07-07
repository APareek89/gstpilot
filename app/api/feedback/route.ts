// POST /api/feedback — thumbs up/down on an assistant message. A down-vote carries one
// reason (wrong / unclear / didnt_answer). Written to the message row AND as a Langfuse
// score on the reply's trace — in Phase 8, down-voted traces get triaged: the question,
// the retrieved chunks and the failure reason are exactly the raw material of a new
// golden case (real user, real miss, already labeled with what went wrong).

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";
import { getLangfuse } from "@/lib/observability/langfuse";

export async function POST(req: NextRequest) {
  const { messageId, verdict, reason } = await req.json();
  if (!messageId || !["up", "down"].includes(verdict)) {
    return NextResponse.json({ error: "messageId + verdict up|down required" }, { status: 400 });
  }
  const s = getServiceClient();
  const { data: msg, error } = await s.from(`${TABLE_PREFIX}messages`)
    .update({ feedback: verdict, feedback_reason: verdict === "down" ? reason ?? null : null })
    .eq("id", messageId).select("trace_id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (msg?.trace_id) {
    try {
      const lf = getLangfuse();
      lf.score({ traceId: msg.trace_id, name: "user_feedback", value: verdict === "up" ? 1 : 0, comment: reason });
      await lf.flushAsync();
    } catch { /* observability never blocks */ }
  }
  return NextResponse.json({ ok: true });
}
