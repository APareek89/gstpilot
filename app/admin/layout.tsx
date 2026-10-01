// Existing evidence views are owner-bound on the server and on cached client navigation.
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { WorkspaceBoundary } from '@/components/AccountShell';
export const dynamic = 'force-dynamic';
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <WorkspaceBoundary ownerId={user.id}><div className="admin-content"><nav className="admin-nav" aria-label="Evidence views"><Link href="/">Back to workspace</Link><Link href="/admin/chunks">Sources</Link><Link href="/admin/playground">Retrieval playground</Link><Link href="/admin/traces">Traces</Link><Link href="/admin/evals">Evaluations</Link><Link href="/admin/conversations">Conversations</Link><Link href="/admin/triage">Triage → Golden</Link><Link href="/admin/architecture">Architecture</Link></nav>{children}</div></WorkspaceBoundary>;
}
