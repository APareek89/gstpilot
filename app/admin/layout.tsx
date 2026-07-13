// Shared frame for all admin surfaces — one nav bar so the builder can hop between
// the Chunk Inspector, Retrieval Playground and Retrieval Traces. All read-only windows.

import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="flex gap-4 px-8 py-3 border-b bg-gray-50 text-sm font-medium">
        <span className="text-gray-400">GSTPilot admin</span>
        <Link href="/admin/chunks" className="text-indigo-600 hover:underline">Chunks</Link>
        <Link href="/admin/playground" className="text-indigo-600 hover:underline">Playground</Link>
        <Link href="/admin/traces" className="text-indigo-600 hover:underline">Traces</Link>
        <Link href="/admin/evals" className="text-indigo-600 hover:underline">Evals</Link>
        <Link href="/admin/conversations" className="text-indigo-600 hover:underline">Conversations</Link>
        <Link href="/admin/triage" className="text-indigo-600 hover:underline font-semibold">Triage → Golden</Link>
        <Link href="/admin/architecture" className="text-indigo-600 hover:underline">Architecture ▸</Link>
      </nav>
      {children}
    </div>
  );
}
