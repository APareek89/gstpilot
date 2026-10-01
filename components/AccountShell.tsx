"use client";
// One session owner drives the header and all protected client surfaces.
// Full navigation after login/logout discards cached server views from another identity.
// Legacy email-only browser identity is removed, never adopted into a real account.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Scale, LogOut, Moon, Sun } from 'lucide-react';
import { Identity, StaleResponse, readProtected, protectedHeaders, type StreamEvent } from '@/lib/client/identity';
type Session = { user: { id: string; email: string } | null; csrf: string; mode: 'mock' | 'live' };
type Account = { session: Session | null; loading: boolean; error: string | null; identity: Identity; refresh: () => Promise<Session | null>; invalidate: () => void };
const Context = createContext<Account | null>(null);
export function useAccount() { const value = useContext(Context); if (!value) throw new Error('Account provider missing'); return value; }
export async function authForm(action: 'callback/credentials' | 'signout', fields: Record<string, string>, current: () => boolean) {
  const initial = await fetch('/api/auth/csrf', { cache: 'no-store' }); const csrf = await initial.json();
  if (!current()) throw new StaleResponse();
  if (!initial.ok || typeof csrf.csrfToken !== 'string') throw new Error('Account service unavailable. Please retry.');
  const response = await fetch(`/api/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' }, body: new URLSearchParams({ ...fields, csrfToken: csrf.csrfToken, callbackUrl: window.location.origin }) });
  const result = await response.json().catch(() => null);
  if (!current()) throw new StaleResponse();
  if (!response.ok || typeof result?.url !== 'string') throw new Error('Account request was not completed. Please retry.');
  if (new URL(result.url, window.location.origin).searchParams.has('error')) throw new Error('Email or password was not accepted.');
}
export function AccountShell({ children }: { children: React.ReactNode }) {
  const identity = useRef(new Identity()).current; const serial = useRef(0);
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [dark, setDark] = useState(false);
  const path = usePathname();
  const invalidate = useCallback(() => { serial.current++; identity.accept(null, true); setSession(null); setLoading(true); }, [identity]);
  const refresh = useCallback(async () => {
    const request = ++serial.current;
    try { const response = await fetch('/api/session', { cache: 'no-store' }); const next = await response.json();
      if (request !== serial.current) return null;
      if (!response.ok || typeof next.csrf !== 'string' || (next.user && typeof next.user.id !== 'string')) throw new Error();
      identity.accept(next.user?.id ?? null); setSession(next); setLoading(false); setError(null); return next as Session;
    } catch { if (request === serial.current) { identity.accept(null, true); setSession(null); setLoading(false); setError('Your account connection is unavailable. The workspace is hidden until it returns.'); } return null; }
  }, [identity]);
  useEffect(() => {
    try { localStorage.removeItem('gstpilot_user'); const next = localStorage.getItem('gstpilot-theme') === 'dark'; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light'; } catch {}
    void refresh(); const focus = () => { void refresh(); }; const storage = (event: StorageEvent) => { if (event.key === 'gstpilot-account-change') { invalidate(); void refresh(); } };
    window.addEventListener('focus', focus); window.addEventListener('storage', storage);
    return () => { serial.current++; identity.accept(null, true); window.removeEventListener('focus', focus); window.removeEventListener('storage', storage); };
  }, [identity, refresh, invalidate]);
  const toggle = () => { const value = !dark; setDark(value); document.documentElement.dataset.theme = value ? 'dark' : 'light'; try { localStorage.setItem('gstpilot-theme', value ? 'dark' : 'light'); } catch {} };
  const signout = async () => { invalidate(); const ticket = identity.capture(); try { await authForm('signout', {}, () => identity.current(ticket)); if (!identity.current(ticket)) return; try { localStorage.setItem('gstpilot-account-change', String(Date.now())); } catch {} window.location.replace('/login'); } catch { if (identity.current(ticket)) { setLoading(false); setError('Sign out was not completed. Please retry.'); } } };
  const authPage = path === '/login' || path === '/signup';
  return <Context.Provider value={{ session, loading, error, identity, refresh, invalidate }}><header className="app-header"><Link href="/" className="app-brand"><Scale size={22} aria-hidden="true" />GSTPilot<span>GST questions, with sources</span></Link><div className="row"><button className="btn icon" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>{session?.user ? <><span className="account-email">{session.user.email}</span><button className="btn" onClick={() => void signout()}><LogOut size={16} />Sign out</button></> : <Link className="btn" href="/login">Sign in</Link>}</div></header>
    {error && <div className="account-error alert danger" role="alert">{error} <button className="btn" onClick={() => void refresh()}>Retry connection</button></div>}
    {authPage ? children : loading ? <div className="workspace-wait" role="status">Checking your account…</div> : session?.user ? <div key={`${session.user.id}:${identity.generation}`}>{children}</div> : !error ? <main className="workspace-wait"><h1>Your GST workspace</h1><p>Sign in to keep conversations and business details in your account.</p><Link className="btn primary" href="/login">Sign in</Link><Link className="btn" href="/signup">Create account</Link></main> : null}
  </Context.Provider>;
}
// A server-rendered view cannot become visible to a later account even from router cache.
export function WorkspaceBoundary({ ownerId, children }: { ownerId: string; children: React.ReactNode }) { const account = useAccount(); const match = account.session?.user?.id === ownerId; useEffect(() => { if (!account.loading && account.session?.user && !match) window.location.replace(window.location.pathname); }, [match, account.loading, account.session?.user]); return match ? children : null; }
export function useRequests() {
  const account = useAccount(); const mounted = useRef(true); const own = useRef(new Set<AbortController>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const controller of own.current) controller.abort(); own.current.clear(); }; }, []);
  const capture = () => account.identity.capture(); const current = (ticket: ReturnType<Identity['capture']>) => mounted.current && !!ticket.owner && account.identity.current(ticket);
  const expire = () => { account.invalidate(); void account.refresh(); };
  async function request<T>(url: string, method = 'GET', body?: unknown, onEvent?: (event: StreamEvent) => void): Promise<T | null> {
    const ticket = capture(); if (!current(ticket)) return null;
    const controller = new AbortController(); own.current.add(controller); account.identity.controllers.add(controller);
    try {
      const response = await fetch(url, { method, cache: 'no-store', signal: controller.signal, headers: protectedHeaders(ticket.owner!, account.session!.csrf, method), ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}) });
      return await readProtected<T>(response, () => current(ticket), expire, onEvent);
    } catch (error) { if (!current(ticket) || error instanceof StaleResponse || controller.signal.aborted) return null; throw error; }
    finally { own.current.delete(controller); account.identity.controllers.delete(controller); }
  }
  return { request, capture, current, ownerId: account.session?.user?.id ?? null };
}
