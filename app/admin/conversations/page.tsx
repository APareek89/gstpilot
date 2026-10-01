// Conversations — every user prompt and the reply it got, newest first, with tier,
// citations, feedback, and a link to the Langfuse trace. ?live=1 auto-refreshes.

import Link from "next/link";
import { CitationLink } from "@/components/CitationLink";
import type { Citation } from "@/lib/client/citations";
import { listConversations } from "@/lib/repositories/admin";
import { langfuseHost, getLangfuseProjectId } from "@/lib/observability/langfuse";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ live?: string }>;
}) {
  const { live } = await searchParams;
  // Resolve the Langfuse project id once so trace links carry the required /project/<id>/ segment.
  const host = langfuseHost();
  const projectId = await getLangfuseProjectId();
  const traceUrl = (id: string) => (projectId ? `${host}/project/${projectId}/traces/${id}` : `${host}/traces/${id}`);
  const msgs = await listConversations();

  return (
    <main className="p-8 font-sans max-w-4xl mx-auto text-sm">
      {live === "1" && <meta httpEquiv="refresh" content="5" />}
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-bold">Conversations</h1>
        <Link href={live === "1" ? "/admin/conversations" : "/admin/conversations?live=1"} className="text-indigo-600 hover:underline text-xs">
          {live === "1" ? "⏸ stop live" : "▶ live (5s)"}
        </Link>
      </div>
      <div className="space-y-3">
        {msgs?.map((m) => (
          <div key={m.id} className={`border rounded p-3 ${m.role === "user" ? "bg-indigo-50/40" : ""}`}>
            <div className="text-xs text-gray-500 mb-1">
              {new Date(m.created_at).toLocaleTimeString()} · {m.role}
              {m.tier && ` · ${m.tier}`}
              {m.feedback && ` · ${m.feedback === "up" ? "👍" : `👎 ${m.feedback_reason ?? ""}`}`}
              {m.trace_id && (
                <> · <a className="text-indigo-600 hover:underline" target="_blank"
                     href={traceUrl(m.trace_id as string)}>langfuse trace →</a></>
              )}
              <span className="text-gray-300"> · thread {String(m.thread_id).slice(0, 8)}</span>
            </div>
            <div className="whitespace-pre-wrap">{m.content.slice(0, 600)}{m.content.length > 600 ? "…" : ""}</div>
            {Array.isArray(m.citations) && m.citations.length > 0 && (
              <div className="mt-1 text-xs font-mono text-indigo-700">
                {(m.citations as Citation[]).map((c) => (
                  <CitationLink key={c.id} citation={c} historical={m.kind === "filing"} label={c.id} className="mr-2 hover:underline" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {!msgs?.length && <p className="text-gray-500">No conversations yet.</p>}
    </main>
  );
}
