// Chunk Inspector — detail view. Full text of one chunk with its complete metadata and
// heading path, provisos/explanations highlighted so mis-attached ones stand out during
// the 20-chunk sign-off inspection. Read-only, same audit-trail reasoning as the list view.

import Link from "next/link";
import { getChunk } from "@/lib/repositories/admin";

export const dynamic = "force-dynamic";

export default async function ChunkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await getChunk(id);

  if (!c) return <main className="p-8">Chunk not found.</main>;

  // Highlight legal connectives so a proviso glued to the wrong section is visually obvious.
  const paragraphs = (c.text as string).split("\n").map((line: string, i: number) => {
    const isProviso = /^\s*(Provided|Explanation|Exception)/.test(line) || /\[\s*(Provided|Explanation)/.test(line);
    return (
      <p key={i} className={isProviso ? "bg-amber-50 border-l-4 border-amber-400 pl-2 py-0.5" : ""}>
        {line || " "}
      </p>
    );
  });

  const meta: [string, string][] = [
    ["act", c.act], ["doc_type", c.doc_type], ["section", c.section ?? "—"],
    ["heading path", (c.heading_path as string[]).join(" › ") || "—"],
    ["provision_type", c.provision_type ?? "(not enriched yet)"],
    ["cross_refs", (c.cross_refs as string[]).join(", ") || "—"],
    ["status", c.status], ["effective_date", c.effective_date ?? "—"],
    ["amends", (c.amends as string[]).join(", ") || "—"],
    ["source doc", c.source_doc_id],
  ];

  return (
    <main className="p-8 font-sans max-w-4xl mx-auto">
      <Link href="/admin/chunks" className="text-sm text-indigo-600 hover:underline">← back to list</Link>
      <h1 className="text-xl font-bold font-mono mt-2 mb-4">{c.id}</h1>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm mb-6">
        {meta.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border rounded p-4 text-sm leading-relaxed whitespace-pre-wrap font-serif">
        {paragraphs}
      </div>
    </main>
  );
}
