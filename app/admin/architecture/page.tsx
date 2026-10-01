// Architecture — live view of the Mermaid flow diagrams (docs/mermaid/*.mmd) INSIDE the app, so
// you can watch the system's shape while building. Reads the files fresh on every load
// (force-dynamic), so editing a .mmd and refreshing shows the new diagram. It also compares the
// newest source file against the newest diagram and flags when the code has moved ahead — an
// honest "this diagram may be out of date" nudge (the diagram is hand/LLM-authored, not
// auto-generated, so it can drift; this tells you WHEN to regenerate).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import MermaidView from "./MermaidView";
import { AGENT_PROMPTS } from "./agent-prompts";
import { loadMemoryInAction } from "@/lib/repositories/admin";

export const dynamic = "force-dynamic";

const MMD_DIR = join(process.cwd(), "docs", "mermaid");
// The source areas whose changes could make the flow diagram stale.
const SRC_DIRS = ["lib/agents", "lib/rates", "lib/calculators", "lib/gates", "lib/retrieval", "lib/tools", "lib/memory", "app/api/ask", "app/api/user", "app/api/memory", "lib/server", "lib/client", "components", "app/api/filing-analysis", "app/api/examples"];

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
