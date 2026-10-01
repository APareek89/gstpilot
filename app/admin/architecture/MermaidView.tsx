// The client half of the Architecture view. Loads Mermaid in the browser, renders the SELECTED
// diagram's .mmd source to SVG, and offers tabs (one per diagram), zoom, and an SVG download.
// Mermaid is a RENDERER only (diagram text → picture); the diagram text itself comes from the
// server (the .mmd files on disk), so this page always shows whatever is currently committed.

"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentPrompt } from "./agent-prompts";

type Diagram = { slug: string; title: string; code: string; mtime: number };
type StaleInfo = { stale: boolean; srcAt: number; mmdAt: number };

// The live "memory in action" payload the server page assembles: every signed-up user with their
// durable facts (stored + post-decay confidence) and any in-flight working-memory `pending`.
export type MemoryUser = {
  user_id: string;
  email: string;
  sells: string | null;
  state: string | null;
  facts: {
    fact: string; value: string; kind: "behavioral" | "default";
    confidence: number; effective: number; as_of: string; last_confirmed: string | null; provenance: string | null;
  }[];
  pendings: { thread_id: string; title: string; fresh: boolean; pending: unknown }[];
};

export default function MermaidView({ diagrams, prompts, staleInfo, memory }: { diagrams: Diagram[]; prompts: AgentPrompt[]; staleInfo: StaleInfo; memory: { users: MemoryUser[]; error?: string } }) {
  const [view, setView] = useState<"diagrams" | "prompts" | "memory">("diagrams");
  const [active, setActive] = useState(0);
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(1);
  const [memSvg, setMemSvg] = useState("");
  const renderSeq = useRef(0);
  // The memory-flow diagram (06-memory.mmd) is embedded at the top of the Memory view too.
  const memIdx = diagrams.findIndex((d) => d.slug.startsWith("06"));

  // Render the active diagram whenever it changes. Mermaid.render() returns an SVG string we drop
  // in with dangerouslySetInnerHTML — a unique id per render avoids Mermaid's internal id clashes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(""); setSvg("");
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false, securityLevel: "loose", theme: "base",
          themeVariables: { fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif", fontSize: "14px" },
        });
        const id = `mmd-${++renderSeq.current}`;
        const out = await mermaid.render(id, diagrams[active].code);
        if (!cancelled) setSvg(out.svg);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message ?? String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [active, diagrams]);

  // Render the memory diagram once, the first time the Memory view opens (cached after that).
  useEffect(() => {
    if (view !== "memory" || memIdx < 0 || memSvg) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false, securityLevel: "loose", theme: "base",
          themeVariables: { fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif", fontSize: "14px" },
        });
        const out = await mermaid.render(`mmd-mem-${++renderSeq.current}`, diagrams[memIdx].code);
        if (!cancelled) setMemSvg(out.svg);
      } catch { /* the live tables below still render */ }
    })();
    return () => { cancelled = true; };
  }, [view, memIdx, memSvg, diagrams]);

  const download = () => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${diagrams[active].slug}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const fmt = (ms: number) => (ms ? new Date(ms).toLocaleString() : "—");

  return (
    <main className="p-6 font-sans max-w-6xl mx-auto">
      <div className="flex items-baseline gap-3 mb-3">
        <h1 className="text-2xl font-bold">Architecture</h1>
        <span className="text-xs text-gray-400">flow diagrams + the prompt behind every agent · reload to refresh</span>
      </div>

      {/* Top-level view toggle: the flow (what happens) · the prompts (what each LLM is told) ·
          memory (the 8c flow diagram + the LIVE per-user memory state behind it) */}
      <div className="flex gap-2 mb-4">
        {(["diagrams", "prompts", "memory"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border ${view === v ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
          >
            {v === "diagrams" ? "Flow diagrams" : v === "prompts" ? "Agent prompts" : "Memory"}
          </button>
        ))}
      </div>

      {/* Honest staleness nudge: the diagram is authored, not auto-generated, so it can lag the code. */}
      {staleInfo.stale ? (
        <div className="mb-4 text-sm rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
          ⚠️ Source code changed <b>after</b> the diagrams were last updated (code: {fmt(staleInfo.srcAt)} · diagram: {fmt(staleInfo.mmdAt)}).
          The flow may be out of date — regenerate the <code>.mmd</code> and reload.
        </div>
      ) : (
        <div className="mb-4 text-sm rounded border border-green-300 bg-green-50 text-green-900 px-3 py-2">
          ✓ Diagrams are at least as new as the source code (updated {fmt(staleInfo.mmdAt)}).
        </div>
      )}

      {view === "diagrams" && (
        <>
          {/* Tabs — one per diagram */}
          <div className="flex flex-wrap gap-2 mb-3">
            {diagrams.map((d, i) => (
              <button
                key={d.slug}
                onClick={() => { setActive(i); setZoom(1); }}
                className={`px-3 py-1.5 rounded text-sm border ${i === active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
              >
                {d.title}
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-2 text-sm">
            <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} className="px-2 py-1 border rounded hover:bg-gray-50">–</button>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, z + 0.15))} className="px-2 py-1 border rounded hover:bg-gray-50">+</button>
            <button onClick={() => setZoom(1)} className="px-2 py-1 border rounded hover:bg-gray-50">reset</button>
            <button onClick={download} disabled={!svg} className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40">download .svg</button>
          </div>

          {/* Diagram surface */}
          <div className="border rounded-lg bg-white overflow-auto" style={{ maxHeight: "78vh" }}>
            {err ? (
              <pre className="p-4 text-sm text-red-700 whitespace-pre-wrap">{`Mermaid error:\n${err}`}</pre>
            ) : !svg ? (
              <div className="p-8 text-gray-400 text-sm">rendering…</div>
            ) : (
              <div
                style={{ transform: `scale(${zoom})`, transformOrigin: "top center", width: "fit-content", margin: "0 auto", padding: 16 }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            )}
          </div>
        </>
      )}

      {view === "memory" && (
        <div className="space-y-6">
          {/* 1 · The flow: how memory moves through a turn (same diagram as docs/mermaid/06-memory.mmd) */}
          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold mb-1">How memory flows (Phase 8c)</h2>
              <a href="/memory-explained.html" target="_blank" className="text-sm text-indigo-600 hover:underline">▶ interactive explainer</a>
            </div>
            <p className="text-sm text-gray-500 mb-2">
              Three types kept distinct — <b>WORKING</b> (this thread&apos;s gather, <code>threads.pending</code>) ·{" "}
              <b>BEHAVIORAL</b> (observed facts, low trust until confirmed) · <b>PROCEDURAL</b> (confirmed defaults).
              The rule: memory only <b>proposes</b>; anything that changes a rate/number/eligibility is shown + confirmed first.
            </p>
            <div className="border rounded-lg bg-white overflow-auto" style={{ maxHeight: "60vh" }}>
              {memSvg ? (
                <div style={{ width: "fit-content", margin: "0 auto", padding: 16 }} dangerouslySetInnerHTML={{ __html: memSvg }} />
              ) : (
                <div className="p-8 text-gray-400 text-sm">rendering…</div>
              )}
            </div>
          </section>

          {/* 2 · Memory in action: the LIVE rows behind that diagram, straight from Supabase */}
          <section>
            <h2 className="text-lg font-semibold mb-1">Memory in action (live)</h2>
            <p className="text-sm text-gray-500 mb-3">
              Every signed-up user with what the agent currently remembers. <b>eff</b> = post-decay confidence
              (the number the agent actually acts on; proposals stop below 0.25). Reload the page to refresh.
            </p>
            {memory.error && (
              <div className="mb-3 text-sm rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2">
                Could not load live memory: {memory.error}
              </div>
            )}
            {memory.users.length === 0 && !memory.error && (
              <p className="text-sm text-gray-400">No signed-up users yet — sign in on the chat page and ask something.</p>
            )}
            <div className="space-y-4">
              {memory.users.map((u) => (
                <div key={u.user_id} className="border rounded-lg bg-white p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                    <span className="font-semibold text-gray-900">{u.email}</span>
                    <span className="text-xs text-gray-500">sells: {u.sells ?? "—"} · state: {u.state ?? "—"}</span>
                    <code className="text-[10px] text-gray-400">{u.user_id}</code>
                  </div>

                  {u.facts.length === 0 ? (
                    <p className="text-xs text-gray-400">no durable facts yet</p>
                  ) : (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="py-1 pr-3">kind</th>
                          <th className="py-1 pr-3">fact</th>
                          <th className="py-1 pr-3">value</th>
                          <th className="py-1 pr-3">stored</th>
                          <th className="py-1 pr-3">eff</th>
                          <th className="py-1 pr-3">as of</th>
                          <th className="py-1 pr-3">confirmed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {u.facts.map((f) => (
                          <tr key={f.fact} className="border-b last:border-0">
                            <td className="py-1 pr-3">
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${f.kind === "default" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
                                {f.kind}
                              </span>
                            </td>
                            <td className="py-1 pr-3 font-mono">{f.fact}</td>
                            <td className="py-1 pr-3">{f.value}</td>
                            <td className="py-1 pr-3 tabular-nums">{f.confidence.toFixed(2)}</td>
                            <td className={`py-1 pr-3 tabular-nums ${f.effective < 0.25 ? "text-amber-600 font-semibold" : ""}`}>
                              {f.effective.toFixed(2)}{f.effective < 0.25 ? " (stale — re-asked)" : ""}
                            </td>
                            <td className="py-1 pr-3">{f.as_of}</td>
                            <td className="py-1 pr-3">{f.last_confirmed ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {u.pendings.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-gray-600 mb-1">Working memory (threads with a gather in progress):</p>
                      {u.pendings.map((p) => (
                        <details key={p.thread_id} className="text-xs mb-1">
                          <summary className="cursor-pointer text-gray-700">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] mr-1.5 ${p.fresh ? "bg-cyan-100 text-cyan-800" : "bg-gray-100 text-gray-500"}`}>
                              {p.fresh ? "fresh" : "expired"}
                            </span>
                            {p.title || p.thread_id}
                          </summary>
                          <pre className="mt-1 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-48">{JSON.stringify(p.pending, null, 2)}</pre>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {view === "prompts" && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Every LLM call in the online flow (an <b>agent</b>) and the prompt it runs. Deterministic FUNCTIONs (router, gates, calculators, the ASK-question builder) use no prompt — see the flow diagrams.
          </p>
          {prompts.map((p) => (
            <div key={p.name} className="border rounded-lg bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
                <span className="font-semibold text-gray-900">{p.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${p.model === "Configured main model" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>{p.model}</span>
                <span className="text-xs text-gray-500">{p.stage}</span>
                <code className="text-xs text-indigo-600">{p.file}</code>
              </div>
              <div className="text-sm text-gray-600 mb-2">{p.purpose}</div>
              <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 whitespace-pre-wrap overflow-auto max-h-72 text-gray-800">{p.prompt}</pre>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
