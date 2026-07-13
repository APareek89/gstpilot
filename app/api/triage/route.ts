// Phase 8 flywheel — the triage API behind /admin/triage.
// GET: the review queue — every 👎 message (from the DB, where feedback + question context live),
//      tagged with whether it's already been captured into the golden set (source_trace_id match).
// POST action=predraft: re-runs retrieval on the question and asks Haiku to PRE-DRAFT the golden
//      labels — a typing speed-up only; the human corrects them.
// POST action=approve: appends the HUMAN-APPROVED labels to the golden set (status verified).
// We pull from the DB rather than Langfuse because the message row already carries the question,
// the answer, the reason and the trace id — richer context than reconstructing from a trace. Each
// item still links out to its Langfuse trace. (Gate-failure traces are the documented next source.)

import { NextRequest, NextResponse } from "next/server";
import { langfuseHost, getLangfuseProjectId } from "@/lib/observability/langfuse";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";
import { hybridSearch } from "@/lib/retrieval/search";
import { predraftGolden } from "@/lib/golden/predraft";
import { appendGoldenCase } from "@/lib/golden/append";

// the 👎 sits on an assistant message; the question is the user turn just before it in-thread
async function priorQuestion(sb: ReturnType<typeof getServiceClient>, threadId: string, before: string): Promise<string> {
  const { data } = await sb
    .from(`${TABLE_PREFIX}messages`)
    .select("content")
    .eq("thread_id", threadId).eq("role", "user").lt("created_at", before)
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0]?.content ?? "";
}

export async function GET() {
  const sb = getServiceClient();
  const { data: downs } = await sb
    .from(`${TABLE_PREFIX}messages`)
    .select("id, thread_id, created_at, content, trace_id, feedback_reason")
    .eq("feedback", "down").order("created_at", { ascending: false }).limit(50);

  const golden = JSON.parse(readFileSync(join(process.cwd(), "evals", "golden.json"), "utf8"));
  const captured = new Set((golden.cases ?? []).map((c: { source_trace_id?: string }) => c.source_trace_id).filter(Boolean));

  const items = [];
  for (const m of downs ?? []) {
    items.push({
      messageId: m.id as string,
      traceId: (m.trace_id as string) ?? null,
      reason: (m.feedback_reason as string) ?? "",
      answer: String(m.content).slice(0, 500),
      createdAt: m.created_at as string,
      question: await priorQuestion(sb, m.thread_id as string, m.created_at as string),
      alreadyCaptured: m.trace_id ? captured.has(m.trace_id) : false,
    });
  }
  return NextResponse.json({
    items,
    goldenVersion: golden.version ?? "?",
    langfuseHost: langfuseHost(),
    langfuseProjectId: await getLangfuseProjectId(), // for the correct /project/<id>/traces/<id> link
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "predraft") {
    // re-run retrieval so the model's candidate chunk ids reflect what CURRENT retrieval returns
    const retrieval = await hybridSearch(String(body.question), "triage");
    const retrievedIds = retrieval.fused.map((c) => c.id);
    const labels = await predraftGolden({
      question: String(body.question),
      retrievedIds,
      failureReason: String(body.reason || "user marked the answer bad"),
    });
    return NextResponse.json({ labels, retrievedIds });
  }

  if (body.action === "approve") {
    // approvedBy is set → the case becomes "verified" and WILL gate CI. Only reachable after the
    // human has reviewed every label in the UI.
    const result = appendGoldenCase(body.labels, {
      sourceTraceId: body.sourceTraceId ?? undefined,
      approvedBy: body.approvedBy || "Anand",
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
