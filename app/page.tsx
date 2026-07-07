// GSTPilot chat — the product face. A thread of questions and cited answers.
// Citations render as expandable cards showing the EXACT legal text relied on: a quoted
// snippet builds more trust than a bare link because the user verifies the claim in place,
// without an act-of-faith click into a 200-page PDF. Every reply carries the tier, the
// information-not-advice line, and a CA button on T2/T3. Feedback: 👍 / 👎 + one reason.

"use client";

import { useRef, useState } from "react";

type Citation = { id: string; heading: string; snippet: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  tier?: string;
  citations?: Citation[];
  messageId?: string;
  escalated?: boolean;
  feedback?: "up" | "down";
};

const STEP_LABELS: Record<string, string> = {
  intake: "samajh rahe hain…", "G1-schema": "risk check…", retrieval: "kanoon dhoond rahe hain…",
  "G2-retrieval-floor": "relevance check…", resolution: "jawab ban raha hai…",
  "G4-citations": "citations verify…", "G3-recompute": "numbers verify…",
  "reply-synthesis": "final touch…", "G5-claim-check": "final check…", "ca-handoff": "CA handoff…",
};

export default function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const threadRef = useRef<string | null>(null);

  async function ask() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: q }]);

    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, threadId: threadRef.current }),
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
    <main className="max-w-3xl mx-auto p-6 font-sans flex flex-col min-h-screen">
      <header className="mb-4">
        <h1 className="text-xl font-bold">GSTPilot</h1>
        <p className="text-xs text-gray-500">GST ke sawaal, kanoon ke citations ke saath · This is information, not professional advice.</p>
      </header>

      <div className="flex-1 space-y-4">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block text-left rounded-lg px-4 py-3 text-sm whitespace-pre-wrap max-w-[92%] ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}>
              {m.tier && (
                <div className="mb-1 text-[10px] font-semibold text-gray-500">
                  {m.tier}{m.escalated ? " · escalated" : ""}
                </div>
              )}
              {m.content}
              {m.citations && m.citations.length > 0 && (
                <div className="mt-3 space-y-1">
                  {m.citations.map((c) => (
                    <details key={c.id} className="bg-white border rounded p-2">
                      <summary className="cursor-pointer text-xs font-mono text-indigo-700">
                        {c.id} <span className="text-gray-400 font-sans">· {c.heading}</span>
                      </summary>
                      <p className="text-xs text-gray-600 mt-1 italic">“{c.snippet}…”</p>
                      <a href={`/admin/chunks/${encodeURIComponent(c.id)}`} className="text-xs text-indigo-600 hover:underline" target="_blank">full text →</a>
                    </details>
                  ))}
                </div>
              )}
              {m.role === "assistant" && (m.tier === "T2" || m.tier === "T3") && (
                <div className="mt-2">
                  <a href="mailto:?subject=GST%20question%20—%20CA%20consult" className="text-xs bg-amber-100 border border-amber-300 rounded px-2 py-1 inline-block">
                    🧑‍💼 Talk to a CA
                  </a>
                </div>
              )}
              {m.role === "assistant" && m.messageId && (
                <div className="mt-2 text-xs">
                  {m.feedback ? (
                    <span className="text-gray-400">feedback recorded ✓</span>
                  ) : (
                    <span className="space-x-2">
                      <button onClick={() => sendFeedback(i, "up")} className="hover:scale-110">👍</button>
                      <button onClick={() => sendFeedback(i, "down", "wrong")} className="hover:opacity-70">👎 galat</button>
                      <button onClick={() => sendFeedback(i, "down", "unclear")} className="hover:opacity-70">👎 samajh nahi aaya</button>
                      <button onClick={() => sendFeedback(i, "down", "didnt_answer")} className="hover:opacity-70">👎 jawab nahi mila</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-gray-400 animate-pulse">⏳ {status || "shuru kar rahe hain…"}</div>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="mt-4 flex gap-2 sticky bottom-4">
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. footwear ka GST rate kya hai?"
          className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white shadow"
        />
        <button disabled={busy} className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">
          poocho
        </button>
      </form>
    </main>
  );
}
