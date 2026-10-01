// Retrieval Trace — detail view. The full behind-the-scenes picture of ONE retrieval:
// the constants in force, per-stage timings, both channels with ranks and raw scores,
// and the fusion table showing the exact RRF arithmetic per surviving chunk.

import Link from "next/link";
import { getTrace } from "@/lib/repositories/admin";

export const dynamic = "force-dynamic";

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTrace(id);

  if (!t) return <main className="p-8">Trace not found.</main>;

  const cfg = t.config as { rrf_k: number; channel_top_n: number; final_top_n: number; model: string };
  const dense = t.dense as { id: string; score: number; rank: number }[];
  const keyword = t.keyword as { id: string; score: number; rank: number }[];
  const fused = t.fused as { id: string; rrf: number; dense_rank: number | null; keyword_rank: number | null }[];

  const CL = ({ id }: { id: string }) => (
    <Link href={`/admin/chunks/${encodeURIComponent(id)}`} className="text-indigo-600 hover:underline font-mono text-xs">{id}</Link>
  );

  return (
    <main className="p-8 font-sans max-w-6xl mx-auto text-sm">
      <Link href="/admin/traces" className="text-indigo-600 hover:underline">← all traces</Link>
      <h1 className="text-xl font-bold mt-2">“{t.query}”</h1>
      <p className="text-xs text-gray-500 mb-4">
        {new Date(t.created_at).toLocaleString()} · source: {t.source} · model: {cfg.model} ·
        constants: rrf_k={cfg.rrf_k}, per-channel top-{cfg.channel_top_n} → final top-{cfg.final_top_n} ·
        timings: embed {(t.timings_ms as any).embed}ms, search {(t.timings_ms as any).dense}ms
      </p>

      <h2 className="font-semibold mb-2">Fusion arithmetic (what the agents received)</h2>
      <table className="border-collapse mb-8 text-xs">
        <thead>
          <tr className="text-left border-b text-gray-500">
            <th className="py-1 pr-4">#</th><th className="py-1 pr-4">chunk</th>
            <th className="py-1 pr-4">dense rank</th><th className="py-1 pr-4">keyword rank</th>
            <th className="py-1 pr-4">arithmetic</th><th className="py-1">RRF score</th>
          </tr>
        </thead>
        <tbody>
          {fused.map((r, i) => {
            const dTerm = r.dense_rank ? `1/(${cfg.rrf_k}+${r.dense_rank})` : "0";
            const kTerm = r.keyword_rank ? `1/(${cfg.rrf_k}+${r.keyword_rank})` : "0";
            return (
              <tr key={r.id} className="border-b">
                <td className="py-1.5 pr-4 text-gray-400">{i + 1}</td>
                <td className="py-1.5 pr-4"><CL id={r.id} /></td>
                <td className="py-1.5 pr-4">{r.dense_rank ?? "not in top-20"}</td>
                <td className="py-1.5 pr-4">{r.keyword_rank ?? "not in top-20"}</td>
                <td className="py-1.5 pr-4 font-mono">{dTerm} + {kTerm}</td>
                <td className="py-1.5 font-mono">{r.rrf.toFixed(5)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-2">Dense channel (cosine similarity)</h2>
          <ol className="space-y-1">
            {dense.map((r) => (
              <li key={r.id} className="text-xs">
                <span className="text-gray-400 mr-1">{r.rank}.</span>
                <CL id={r.id} /> <span className="text-gray-500">cos {r.score.toFixed(4)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2 className="font-semibold mb-2">Keyword channel (ts_rank_cd)</h2>
          <ol className="space-y-1">
            {keyword.map((r) => (
              <li key={r.id} className="text-xs">
                <span className="text-gray-400 mr-1">{r.rank}.</span>
                <CL id={r.id} /> <span className="text-gray-500">score {r.score.toFixed(4)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
