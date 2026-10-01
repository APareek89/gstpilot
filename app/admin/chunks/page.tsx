// Chunk Inspector — list view. The builder's window into what the law was chunked into:
// filter by act / doc type / status, search text, and spot-check that every provision kept
// its provisos attached (the ⚖ badge marks chunks containing "Provided that" so proviso
// attachment can be verified at a glance). Strictly READ-ONLY: law text is never hand-edited
// here or anywhere — every character in the database must trace back through corpus-text/
// and the manifest's sha256 to an official government PDF. An edit box would break that
// audit chain silently and permanently.

import Link from "next/link";
import { listChunks } from "@/lib/repositories/admin";

export const dynamic = "force-dynamic";

const ACTS = ["CGST-ACT", "IGST-ACT", "CGST-RULES", "NOTIF-CT", "NOTIF-CTR", "CIRCULAR"];

export default async function ChunksPage({
  searchParams,
}: {
  searchParams: Promise<{ act?: string; type?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const { chunks, count } = await listChunks(params);

  return (
    <main className="p-8 font-sans max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Chunk Inspector</h1>
      <p className="text-sm text-gray-500 mb-4">
        read-only · {count ?? 0} chunks match · showing first {chunks?.length ?? 0} · ⚖ = contains proviso
      </p>

      <form className="flex gap-2 mb-6 flex-wrap" method="GET">
        <select aria-label="Act" name="act" defaultValue={params.act ?? ""} className="border rounded px-2 py-1 text-sm">
          <option value="">all acts</option>
          {ACTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select aria-label="Source status" name="status" defaultValue={params.status ?? ""} className="border rounded px-2 py-1 text-sm">
          <option value="">all statuses</option>
          <option value="in_force">in_force</option>
          <option value="amended">amended</option>
          <option value="superseded">superseded</option>
        </select>
        <input aria-label="Provision type" name="type" defaultValue={params.type ?? ""} placeholder="provision_type"
          className="border rounded px-2 py-1 text-sm w-36" />
        <input aria-label="Search source text" name="q" defaultValue={params.q ?? ""} placeholder="search text…"
          className="border rounded px-2 py-1 text-sm w-56" />
        <button className="border rounded px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100">filter</button>
      </form>


      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b text-gray-500">
            <th className="py-1 pr-3">id</th>
            <th className="py-1 pr-3">heading path</th>
            <th className="py-1 pr-3">type</th>
            <th className="py-1 pr-3">status</th>
            <th className="py-1">chars</th>
          </tr>
        </thead>
        <tbody>
          {chunks?.map((c) => (
            <tr key={c.id} className="border-b hover:bg-gray-50 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <Link href={`/admin/chunks/${encodeURIComponent(c.id)}`} className="text-indigo-600 hover:underline font-mono text-xs">
                  {c.id}
                </Link>
                {c.text.includes("Provided") && <span title="contains proviso" className="ml-1">⚖</span>}
              </td>
              <td className="py-1.5 pr-3 text-xs text-gray-600">{(c.heading_path as string[]).join(" › ")}</td>
              <td className="py-1.5 pr-3 text-xs">{c.provision_type ?? "—"}</td>
              <td className="py-1.5 pr-3 text-xs">{c.status}</td>
              <td className="py-1.5 text-xs text-gray-400">{c.text.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
