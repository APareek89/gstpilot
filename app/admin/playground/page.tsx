"use client";
// Retrieval Playground — the debugging window into search. Type any question and see THREE
// columns side by side: what meaning-search returned, what keyword-search returned, and the
// fused final ranking the agents will actually consume. Seeing the channels separately is
// how every future "why did it answer that?" gets debugged: a wrong answer is always either
// (a) the right chunk was never retrieved by EITHER channel (corpus/embedding problem),
// (b) one channel found it but fusion buried it (ranking problem), or (c) retrieval was
// fine and generation ignored it (agent problem). One glance here tells you which.

import Link from "next/link";
import type { ChannelHit, FusedHit } from "@/lib/retrieval/search";
import { useEffect, useState } from "react";
import { useRequests } from "@/components/AccountShell";


function ChunkLink({ id }: { id: string }) {
  return (
    <Link href={`/admin/chunks/${encodeURIComponent(id)}`} className="text-indigo-600 hover:underline font-mono text-xs">
      {id}
    </Link>
  );
}

export default function PlaygroundPage() {
  const requests = useRequests();
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false);
  const [dense, setDense] = useState<ChannelHit[]>([]); const [keyword, setKeyword] = useState<ChannelHit[]>([]); const [fused, setFused] = useState<FusedHit[]>([]);
  const [traceId, setTraceId] = useState<string | null>(null); const [transformation, setTransformation] = useState<{ original: string; rewritten: string; direct_ids: string[] } | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { setQ(new URLSearchParams(window.location.search).get('q') ?? ''); }, []);
  async function search(event: React.FormEvent) {
    event.preventDefault(); if (!q.trim() || busy) return; const ticket = requests.capture(); setBusy(true); setError(null); setSearched(false);
    try { const result = await requests.request<{dense:ChannelHit[]; keyword:ChannelHit[]; fused:FusedHit[]; traceId:string|null; transformation:typeof transformation}>('/api/retrieval', 'POST', {query:q.trim()});
      if (result) { setDense(result.dense); setKeyword(result.keyword); setFused(result.fused); setTraceId(result.traceId); setTransformation(result.transformation); setSearched(true); }
    } catch (e) { if (requests.current(ticket)) setError(e instanceof Error ? e.message : 'Search was not completed.'); }
    finally { if (requests.current(ticket)) setBusy(false); }
  }

  return (
    <main className="p-8 font-sans max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Retrieval Playground</h1>
      <p className="text-sm text-gray-500 mb-4">
        dense = meaning · keyword = exact words · fused = what the agents will see
      </p>

      <form onSubmit={search} className="flex gap-2 mb-6">
        <input
          name="q" aria-label="Retrieval query" value={q} onChange={e => setQ(e.target.value)} maxLength={8000} autoFocus
          placeholder="footwear ka GST rate kya hai…"
          className="border rounded px-3 py-2 text-sm flex-1"
        />
        <button disabled={busy || !q.trim()} className="btn primary">{busy ? "Searching…" : "Search"}</button>
      </form>

      <p className="text-xs text-gray-500 mb-4">Search uses the configured provider when you submit. Source coverage is limited and dated.</p>
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

      {searched && !error && (
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
