// Corpus downloader for GSTPilot. Run with: pnpm download-corpus
// Fetches the three consolidated BASE documents of GST law (CGST Act, IGST Act, CGST Rules)
// from official government sources into corpus/base/, and writes a manifest.json recording
// exactly what was downloaded, from where, when, and its sha256 fingerprint — so every
// answer the app ever gives can be traced back to a specific version of the law's text.
// This is an OFFLINE batch tool: it runs when we refresh the corpus, never during user questions.
//
// Corp-network note: if TLS fails locally, run with
// NODE_EXTRA_CA_CERTS="<path to corp CA bundle>" pnpm download-corpus

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The base corpus. "asOn" is the consolidation date printed inside the document — the CBIC
// portals stopped publishing newer consolidated PDFs, so these bases are brought current by
// the amendment-act + notification stream we ingest in Phase 1/9 (layered, never hand-edited).
const BASE_DOCS = [
  {
    id: "cgst-act",
    title: "Central Goods and Services Tax Act, 2017 (consolidated)",
    asOn: "2021-08-31",
    url: "https://cbic-gst.gov.in/pdf/CGST-Act-Updated-31082021.pdf",
    source: "CBIC GST portal",
  },
  {
    id: "igst-act",
    // Fallback only: the original 2017 gazette text. The consolidated version lives behind
    // taxinformation.cbic.gov.in, which blocks headless access — Anand downloaded it manually
    // (marked manual:true in the manifest), and manual files are never overwritten below.
    title: "Integrated Goods and Services Tax Act, 2017 (original gazette text)",
    asOn: "2017-04-12",
    url: "https://www.indiacode.nic.in/bitstream/123456789/7773/1/igst-act.pdf",
    source: "India Code (Ministry of Law official repository)",
  },
  {
    id: "cgst-rules",
    title: "Central Goods and Services Tax Rules, 2017 — Part A (consolidated)",
    asOn: "2021-06-01",
    url: "https://cbic-gst.gov.in/pdf/01062021-CGST-Rules-2017-Part-A-Rules.pdf",
    source: "CBIC GST portal",
  },
] as const;

const OUT_DIR = join(__dirname, "..", "corpus", "base");

// Government servers are slow and occasionally flaky, so each document gets up to
// `tries` attempts before we give up and tell the human what to fetch manually.
async function download(url: string, tries = 2): Promise<Buffer> {
  let lastError = "";
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        // A browser-like user agent: some gov servers reject unknown clients.
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Sanity check: real PDFs start with the bytes "%PDF". A login page or error page
      // saved as .pdf would silently poison every later phase — fail loudly here instead.
      if (!buf.subarray(0, 4).equals(Buffer.from("%PDF"))) {
        throw new Error("response is not a PDF (got HTML or an error page)");
      }
      return buf;
    } catch (e) {
      lastError = (e as Error).message;
      console.log(`  attempt ${attempt}/${tries} failed: ${lastError}`);
    }
  }
  throw new Error(lastError);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const failures: string[] = [];

  // Manually-placed files (manual:true in the manifest) beat anything we can auto-download —
  // they're newer consolidations from portals that block scripts. Never overwrite them.
  const manifestPath = join(OUT_DIR, "manifest.json");
  const existing: any[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
  const manifest: object[] = [];

  for (const doc of BASE_DOCS) {
    const prior = existing.find((e) => e.id === doc.id);
    if (prior?.manual && existsSync(join(OUT_DIR, `${doc.id}.pdf`))) {
      manifest.push(prior);
      console.log(`· ${doc.id}: keeping manual copy (as on ${prior.asOn})`);
      continue;
    }
    console.log(`↓ ${doc.title}`);
    try {
      const buf = await download(doc.url);
      const file = join(OUT_DIR, `${doc.id}.pdf`);
      writeFileSync(file, buf);
      manifest.push({
        ...doc,
        file: `corpus/base/${doc.id}.pdf`,
        bytes: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
        downloadedAt: new Date().toISOString(),
      });
      console.log(`  ✓ saved ${(buf.length / 1024).toFixed(0)} KB → corpus/base/${doc.id}.pdf`);
    } catch (e) {
      failures.push(`${doc.title}: ${(e as Error).message} — fetch manually from ${doc.url}`);
      console.log(`  ✗ giving up on ${doc.id}`);
    }
  }

  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nManifest written: corpus/base/manifest.json (${manifest.length}/${BASE_DOCS.length} documents)`);

  if (failures.length) {
    console.log("\n⚠️ HUMAN TASK — download these manually into corpus/base/:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main();
