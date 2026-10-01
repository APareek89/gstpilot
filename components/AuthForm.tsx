"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Scale, ShieldCheck } from "lucide-react";
import { authForm, useAccount } from "./AccountShell";

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const account = useAccount();
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    let ticket = account.identity.capture();
    const current = () => mounted.current && account.identity.current(ticket);
    try {
      if (signup) {
        if (password.length < 12 || new TextEncoder().encode(password).length > 72) throw new Error("Use at least 12 characters and no more than 72 bytes for your password.");
        const session = account.session ?? await account.refresh();
        if (!current()) return;
        if (!session?.csrf) throw new Error("Account service is unavailable. Please retry.");
        const response = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, csrf: session.csrf }) });
        const result = await response.json().catch(() => null);
        if (!current()) return;
        if (!response.ok) throw new Error(result?.code === "account_exists" || response.status === 409 ? "An account already exists. Sign in to continue." : response.status === 429 ? "Too many account requests. Please wait and try again." : "Account could not be created. Check your details and try again.");
      }
      if (!current()) return;
      await authForm("callback/credentials", { email, password }, () => current());
      if (!current()) return;
      account.invalidate();
      ticket = account.identity.capture();
      const next = await account.refresh();
      if (!mounted.current) return;
      if (!next?.user) { if (!current()) return; throw new Error("Sign in was not completed. Please try again."); }
      if (account.identity.owner !== next.user.id || next.user.email.toLowerCase() !== email.trim().toLowerCase()) return;
      ticket = account.identity.capture();
      setPassword(""); try { localStorage.setItem("gstpilot-account-change", String(Date.now())); } catch {}
      window.location.replace("/");
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : "Account request failed."); }
    finally { if (current()) setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-aside"><Scale size={32} /><span className="eyebrow">GSTPILOT</span><h1>Understand your filing facts.</h1><p>Ask GST questions, inspect the supporting sources and check a historical filing calculation.</p><div className="row small"><ShieldCheck size={18} />Your conversations and business details stay in your account.</div></section>
    <section className="auth-panel"><h2>{signup ? "Create your account" : "Welcome back"}</h2><p className="muted">{signup ? "Start with a free historical example or your own filing facts." : "Sign in to your GSTPilot workspace."}</p>
      <form onSubmit={submit} className="stack"><div className="field"><label className="label" htmlFor="account-email">Email</label><input id="account-email" className="input" type="email" autoComplete="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="field"><label className="label" htmlFor="account-password">Password</label><input id="account-password" className="input" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} />{signup && <p className="muted small">At least 12 characters. Password recovery is not available yet.</p>}</div>
      {error && <div className="alert danger" role="alert">{error}</div>}<button className="btn primary" disabled={busy || account.loading} aria-busy={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
      <button className="btn" type="button" disabled>Google · Not configured</button></form>
      <p className="small">{signup ? "Already have an account? " : "New to GSTPilot? "}<Link className="text-link" href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link></p>
    </section>
  </main>;
}
