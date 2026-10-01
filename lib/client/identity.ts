// Each asynchronous response belongs to the account and generation that started it.
// Changing identity immediately cancels network work and rejects late body/stream results.
// This protects presentation; the server still authorizes every request independently.
export class Identity {
  owner: string | null = null;
  generation = 0;
  controllers = new Set<AbortController>();
  accept(owner: string | null, force = false) {
    if (force || owner !== this.owner) {
      this.owner = owner; this.generation++;
      for (const controller of this.controllers) controller.abort();
      this.controllers.clear();
    }
  }
  capture() { return { owner: this.owner, generation: this.generation }; }
  current(ticket: ReturnType<Identity['capture']>) { return ticket.owner === this.owner && ticket.generation === this.generation; }
}
export class StaleResponse extends Error { constructor() { super('Account changed.'); } }
export type StreamEvent = { type: string; [key: string]: unknown };
// Read complete SSE frames only. Expiry/callback failures escape the JSON parse catch.
export async function readEvents(response: Response, current: () => boolean, expire: () => void, onEvent: (event: StreamEvent) => void) {
  if (!current()) throw new StaleResponse();
  if (!response.body) throw new Error('No response was received. Please retry.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const consume = (block: string) => {
    if (!current()) throw new StaleResponse();
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event: StreamEvent; try { event = JSON.parse(data); } catch { return; }
    if (event.type === 'session_expired' || event.code === 'AUTH_REQUIRED' || event.code === 'authentication_required') { expire(); throw new StaleResponse(); }
    onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (!current()) throw new StaleResponse();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); consume(block); }
      if (buffer.length > 262144) throw new Error('Response was too large. Please use a shorter question.');
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function protectedHeaders(owner: string, csrf: string, method: string) {
  return { 'X-GSTPilot-Owner': owner, ...(method !== 'GET' ? { 'X-GSTPilot-CSRF': csrf, 'Content-Type': 'application/json' } : {}) };
}
// Body parsing is part of the identity boundary; checking fetch completion alone is insufficient.
export async function readProtected<T>(response: Response, current: () => boolean, expire: () => void, onEvent?: (event: StreamEvent) => void): Promise<T | null> {
  if (!current()) throw new StaleResponse();
  if (response.status === 401) { expire(); throw new StaleResponse(); }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (!current()) throw new StaleResponse();
    if (data?.error === 'session_expired' || data?.code === 'SESSION_CHANGED' || data?.code === 'session_expired') { expire(); throw new StaleResponse(); }
    throw new Error(response.status === 429 ? 'Please wait before trying again.' : data?.message || (typeof data?.error === 'string' ? data.error : 'The request could not be completed. Please retry.'));
  }
  if (onEvent) { await readEvents(response, current, expire, onEvent); return null; }
  const data = await response.json(); if (!current()) throw new StaleResponse(); return data as T;
}
