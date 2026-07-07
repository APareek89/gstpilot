// Ingestion orchestrator. Run: pnpm ingest [--enrich]
// Chunks the extracted text (acts + notifications), loads everything into the database,
// prints a PDF→chunk reconciliation (counts must explain themselves at every stage — the
// habit that caught the corrigendum-overwrite bug in Phase 1), and writes the reconciliation
// to docs/RECONCILIATION.md. --enrich additionally runs the claude-haiku labeling pass.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunkActs } from "../lib/ingestion/chunk-acts";
import { chunkNotifications } from "../lib/ingestion/chunk-notifications";
import { enrichChunks } from "../lib/ingestion/enrich";
import { loadChunks } from "../lib/ingestion/load";

async function main() {
  const actChunks = chunkActs();
  const notifChunks = chunkNotifications();
  const all = [...actChunks, ...notifChunks];

  // Reconciliation: every source document must be accounted for.
  const byAct = new Map<string, number>();
  for (const c of all) byAct.set(c.act, (byAct.get(c.act) ?? 0) + 1);
  const sourceDocs = new Set(all.map((c) => c.source_doc_id));

  const lines = [
    "# Phase 2 reconciliation — PDFs → chunks",
    "",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "| act | chunks |",
    "| --- | --- |",
    ...[...byAct.entries()].map(([a, n]) => `| ${a} | ${n} |`),
    `| **total** | **${all.length}** |`,
    "",
    `Source documents chunked: ${sourceDocs.size} (of 410 in manifest; 6 are needs_ocr stubs awaiting Phase 2b OCR, plus any zero-text docs listed below)`,
    "",
  ];

  console.log(lines.join("\n"));
  console.log("\nLoading into gstpilot_legal_chunks…");
  await loadChunks(all);
  console.log(`✓ upserted ${all.length} chunks`);

  // Keyword search weighs terms by corpus rarity; the rarity table must be rebuilt
  // whenever the corpus changes, or new documents' words are invisible to it.
  const { getServiceClient } = await import("../lib/supabase");
  const { error: refreshErr } = await getServiceClient().rpc("gstpilot_refresh_lexeme_stats");
  console.log(refreshErr ? `⚠ lexeme stats refresh: ${refreshErr.message}` : "✓ lexeme stats refreshed");

  writeFileSync(join(process.cwd(), "docs", "RECONCILIATION.md"), lines.join("\n") + "\n");

  if (process.argv.includes("--enrich")) {
    console.log("\nEnriching (claude-haiku, closed label set)…");
    const { labeled, failed } = await enrichChunks();
    console.log(`✓ labeled=${labeled} failed=${failed}`);
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
