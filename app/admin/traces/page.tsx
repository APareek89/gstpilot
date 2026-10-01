// Retrieval Traces — list view. The flight recorder's tape: every retrieval anyone (or any
// agent) has run, newest first. ?live=1 auto-refreshes every 5s so you can watch queries
// arrive in real time while testing the app in another tab.

import Link from "next/link";
import { listTraces } from "@/lib/repositories/admin";

export const dynamic = "force-dynamic";

export default async function TracesPage({
  searchParams,
}: {
  searchParams: Promise<{ live?: string }>;
}) {
  const { live } = await searchParams;
  const traces = await listTraces();

  return (
    <main className="p-8 font-sans max-w-5xl mx-auto">
      {live === "1" && <meta httpEquiv="refresh" content="5" />}
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-bold">Retrieval Traces</h1>
        <Link href={live === "1" ? "/admin/traces" : "/admin/traces?live=1"}
          className="text-sm text-indigo-600 hover:underline">
          {live === "1" ? "⏸ stop live refresh" : "▶ live (refresh every 5s)"}
        </Link>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b text-gray-500">
            <th className="py-1 pr-3">when</th>
            <th className="py-1 pr-3">source</th>
            <th className="py-1 pr-3">query</th>
            <th className="py-1 pr-3">top result</th>
            <th className="py-1">embed ms</th>
          </tr>
        </thead>
        <tbody>
          {traces?.map((t) => (
            <tr key={t.id} className="border-b hover:bg-gray-50">
              <td className="py-1.5 pr-3 text-xs text-gray-500 whitespace-nowrap">
                <Link href={`/admin/traces/${t.id}`} className="text-indigo-600 hover:underline">
                  {new Date(t.created_at).toLocaleTimeString()}
                </Link>
              </td>
              <td className="py-1.5 pr-3 text-xs">{t.source}</td>
              <td className="py-1.5 pr-3">{t.query.slice(0, 60)}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{(t.fused as any[])[0]?.id ?? "—"}</td>
              <td className="py-1.5 text-xs text-gray-400">{(t.timings_ms as any).embed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!traces?.length && <p className="text-sm text-gray-500 mt-4">No traces yet — run a query in the Playground.</p>}
    </main>
  );
}
