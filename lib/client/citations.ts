// Source references may be corpus IDs or typed external historical documents.
// A historical document URL must never be silently changed into a nonexistent corpus route.
export type Citation = { id: string; heading?: string; snippet?: string; source_url?: string; url?: string };
export function citationTarget(citation: Citation, historical = false): { kind: 'external' | 'chunk' | 'unavailable'; href?: string } {
  const raw = citation.url ?? citation.source_url;
  if (raw) {
    try {
      const url = new URL(raw);
      const allowed = ['cbic-gst.gov.in', 'cbic.gov.in', 'gst.gov.in', 'gstcouncil.gov.in'];
      if (url.protocol === 'https:' && !url.username && !url.password && allowed.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return { kind: 'external', href: url.href };
    } catch {}
    return { kind: 'unavailable' };
  }
  return historical ? { kind: 'unavailable' } : { kind: 'chunk', href: `/admin/chunks/${encodeURIComponent(citation.id)}` };
}
export function hasHistoricalCalculation(message: { kind?: string; tier?: string; escalated?: boolean; analysis?: { calculation?: unknown } }) {
  return message.kind === 'filing' && message.tier !== 'T3' && !message.escalated && !!message.analysis?.calculation;
}
