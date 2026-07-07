// POST /api/ask — the product endpoint. Server-Sent Events (SSE): instead of one response
// at the end, the server keeps the connection open and pushes small "data:" lines as work
// happens — the browser renders progress live. We stream pipeline STAGES (intake, gates,
// resolution) as they fire, then the final answer with citations.
//
// Conversation memory: the UI showing history is NOT the model receiving it — the model is
// stateless and sees only what this handler re-sends. We re-send the last 20 turns verbatim
// plus a compacted summary of anything older (facts stated, amounts, decisions — style and
// pleasantries get dropped). Send nothing and every follow-up ("aur agar late ho jaye?")
// becomes an unanswerable riddle with no referent.

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { askGSTPilot } from "@/lib/agents/pipeline";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VERBATIM_TURNS = 20;

async function buildContext(threadId: string): Promise<string> {
  const s = getServiceClient();
  const { data: thread } = await s.from(`${TABLE_PREFIX}threads`).select("summary").eq("id", threadId).single();
  const { data: msgs } = await s
    .from(`${TABLE_PREFIX}messages`)
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(VERBATIM_TURNS);
  const recent = (msgs ?? []).reverse().map((m) => `${m.role}: ${m.content.slice(0, 800)}`).join("\n");
  return [thread?.summary ? `Summary of earlier conversation: ${thread.summary}` : "", recent]
    .filter(Boolean).join("\n");
}

// Compaction: when a thread outgrows the verbatim window, fold the older turns into one
// standing summary (facts, amounts, what was concluded — never style). Runs after replying.
async function compactIfNeeded(threadId: string) {
  const s = getServiceClient();
  const { count } = await s.from(`${TABLE_PREFIX}messages`).select("id", { count: "exact", head: true }).eq("thread_id", threadId);
  if (!count || count <= VERBATIM_TURNS + 4) return;
  const { data: thread } = await s.from(`${TABLE_PREFIX}threads`).select("summary, summary_upto").eq("id", threadId).single();
  if ((thread?.summary_upto ?? 0) >= count - VERBATIM_TURNS) return;
  const { data: older } = await s.from(`${TABLE_PREFIX}messages`).select("role, content")
    .eq("thread_id", threadId).order("created_at", { ascending: true }).limit(count - VERBATIM_TURNS);
  const res = await new Anthropic().messages.create({
    model: "claude-haiku-4-5-20251001", max_tokens: 400, temperature: 0,
    messages: [{ role: "user", content: `Summarize this GST support conversation in <150 words: the user's business facts (turnover, states, platform), amounts/dates discussed, and conclusions reached. Facts only.\n\n${thread?.summary ? "Earlier summary: " + thread.summary + "\n" : ""}${older!.map((m) => `${m.role}: ${m.content.slice(0, 500)}`).join("\n")}` }],
  });
  const summary = res.content[0].type === "text" ? res.content[0].text : null;
  if (summary) await s.from(`${TABLE_PREFIX}threads`).update({ summary, summary_upto: count - VERBATIM_TURNS }).eq("id", threadId);
}

export async function POST(req: NextRequest) {
  const { question, threadId: incoming } = await req.json();
  const s = getServiceClient();

  let threadId = incoming as string | undefined;
  if (!threadId) {
    const { data } = await s.from(`${TABLE_PREFIX}threads`).insert({ title: question.slice(0, 80) }).select("id").single();
    threadId = data!.id;
  }
  const context = incoming ? await buildContext(threadId!) : "";
  await s.from(`${TABLE_PREFIX}messages`).insert({ thread_id: threadId, role: "user", content: question });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      send({ type: "thread", threadId });
      try {
        const r = await askGSTPilot(question, {
          context,
          onStep: (st) => send({ type: "status", name: st.name, ok: st.ok }),
        });
        // citations: chunk id + heading + the exact legal text relied on (first 400 chars)
        const tagIds = [...new Set([...r.reply.matchAll(/\[([A-Z]+-[A-Z]+\/[A-Za-z0-9./-]+?)\]/g)].map((m) => m[1]))];
        const { data: chunks } = tagIds.length
          ? await s.from(`${TABLE_PREFIX}legal_chunks`).select("id, heading_path, text").in("id", tagIds)
          : { data: [] as any[] };
        const citations = (chunks ?? []).map((c) => ({
          id: c.id, heading: (c.heading_path as string[]).join(" › "), snippet: (c.text as string).slice(0, 400),
        }));
        const { data: saved } = await s.from(`${TABLE_PREFIX}messages`).insert({
          thread_id: threadId, role: "assistant", content: r.reply,
          tier: r.tier, citations, trace_id: r.traceId,
        }).select("id").single();
        send({ type: "answer", messageId: saved?.id, reply: r.reply, tier: r.tier, escalated: r.escalated, abstained: r.abstained, citations, traceId: r.traceId });
        compactIfNeeded(threadId!).catch(() => {});
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      }
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
