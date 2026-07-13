// Architecture — live view of the Mermaid flow diagrams (docs/mermaid/*.mmd) INSIDE the app, so
// you can watch the system's shape while building. Reads the files fresh on every load
// (force-dynamic), so editing a .mmd and refreshing shows the new diagram. It also compares the
// newest source file against the newest diagram and flags when the code has moved ahead — an
// honest "this diagram may be out of date" nudge (the diagram is hand/LLM-authored, not
// auto-generated, so it can drift; this tells you WHEN to regenerate).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import MermaidView, { type MemoryUser } from "./MermaidView";
import { AGENT_PROMPTS } from "./agent-prompts";
import { getServiceClient, TABLE_PREFIX } from "@/lib/supabase";
import { effectiveConfidence } from "@/lib/memory/store";
import { isFresh, type PendingState } from "@/lib/memory/working";

export const dynamic = "force-dynamic";

const MMD_DIR = join(process.cwd(), "docs", "mermaid");
// The source areas whose changes could make the flow diagram stale.
const SRC_DIRS = ["lib/agents", "lib/rates", "lib/calculators", "lib/gates", "lib/retrieval", "lib/tools", "lib/memory", "app/api/ask", "app/api/user", "app/api/memory"];

// newestMtime — the most-recently-modified .ts/.tsx under a directory (recursive), in ms.
function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
        const m = statSync(p).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(dir);
  return newest;
}

// loadMemoryInAction — the LIVE state behind the memory diagram: every signed-up user with their
// durable facts (stored AND post-decay confidence, so you can see decay working) and any thread
// still holding a working-memory `pending` object (a gather in progress). Read-only, best-effort:
// the Architecture page must render even when the database is unreachable.
async function loadMemoryInAction(): Promise<{ users: MemoryUser[]; error?: string }> {
  try {
    const s = getServiceClient();
    const { data: profiles } = await s
      .from(`${TABLE_PREFIX}user_profile`)
      .select("user_id, email, sells, state, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!profiles?.length) return { users: [] };
    const ids = profiles.map((p) => p.user_id as string);
    const [{ data: facts }, { data: threads }] = await Promise.all([
      s.from(`${TABLE_PREFIX}user_memory`)
        .select("user_id, fact, value, confidence, kind, provenance, as_of, last_confirmed")
        .in("user_id", ids).order("kind").order("as_of", { ascending: false }),
      s.from(`${TABLE_PREFIX}threads`)
        .select("id, title, user_id, pending")
        .in("user_id", ids).not("pending", "is", null),
    ]);
    const users: MemoryUser[] = profiles.map((p) => ({
      user_id: p.user_id as string,
      email: p.email as string,
      sells: (p.sells as string | null) ?? null,
      state: (p.state as string | null) ?? null,
      facts: (facts ?? []).filter((f) => f.user_id === p.user_id).map((f) => ({
        fact: f.fact as string,
        value: f.value as string,
        kind: f.kind as "behavioral" | "default",
        confidence: f.confidence as number,
        effective: Number(effectiveConfidence(f as { confidence: number; as_of: string; last_confirmed: string | null }).toFixed(2)),
        as_of: (f.as_of as string).slice(0, 10),
        last_confirmed: f.last_confirmed ? (f.last_confirmed as string).slice(0, 10) : null,
        provenance: (f.provenance as string | null) ?? null,
      })),
      pendings: (threads ?? []).filter((t) => t.user_id === p.user_id).map((t) => ({
        thread_id: t.id as string,
        title: (t.title as string | null) ?? "",
        fresh: isFresh(t.pending as PendingState),
        pending: t.pending as PendingState,
      })),
    }));
    return { users };
  } catch (e) {
    return { users: [], error: (e as Error).message };
  }
}

export default async function ArchitecturePage() {
  const files = readdirSync(MMD_DIR).filter((f) => f.endsWith(".mmd")).sort();
  const diagrams = files.map((f) => {
    const code = readFileSync(join(MMD_DIR, f), "utf8");
    const title = code.match(/^%%\s*GSTPilot\s*[—-]\s*(.+)$/m)?.[1]?.trim() ?? f;
    return { slug: f.replace(/\.mmd$/, ""), title, code, mtime: statSync(join(MMD_DIR, f)).mtimeMs };
  });
  const newestMmd = Math.max(0, ...diagrams.map((d) => d.mtime));
  const newestSrc = Math.max(0, ...SRC_DIRS.map((g) => newestMtime(join(process.cwd(), g))));
  const memory = await loadMemoryInAction();

  return (
    <MermaidView
      diagrams={diagrams}
      prompts={AGENT_PROMPTS}
      staleInfo={{ stale: newestSrc > newestMmd, srcAt: newestSrc, mmdAt: newestMmd }}
      memory={memory}
    />
  );
}
