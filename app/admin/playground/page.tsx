// Retrieval Playground — the debugging window into search. Type any question and see THREE
// columns side by side: what meaning-search returned, what keyword-search returned, and the
// fused final ranking the agents will actually consume. Seeing the channels separately is
// how every future "why did it answer that?" gets debugged: a wrong answer is always either
// (a) the right chunk was never retrieved by EITHER channel (corpus/embedding problem),
// (b) one channel found it but fusion buried it (ranking problem), or (c) retrieval was
// fine and generation ignored it (agent problem). One glance here tells you which.

import Link from "next/link";
import { hybridSearch, type ChannelHit, type FusedHit } from "@/lib/retrieval/search";

export const dynamic = "force-dynamic";

function ChunkLink({ id }: { id: string }) {
  return (
    <Link href={`/admin/chunks/${encodeURIComponent(id)}`} className="text-indigo-600 hover:underline font-mono text-xs">
      {id}
    </Link>
  );
}

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  let dense: ChannelHit[] = [];
  let keyword: ChannelHit[] = [];
  let fused: FusedHit[] = [];
  let traceId: string | null = null;
  let transformation: { original: string; rewritten: string; direct_ids: string[] } | null = null;
  let error: string | null = null;

  if (q) {
    try {
      // One shared entry point for ALL retrieval — this call also records the trace row
      // that shows up in /admin/traces.
      const result = await hybridSearch(q, "playground");
      ({ dense, keyword, fused, traceId, transformation } = result);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <main className="p-8 font-sans max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Retrieval Playground</h1>
      <p className="text-sm text-gray-500 mb-4">
        dense = meaning · keyword = exact words · fused = what the agents will see
      </p>

      <form method="GET" className="flex gap-2 mb-6">
        <input
          name="q" defaultValue={q ?? ""} autoFocus
          placeholder="footwear ka GST rate kya hai…"
          className="border rounded px-3 py-2 text-sm flex-1"
        />
        <button className="border rounded px-4 py-2 text-sm bg-gray-50 hover:bg-gray-100">search</button>
      </form>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {transformation && transformation.rewritten !== transformation.original && (
        <p className="text-xs mb-1 text-gray-600">
          <span className="font-semibold">transformed →</span> “{transformation.rewritten}”
          {transformation.direct_ids.length > 0 && <span className="ml-2 text-indigo-700">pinned by reference: {transformation.direct_ids.join(", ")}</span>}
        </p>
      )}
      {traceId && (
        <p className="text-xs text-gray-500 mb-4">
          recorded as <Link href={`/admin/traces/${traceId}`} className="text-indigo-600 hover:underline">trace {traceId.slice(0, 8)}…</Link>
        </p>
      )}

      {q && !error && (
        <div className="grid grid-cols-3 gap-4 text-sm">
          <section>
            <h2 className="font-semibold mb-2">dense (top 20)</h2>
            <ol className="space-y-1.5">
              {dense.map((r, i) => (
                <li key={r.id} className="border rounded px-2 py-1.5">
                  <span className="text-gray-400 mr-1">{i + 1}.</span>
                  <ChunkLink id={r.id} />
                  <span className="text-xs text-gray-500 ml-1">cos {r.score.toFixed(3)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="font-semibold mb-2">keyword (top 20)</h2>
            <ol className="space-y-1.5">
              {keyword.map((r, i) => (
                <li key={r.id} className="border rounded px-2 py-1.5">
                  <span className="text-gray-400 mr-1">{i + 1}.</span>
                  <ChunkLink id={r.id} />
                  <span className="text-xs text-gray-500 ml-1">rank {r.score.toFixed(4)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="font-semibold mb-2">fused final (top 8)</h2>
            <ol className="space-y-1.5">
              {fused.map((r, i) => (
                <li key={r.id} className="border rounded px-2 py-1.5 bg-indigo-50/40">
                  <div>
                    <span className="text-gray-400 mr-1">{i + 1}.</span>
                    <ChunkLink id={r.id} />
                  </div>
                  <div className="text-xs text-gray-500">
                    rrf {r.rrf_score.toFixed(4)} · dense #{r.dense_rank ?? "—"} · kw #{r.keyword_rank ?? "—"}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">{r.snippet}…</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </main>
  );
}
