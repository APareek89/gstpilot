// GSTPilot chat — the product face. A thread of questions and cited answers.
// Citations render as expandable cards showing the EXACT legal text relied on: a quoted
// snippet builds more trust than a bare link because the user verifies the claim in place,
// without an act-of-faith click into a 200-page PDF. Every reply carries a risk-tier badge,
// the information-not-advice line, and a CA button on T2/T3. Feedback: 👍 / 👎 + one reason —
// and (Phase 8) every 👎 is the raw material of a new golden test case.

"use client";

import { useEffect, useRef, useState } from "react";

type Citation = { id: string; heading: string; snippet: string };
// The signed-in user, mirrored in localStorage("gstpilot_user"). Email is the whole identity
// (learning build — no password; see /api/user for the ⚠️ magic-link human task). sells/state
// are the ONLY two facts we ask upfront; everything else the agent learns from conversation.
type User = { user_id: string; email: string; sells: string | null; state: string | null };
type Msg = {
  role: "user" | "assistant";
  content: string;
  tier?: string;
  citations?: Citation[];
  messageId?: string;
  escalated?: boolean;
  feedback?: "up" | "down";
};

// Hinglish narration for each pipeline step the SSE stream reports — so the wait feels like
// the agent working through the law, not a spinner.
const STEP_LABELS: Record<string, string> = {
  intake: "samajh rahe hain…", "G1-schema": "risk check…", router: "sahi raasta chun rahe hain…",
  "lane:calculation": "hisaab laga rahe hain…", "lane:rate_lookup": "rate table dekh rahe hain…",
  "lane:change_over_time": "timeline bana rahe hain…", "lane:guidance": "practical tareeka bata rahe hain…",
  clarify: "ek detail chahiye…",
  retrieval: "kanoon dhoond rahe hain…",
  "G2-retrieval-floor": "relevance check…", resolution: "jawab ban raha hai…",
  "G4-citations": "citations verify…", "G3-recompute": "numbers verify…",
  "reply-synthesis": "final touch…", "G5-claim-check": "final check…", "ca-handoff": "CA handoff…",
};

// One-tap starters that show the breadth (rate · e-commerce · refund · late fee · movement).
const EXAMPLES = [
  "footwear ka GST rate kya hai?",
  "Amazon pe bechta hu, TCS kitna katega?",
  "how do i get a GST refund?",
  "GSTR-3B late file karne pe late fee?",
  "e-way bill kab zaroori hota hai?",
];

// Tier → plain-language meaning + accent. Colour carries the risk: calm teal, caution amber,
// escalate rust.
const TIER: Record<string, { label: string; cls: string }> = {
  T1: { label: "general info", cls: "bg-brand-soft text-brand-ink" },
  T2: { label: "your money / deadline", cls: "bg-amber-soft text-amber" },
  T3: { label: "escalated to a CA", cls: "bg-rust-soft text-rust" },
};

export default function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // null = checking localStorage; false = not signed in (show the gate); User = signed in.
  const [user, setUser] = useState<User | null | false>(null);
  const threadRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Recognise a returning user from localStorage — this is what makes session 2 "warm".
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gstpilot_user");
      setUser(raw ? (JSON.parse(raw) as User) : false);
    } catch { setUser(false); }
  }, []);

  function saveUser(u: User) {
    localStorage.setItem("gstpilot_user", JSON.stringify(u));
    setUser(u);
  }

  // keep the newest turn in view as the thread grows / status ticks
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, status]);

  // ask() drives one question→answer turn over the SSE stream. Accepts an override so the
  // example chips can submit directly (React state updates are async — reading `input` after
  // setInput would race).
  async function ask(override?: string) {
    const q = (override ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setStatus("");
    setMsgs((m) => [...m, { role: "user", content: q }]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, threadId: threadRef.current, userId: user ? user.user_id : undefined }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const line of buf.split("\n\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "thread") threadRef.current = ev.threadId;
            if (ev.type === "status") setStatus(STEP_LABELS[ev.name] ?? ev.name);
            if (ev.type === "answer")
              setMsgs((m) => [...m, { role: "assistant", content: ev.reply, tier: ev.tier, citations: ev.citations, messageId: ev.messageId, escalated: ev.escalated }]);
            if (ev.type === "error")
              setMsgs((m) => [...m, { role: "assistant", content: "Kuch galat ho gaya — dobara try karein. (" + ev.message + ")" }]);
          } catch { /* partial frame — wait for more bytes */ }
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Network hiccup — dobara try karein." }]);
    }
    setStatus("");
    setBusy(false);
  }

  async function sendFeedback(i: number, verdict: "up" | "down", reason?: string) {
    const msg = msgs[i];
    if (!msg.messageId) return;
    setMsgs((m) => m.map((x, j) => (j === i ? { ...x, feedback: verdict } : x)));
    await fetch("/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: msg.messageId, verdict, reason }),
    });
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      {/* header — serif wordmark for authority, quiet admin link */}
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-[22px] leading-none font-semibold text-brand tracking-tight">GSTPilot</span>
            <span className="hidden sm:inline text-xs text-muted">GST answers, with the law attached</span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <>
                <span className="hidden sm:inline text-xs text-muted" title="Signed in (email-only, learning build)">{user.email}</span>
                <a href="/memory" className="text-xs text-brand hover:underline" title="Jo GSTPilot ko aapke baare mein yaad hai — dekhein, sudhaarein, ya delete karein">Memory</a>
              </>
            )}
            <a href="/admin/conversations" className="text-xs text-muted hover:text-ink transition-colors">Admin</a>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="max-w-3xl mx-auto px-5 py-6">
          {user === null ? null : user === false ? (
            <SignInCard onSignedIn={saveUser} />
          ) : !user.sells || !user.state ? (
            <OnboardingCard user={user} onDone={saveUser} />
          ) : msgs.length === 0 ? (
            <EmptyState onPick={(q) => ask(q)} />
          ) : (
            <div className="space-y-5">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "user" ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-soft px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </div>
                  ) : (
                    <div className="max-w-[94%] w-full rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      {m.tier && (
                        <span className={`inline-flex items-center text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full mb-2 ${TIER[m.tier]?.cls ?? "bg-line text-muted"}`}>
                          {m.tier} · {TIER[m.tier]?.label ?? ""}{m.escalated ? " ↗" : ""}
                        </span>
                      )}
                      <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink/90">{m.content}</div>

                      {m.citations && m.citations.length > 0 && (
                        <div className="mt-3.5 space-y-1.5">
                          <p className="text-[11px] uppercase tracking-wide text-muted">Sources</p>
                          {m.citations.map((c) => (
                            <details key={c.id} className="group rounded-lg border border-line bg-paper/50 open:bg-surface transition-colors">
                              <summary className="cursor-pointer list-none px-3 py-2 flex items-center gap-2">
                                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-brand-soft text-brand-ink">{c.id}</span>
                                <span className="text-xs text-muted truncate">{c.heading}</span>
                                <span className="ml-auto text-muted text-xs transition-transform group-open:rotate-90">›</span>
                              </summary>
                              <div className="px-3 pb-3">
                                <blockquote className="border-l-2 border-brand/40 pl-3 text-[13px] leading-relaxed text-ink/75 italic">“{c.snippet}…”</blockquote>
                                <a href={`/admin/chunks/${encodeURIComponent(c.id)}`} target="_blank" className="mt-2 inline-block text-xs text-brand hover:underline">Read the full section →</a>
                              </div>
                            </details>
                          ))}
                        </div>
                      )}

                      {(m.tier === "T2" || m.tier === "T3") && (
                        <a href="mailto:?subject=GST%20question%20—%20CA%20consult" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber bg-amber-soft border border-amber/25 rounded-lg px-3 py-1.5 hover:bg-amber-soft/70 transition-colors">
                          🧑‍💼 Talk to a CA
                        </a>
                      )}

                      {m.messageId && (
                        <div className="mt-3 pt-2.5 border-t border-line flex items-center gap-3 text-xs">
                          {m.feedback ? (
                            <span className="text-muted">{m.feedback === "up" ? "Thanks — glad it helped ✓" : "Thanks — noted, we’ll learn from it ✓"}</span>
                          ) : (
                            <>
                              <span className="text-muted">Helpful?</span>
                              <button onClick={() => sendFeedback(i, "up")} className="hover:scale-110 transition-transform" title="Yes">👍</button>
                              <span className="text-line">·</span>
                              <button onClick={() => sendFeedback(i, "down", "wrong")} className="text-muted hover:text-rust transition-colors">galat</button>
                              <button onClick={() => sendFeedback(i, "down", "unclear")} className="text-muted hover:text-rust transition-colors">samajh nahi aaya</button>
                              <button onClick={() => sendFeedback(i, "down", "didnt_answer")} className="text-muted hover:text-rust transition-colors">jawab nahi mila</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-2.5 text-sm text-muted pl-1">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-bounce" />
                  </span>
                  <span>{status || "shuru kar rahe hain…"}</span>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </main>

      {/* composer — sticky, with the standing disclaimer beneath */}
      <div className="sticky bottom-0 border-t border-line bg-paper/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-5 py-3">
          <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Apna GST sawaal likhein…"
              className="flex-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
            />
            <button
              disabled={busy || !input.trim() || !user || !user.sells || !user.state}
              className="rounded-xl bg-brand text-white px-5 py-2.5 text-sm font-medium hover:bg-brand-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Poochho
            </button>
          </form>
          <p className="mt-2 text-[11px] text-muted text-center">
            Information, not professional advice. Notices, penalties &amp; disputes go to a Chartered Accountant.
          </p>
        </div>
      </div>
    </div>
  );
}

// SignInCard — email-only entry. One field, no password: the email IS the identity in this
// learning build. A returning email gets its old profile back (that's the whole point of
// memory); a new one goes to the two-question onboarding.
function SignInCard({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/user", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Kuch galat ho gaya."); setBusy(false); return; }
      onSignedIn(j as User);
    } catch { setErr("Network hiccup — dobara try karein."); setBusy(false); }
  }

  return (
    <div className="py-14 max-w-sm mx-auto text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-brand text-white grid place-items-center font-serif text-xl shadow-sm">G</div>
      <h2 className="mt-4 font-serif text-2xl text-ink">Apna email batayein</h2>
      <p className="mt-2 text-sm text-muted leading-relaxed">
        GSTPilot aapko yaad rakhega — dobara aane pe wahi sawaal phir se nahi poochhega.
      </p>
      <form onSubmit={submit} className="mt-6 flex gap-2">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aap@business.com"
          className="flex-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
        />
        <button disabled={busy || !email.trim()} className="rounded-xl bg-brand text-white px-5 py-2.5 text-sm font-medium hover:bg-brand-ink disabled:opacity-40 transition-colors">
          Chalo
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-rust">{err}</p>}
      <p className="mt-4 text-[11px] text-muted">Email hi login hai — koi password nahi. (Learning build: real sign-in aayega.)</p>
    </div>
  );
}

// OnboardingCard — exactly TWO questions, then never again: what do you sell, which state.
// Everything else (platforms, turnover band, filing habits) the agent LEARNS from conversation
// — asking a long form upfront is exactly the cold-stranger experience memory exists to kill.
function OnboardingCard({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  const [sells, setSells] = useState(user.sells ?? "");
  const [state, setState] = useState(user.state ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.user_id, sells, state }),
      });
      const j = await res.json();
      if (res.ok) onDone(j as User);
    } finally { setBusy(false); }
  }

  return (
    <div className="py-14 max-w-sm mx-auto text-center">
      <h2 className="font-serif text-2xl text-ink">Do chhote sawaal</h2>
      <p className="mt-2 text-sm text-muted leading-relaxed">Bas itna — baaki main baat-cheet se seekh lunga.</p>
      <form onSubmit={submit} className="mt-6 space-y-3 text-left">
        <label className="block">
          <span className="text-xs text-muted">Aap kya bechte hain?</span>
          <input value={sells} onChange={(e) => setSells(e.target.value)} placeholder="e.g. footwear, sarees, electronics"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Kaunse state mein hain?</span>
          <input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Maharashtra"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition" />
        </label>
        <button disabled={busy || !sells.trim() || !state.trim()} className="w-full rounded-xl bg-brand text-white px-5 py-2.5 text-sm font-medium hover:bg-brand-ink disabled:opacity-40 transition-colors">
          Shuru karein
        </button>
      </form>
    </div>
  );
}

// First-run canvas: a warm welcome + one-tap example questions. The chips double as a demo of
// what GSTPilot covers, so an empty thread never feels like a dead end.
function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-brand text-white grid place-items-center font-serif text-xl shadow-sm">G</div>
      <h2 className="mt-4 font-serif text-2xl text-ink">GST ke sawaal, kanoon ke saath.</h2>
      <p className="mt-2 text-sm text-muted max-w-md mx-auto leading-relaxed">
        Rates, registration, refunds, ITC, e-way bills — har jawaab ke saath exact section ya notification.
        Sure na ho to seedha bol deta hai; disputes CA ko bhej deta hai.
      </p>
      <div className="mt-7 flex flex-wrap gap-2 justify-center">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="text-xs text-ink/80 border border-line rounded-full px-3.5 py-1.5 bg-surface hover:border-brand hover:text-brand transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
