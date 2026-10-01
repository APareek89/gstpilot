// One presentation rule is shared by the workspace and persisted evidence views.
import Link from 'next/link';
import { citationTarget, type Citation } from '@/lib/client/citations';
export function CitationLink({ citation, historical = false, label, className = 'text-link' }: { citation: Citation; historical?: boolean; label?: string; className?: string }) {
  const target = citationTarget(citation, historical);
  if (target.kind === 'external') return <a href={target.href} target="_blank" rel="noopener noreferrer" className={className}>{label ?? 'Read official source'}</a>;
  if (target.kind === 'chunk') return <Link href={target.href!} className={className}>{label ?? 'Read this source'}</Link>;
  return <span className="muted">{label ? `${label} · source link unavailable` : 'Source link unavailable.'}</span>;
}
