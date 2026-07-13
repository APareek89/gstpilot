// "WHAT I REMEMBER" — the user-facing memory panel. Control builds trust: everything the agent
// has learned is visible here with WHEN it was learned (as-of), HOW MUCH it's trusted (the
// post-decay confidence the agent actually acts on), and two controls — correct it (an edit is
// the strongest confirmation) or delete it (gone means gone; the agent re-learns only if you
// say it again). Facts split by kind: behavioral (learned about your business) vs defaults
// (shortcuts you confirmed, e.g. "late fee = monthly GSTR-3B").

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type User = { user_id: string; email: string; sells: string | null; state: string | null };
type Fact = {
  id: string; fact: string; value: string; kind: "behavioral" | "default";
  as_of: string; last_confirmed: string | null; effective_confidence: number; stale: boolean;
};

// Human labels for the closed fact vocabulary — the panel speaks seller, not schema.
const FACT_LABELS: Record<string, string> = {
  sells: "Aap kya bechte hain", state: "State", platforms: "Kahan bechte hain",
  turnover_band: "Turnover (approx)", filing_frequency: "Returns kitni baar",
};
function factLabel(fact: string): string {
  if (FACT_LABELS[fact]) return FACT_LABELS[fact];
  if (fact.startsWith("observation:")) return `Note: ${fact.slice(12).replace(/-/g, " ")}`;
  if (fact.startsWith("default:")) return `Shortcut: ${fact.slice(8).replace(/\./g, " → ").replace(/_/g, " ")}`;
  return fact;
}

export default function MemoryPage() {
  const [user, setUser] = useState<User | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [profile, setProfile] = useState<{ sells: string; state: string }>({ sells: "", state: "" });
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem("gstpilot_user");
    if (!raw) { setLoaded(true); return; }
    const u = JSON.parse(raw) as User;
    setUser(u);
    fetch(`/api/memory?userId=${u.user_id}`)
      .then((r) => r.json())
      .then((j) => {
        setFacts(j.facts ?? []);
        setProfile({ sells: j.profile?.sells ?? "", state: j.profile?.state ?? "" });
      })
      .finally(() => setLoaded(true));
  }, []);

  async function saveProfile() {
    if (!user) return;
    const res = await fetch("/api/user", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.user_id, sells: profile.sells, state: profile.state }),
    });
    if (res.ok) {
      const j = await res.json();
      localStorage.setItem("gstpilot_user", JSON.stringify(j));
      setUser(j);
    }
  }

  async function removeFact(id: string) {
    if (!user) return;
    setFacts((f) => f.filter((x) => x.id !== id));
    await fetch("/api/memory", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.user_id, id }),
    });
  }

  async function saveFact(id: string) {
    if (!user || !draft.trim()) return;
    setFacts((f) => f.map((x) => (x.id === id ? { ...x, value: draft.trim(), effective_confidence: 0.9, stale: false } : x)));
    setEditing(null);
    await fetch("/api/memory", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.user_id, id, value: draft.trim() }),
    });
  }

  const behavioral = facts.filter((f) => f.kind === "behavioral");
  const defaults = facts.filter((f) => f.kind === "default");

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/" className="font-serif text-[22px] leading-none font-semibold text-brand tracking-tight">GSTPilot</Link>
          <Link href="/" className="text-xs text-muted hover:text-ink transition-colors">← chat pe wapas</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        <h1 className="font-serif text-2xl">Jo mujhe yaad hai</h1>
        <p className="mt-1.5 text-sm text-muted leading-relaxed">
          Ye sab aapke jawaab behtar banane ke liye hai — koi bhi cheez galat ho to sudhaar dein, ya delete kar dein.
          Purani cheezein khud hi kam bharosemand ho jaati hain aur main dobara poochh leta hoon.
        </p>

        {!loaded ? null : !user ? (
          <p className="mt-8 text-sm text-muted">Pehle <Link className="text-brand hover:underline" href="/">sign in</Link> karein.</p>
        ) : (
          <div className="mt-7 space-y-8">
            {/* profile — the two onboarding answers, always editable */}
            <section>
              <h2 className="text-[11px] uppercase tracking-wide text-muted">Profile ({user.email})</h2>
              <div className="mt-2 rounded-xl border border-line bg-surface p-4 space-y-3">
                <label className="block">
                  <span className="text-xs text-muted">Aap kya bechte hain</span>
                  <input value={profile.sells} onChange={(e) => setProfile((p) => ({ ...p, sells: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-brand transition" />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">State</span>
                  <input value={profile.state} onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-brand transition" />
                </label>
                <button onClick={saveProfile} className="rounded-lg bg-brand text-white px-4 py-1.5 text-xs font-medium hover:bg-brand-ink transition-colors">Save</button>
              </div>
            </section>

            {/* learned facts + confirmed shortcuts */}
            {[{ title: "Baat-cheet se seekha", rows: behavioral, empty: "Abhi kuch nahi — jaise-jaise baat karenge, yahan dikhega." },
              { title: "Aapke confirm kiye shortcuts", rows: defaults, empty: "Jab aap koi assumption confirm karenge, wo yahan aa jayega." }].map((g) => (
              <section key={g.title}>
                <h2 className="text-[11px] uppercase tracking-wide text-muted">{g.title}</h2>
                {g.rows.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">{g.empty}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {g.rows.map((f) => (
                      <div key={f.id} className="rounded-xl border border-line bg-surface px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted">{factLabel(f.fact)}</p>
                          {editing === f.id ? (
                            <div className="mt-1 flex gap-2">
                              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                                className="flex-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-brand" />
                              <button onClick={() => saveFact(f.id)} className="text-xs text-brand font-medium">save</button>
                              <button onClick={() => setEditing(null)} className="text-xs text-muted">cancel</button>
                            </div>
                          ) : (
                            <p className="text-sm mt-0.5">{f.value}</p>
                          )}
                          <p className="mt-1 text-[11px] text-muted">
                            as of {f.as_of.slice(0, 10)}
                            {f.last_confirmed ? ` · confirmed ${f.last_confirmed.slice(0, 10)}` : " · unconfirmed"}
                            {f.stale && <span className="ml-1.5 text-amber">· purana — dobara poochhunga</span>}
                          </p>
                        </div>
                        {/* trust meter: the post-decay confidence the agent actually uses */}
                        <div className="w-16 shrink-0 pt-1" title={`confidence ${f.effective_confidence}`}>
                          <div className="h-1.5 rounded-full bg-line overflow-hidden">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(f.effective_confidence * 100)}%` }} />
                          </div>
                          <p className="mt-1 text-[10px] text-muted text-center">{Math.round(f.effective_confidence * 100)}%</p>
                        </div>
                        <div className="shrink-0 flex flex-col gap-1 pt-0.5">
                          <button onClick={() => { setEditing(f.id); setDraft(f.value); }} className="text-[11px] text-muted hover:text-brand transition-colors">edit</button>
                          <button onClick={() => removeFact(f.id)} className="text-[11px] text-muted hover:text-rust transition-colors">delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}

            <p className="text-[11px] text-muted leading-relaxed border-t border-line pt-4">
              Yaad rakhi hui koi bhi baat kabhi bhi seedha rate/amount/eligibility decide nahi karti —
              main pehle aapko dikhata hoon aur confirm karta hoon. (Learning build: consent &amp; data-handling policy pending.)
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
