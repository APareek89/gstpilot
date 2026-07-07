// Eval run — detail view. Per-metric numbers plus the case-by-case table: every golden
// question, its tier, whether retrieval found a relevant chunk and at what rank. Misses are
// highlighted and deep-link into the Playground with the failing question pre-filled — the
// debugging loop is: see the miss here → replay it there → read both channels.

import Link from "next/link";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function EvalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceClient();
  const { data: run } = await supabase
    .from(`${TABLE_PREFIX}eval_runs`)
    .select("*")
    .eq("id", id)
    .single();

  if (!run) return <main className="p-8">Run not found.</main>;
  const rep = run.report as any;
  const cases = (run.per_case as any[]) ?? [];
  const graded = cases.filter((c) => c.hit !== null);
  const misses = graded.filter((c) => !c.hit);

  return (
    <main className="p-8 font-sans max-w-5xl mx-auto text-sm">
      <Link href="/admin/evals" className="text-indigo-600 hover:underline">← all runs</Link>
      <h1 className="text-xl font-bold mt-2 mb-1">{run.sut}</h1>
      <p className="text-xs text-gray-500 mb-4">{new Date(run.created_at).toLocaleString()} · {run.cases} cases</p>

      <div className="flex gap-6 mb-6">
        {rep.retrieval && (
          <div className="border rounded p-3">
            <div className="text-2xl font-bold font-mono">{rep.retrieval.recall_at_10}</div>
            <div className="text-xs text-gray-500">recall@10 (bar: ≥ 0.9)</div>
            <div className="text-xs text-gray-400 mt-1">
              rank distribution: {Object.entries(rep.retrieval.top_hit_ranks).map(([r, n]) => `#${r}×${n}`).join(" ")}
            </div>
          </div>
        )}
        {rep.answers && (
          <div className="border rounded p-3">
            <div className="text-2xl font-bold font-mono">{rep.answers.false_answer_rate}</div>
            <div className="text-xs text-gray-500">false-answer rate (bar: ≈ 0)</div>
          </div>
        )}
        {rep.tiers && (
          <div className="border rounded p-3">
            <div className="text-2xl font-bold font-mono">{rep.tiers.t3_recall}</div>
            <div className="text-xs text-gray-500">T3 recall (bar: 1.0)</div>
          </div>
        )}
      </div>

      <h2 className="font-semibold mb-2">Per-case results {misses.length > 0 && `— ${misses.length} miss${misses.length > 1 ? "es" : ""}`}</h2>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left border-b text-gray-500">
            <th className="py-1 pr-3">case</th>
            <th className="py-1 pr-3">question</th>
            <th className="py-1 pr-3">tier</th>
            <th className="py-1 pr-3">result</th>
            <th className="py-1">replay</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} className={`border-b ${c.hit === false ? "bg-red-50" : ""}`}>
              <td className="py-1.5 pr-3 font-mono">{c.id}</td>
              <td className="py-1.5 pr-3">{c.question}</td>
              <td className="py-1.5 pr-3">{c.tier}</td>
              <td className="py-1.5 pr-3">
                {c.unanswerable ? <span className="text-gray-400">unanswerable (not graded here)</span>
                  : c.hit === null ? "—"
                  : c.hit ? <span className="text-green-700">hit @ #{c.first_rank}</span>
                  : <span className="text-red-700 font-semibold">MISS</span>}
              </td>
              <td className="py-1.5">
                <Link href={`/admin/playground?q=${encodeURIComponent(c.question)}`} className="text-indigo-600 hover:underline">
                  playground →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
