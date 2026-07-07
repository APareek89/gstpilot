// Eval runs — list view. Every golden-set execution, newest first, with its headline
// metrics side by side so improvement (or regression) across runs is visible at a glance.

import Link from "next/link";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const supabase = getServiceClient();
  const { data: runs } = await supabase
    .from(`${TABLE_PREFIX}eval_runs`)
    .select("id, created_at, sut, cases, report")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <main className="p-8 font-sans max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Golden-set Eval Runs</h1>
      <p className="text-sm text-gray-500 mb-4">run with: pnpm eval · target bar: recall@10 ≥ 0.9 · T3 recall = 1.0</p>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b text-gray-500">
            <th className="py-1 pr-3">when</th>
            <th className="py-1 pr-3">system under test</th>
            <th className="py-1 pr-3">cases</th>
            <th className="py-1 pr-3">recall@10</th>
            <th className="py-1 pr-3">false-answer</th>
            <th className="py-1">T3 recall</th>
          </tr>
        </thead>
        <tbody>
          {runs?.map((r) => {
            const rep = r.report as any;
            return (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
                  <Link href={`/admin/evals/${r.id}`} className="text-indigo-600 hover:underline">
                    {new Date(r.created_at).toLocaleString()}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 text-xs">{r.sut}</td>
                <td className="py-1.5 pr-3 text-xs">{r.cases}</td>
                <td className="py-1.5 pr-3 font-mono">{rep.retrieval ? rep.retrieval.recall_at_10 : "—"}</td>
                <td className="py-1.5 pr-3 font-mono">{rep.answers ? rep.answers.false_answer_rate : "—"}</td>
                <td className="py-1.5 font-mono">{rep.tiers ? rep.tiers.t3_recall : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!runs?.length && <p className="text-sm text-gray-500 mt-4">No runs yet — run: pnpm eval</p>}
    </main>
  );
}
