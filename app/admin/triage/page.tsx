// Phase 8 flywheel — the triage review queue. Every 👎 becomes a candidate golden case: Haiku
// PRE-DRAFTS the labels (a typing speed-up), then ⚠️ Anand corrects and approves EACH field,
// because these labels feed zero-tolerance gates — a wrong "expected fact" would teach CI to
// enforce a wrong answer. Approval appends the case to the golden set and bumps its version.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRequests } from "@/components/AccountShell";
import { INTENTS } from "@/evals/golden-schema";

type Item = {
  messageId: string; traceId: string | null; reason: string; answer: string;
  createdAt: string; question: string; alreadyCaptured: boolean;
};
type Labels = {
  question: string; expected_intent: string; expected_tier: string; unanswerable: boolean;
  relevant_chunk_ids: string[]; expected_answer_facts: string[]; must_not_contain: string[];
};

export default function TriagePage() {
  const requests = useRequests(); const operation = useRef(0);
  const [error, setError] = useState(""); const [approving, setApproving] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [version, setVersion] = useState("");
  const [host, setHost] = useState("https://cloud.langfuse.com");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ labels: Labels; retrievedIds: string[] } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saved, setSaved] = useState<Record<string, { id: string; version: string }>>({});

  async function load() {
    const d = await requests.request<{items: Item[]; goldenVersion:string; langfuseHost:string; langfuseProjectId:string|null}>("/api/triage");
    if (d) { setItems(d.items ?? []); setVersion(d.goldenVersion ?? "?"); setHost(d.langfuseHost ?? host); setProjectId(d.langfuseProjectId ?? null); }
  }
  useEffect(() => { const ticket = requests.capture(); void load().catch(() => { if (requests.current(ticket)) setError('Triage could not be loaded. Reload to retry.'); }); }, []);
  async function predraft(it: Item) {
    const ticket = requests.capture(); const serial = ++operation.current; setOpenId(it.messageId); setDraft(null); setDrafting(true); setError('');
    try { const d = await requests.request<{labels:Labels;retrievedIds:string[]}>('/api/triage', 'POST', {action:'predraft',question:it.question,reason:it.reason});
      if (d && serial === operation.current) setDraft({labels:d.labels,retrievedIds:d.retrievedIds ?? []});
    } catch (e) { if (requests.current(ticket) && serial === operation.current) setError(e instanceof Error ? e.message : 'Draft was not completed.'); }
    finally { if (requests.current(ticket) && serial === operation.current) setDrafting(false); }
  }
  async function approve(it: Item) {
    if (!draft || approving) return; const ticket = requests.capture(); const serial = operation.current; setApproving(true); setError('');
    try { const d = await requests.request<{ok:boolean;id:string;version:string;problems?:string[]}>('/api/triage','POST',{action:'approve',labels:draft.labels,sourceTraceId:it.traceId});
      if (d && requests.current(ticket) && serial === operation.current) { if (d.ok) { setSaved(s => ({...s,[it.messageId]:{id:d.id,version:d.version}})); setVersion(d.version); setOpenId(null); setDraft(null); } else setError('Please correct the draft: '+(d.problems ?? []).join('; ')); }
    } catch (e) { if (requests.current(ticket) && serial === operation.current) setError(e instanceof Error ? e.message : 'Draft was not saved.'); }
    finally { if (requests.current(ticket)) setApproving(false); }
  }

  const setL = (patch: Partial<Labels>) => setDraft((dd) => (dd ? { ...dd, labels: { ...dd.labels, ...patch } } : dd));
  const toggleChunk = (id: string) => draft && setL({
    relevant_chunk_ids: draft.labels.relevant_chunk_ids.includes(id)
      ? draft.labels.relevant_chunk_ids.filter((x) => x !== id)
      : [...draft.labels.relevant_chunk_ids, id],
  });

  return (
    <main className="max-w-4xl mx-auto p-8 font-sans text-sm text-ink">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-bold">Triage → Golden</h1>
        <span className="text-xs text-muted">golden set <span className="font-mono">v{version}</span></span>
      </div>
      <p className="text-muted mb-4 max-w-2xl">
        Review feedback from your conversations. Drafting labels uses the configured provider.
        Correct every field before adding an approved case to your evaluation set.
      </p>
      <div className="mb-6 rounded-lg border border-amber/30 bg-amber-soft/60 px-3 py-2 text-xs text-amber">
        ⚠️ You verify every field. The pre-draft is a speed-up, never the truth — these labels feed
        zero-tolerance gates, so a wrong fact or chunk-id would make CI enforce a <em>wrong</em> answer.
      </div>

      {error && <p className="alert danger mb-4" role="alert">{error}</p>}
      {items.length === 0 && <p className="text-muted">No 👎 yet. They appear here the moment a user thumbs-down an answer.</p>}

      <div className="space-y-4">
        {items.map((it) => {
          const done = saved[it.messageId];
          return (
            <div key={it.messageId} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-xs text-muted mb-2">
                <span>{new Date(it.createdAt).toLocaleString()}</span>
                <span className="px-1.5 py-0.5 rounded bg-rust-soft text-rust">👎 {it.reason || "—"}</span>
                {it.traceId && <a target="_blank" href={projectId ? `${host}/project/${projectId}/traces/${it.traceId}` : `${host}/traces/${it.traceId}`} className="text-brand hover:underline">langfuse ↗</a>}
                {(it.alreadyCaptured || done) && <span className="ml-auto px-1.5 py-0.5 rounded bg-brand-soft text-brand-ink">in golden{done ? ` · ${done.id}` : ""}</span>}
              </div>
              <p className="font-medium">Q: {it.question || <span className="text-muted italic">(no question found)</span>}</p>
              <p className="text-muted mt-1 line-clamp-3 whitespace-pre-wrap">A: {it.answer}…</p>

              {!it.alreadyCaptured && !done && (
                <div className="mt-3">
                  {openId !== it.messageId ? (
                    <button disabled={drafting || approving || !it.question} onClick={() => void predraft(it)} className="rounded-lg bg-[var(--bg-accent)] text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-ink disabled:opacity-40">
                      Draft golden labels →
                    </button>
                  ) : drafting ? (
                    <p className="text-muted text-xs animate-pulse">Drafting labels…</p>
                  ) : draft ? (
                    <div className="rounded-lg border border-line bg-paper/60 p-3 space-y-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted">Review &amp; correct — every field is yours</p>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs">intent
                          <select value={draft.labels.expected_intent} onChange={(e) => setL({ expected_intent: e.target.value })} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1">
                            {INTENTS.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        </label>
                        <label className="text-xs">tier
                          <select value={draft.labels.expected_tier} onChange={(e) => setL({ expected_tier: e.target.value })} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1">
                            {["T1", "T2", "T3"].map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="text-xs flex items-center gap-2">
                        <input type="checkbox" checked={draft.labels.unanswerable} onChange={(e) => setL({ unanswerable: e.target.checked, relevant_chunk_ids: e.target.checked ? [] : draft.labels.relevant_chunk_ids })} />
                        unanswerable (correct behaviour is abstention — no chunk ids)
                      </label>
                      {!draft.labels.unanswerable && (
                        <div className="text-xs">
                          <p className="text-muted mb-1">relevant chunk ids — pick the ones that SHOULD answer it (from what retrieval returned):</p>
                          <div className="flex flex-wrap gap-1.5">
                            {draft.retrievedIds.map((id) => (
                              <button key={id} onClick={() => toggleChunk(id)}
                                className={`font-mono text-[11px] px-1.5 py-0.5 rounded border ${draft.labels.relevant_chunk_ids.includes(id) ? "bg-[var(--bg-accent)] text-white border-brand" : "bg-surface border-line text-muted hover:border-brand"}`}>
                                {id}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <label className="text-xs block">expected facts (one per line — the exact numbers/dates/forms the answer MUST contain)
                        <textarea rows={3} value={draft.labels.expected_answer_facts.join("\n")} onChange={(e) => setL({ expected_answer_facts: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono" />
                      </label>
                      <label className="text-xs block">must-not-contain (one per line — strings that auto-fail the answer)
                        <textarea rows={2} value={draft.labels.must_not_contain.join("\n")} onChange={(e) => setL({ must_not_contain: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono" />
                      </label>
                      <div className="flex gap-2 pt-1">
                        <button disabled={drafting || approving} onClick={() => void approve(it)} className="rounded-lg bg-[var(--bg-accent)] text-white px-3 py-1.5 text-xs font-medium hover:bg-brand-ink">✓ Approve &amp; add to golden (verified)</button>
                        <button onClick={() => { setOpenId(null); setDraft(null); }} className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-ink">Cancel</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
