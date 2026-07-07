// STREAM downloader for GSTPilot. Run with: pnpm download-stream
// Downloads the notification + circular stream (the law changes issued after our BASE
// consolidation dates) from taxinformation.cbic.gov.in — CBIC's official repository.
// Instead of scraping HTML, we use the JSON API the portal's own front-end calls: an
// anonymous guest token unlocks list endpoints, and each PDF is served (base64-in-JSON)
// from a public content path. Everything lands in corpus/stream/ plus one corpus-wide
// manifest at corpus/manifest.json. Re-running is always safe (idempotent): files whose
// sha256 already matches the manifest are skipped, so a crash mid-run just resumes.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// pdf-parse's deep import avoids its debug harness; we only use it to DETECT a text layer,
// real extraction stays with Python (Phase 2).
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const PORTAL = "https://taxinformation.cbic.gov.in";
const GST_TAX_ID = 1000001;
const ROOT = join(__dirname, "..");
const STREAM_DIR = join(ROOT, "corpus", "stream");
const MANIFEST_PATH = join(ROOT, "corpus", "manifest.json");

// Central Tax notifications before this date are already baked into our consolidated
// CGST Rules base (as amended up to 01-06-2021). Rate notifications have NO base —
// rates live only in the notification chain — so that series downloads in full.
const CENTRAL_TAX_CUTOFF = "2021-06-01";

// Politeness: one request every 2 seconds, an honest user-agent, and exponential backoff.
// We are a guest on a government server; behaving like a browser tab, not a vacuum cleaner.
const DELAY_MS = 2_000;
const USER_AGENT = "GSTPilot-corpus/0.1 (learning project; contact: anandpareek@gofynd.com)";
const BACKOFF_MS = [0, 5_000, 20_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ManifestDoc = {
  doc_id: string;
  doc_type: string;
  number: string;
  date: string;
  title: string;
  source_url: string;
  local_path: string;
  sha256: string;
  bytes: number;
  needs_ocr: boolean;
  status: "downloaded" | "failed";
  amends: string[];
};

let token = "";

// The portal's own anonymous login: POST with no body returns a guest JWT. This is the
// same call the website makes for every visitor — we're not bypassing anything.
async function refreshToken(): Promise<void> {
  const res = await fetch(`${PORTAL}/api/authenticate-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`authenticate-token failed: HTTP ${res.status}`);
  token = ((await res.json()) as { id_token: string }).id_token;
}

// One GET with retry + backoff. On 401 (guest tokens expire) we refresh and retry;
// on network errors / 5xx we wait longer each attempt before giving up.
async function apiGet(path: string, auth: boolean): Promise<Response> {
  let lastErr = "";
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    if (BACKOFF_MS[attempt]) await sleep(BACKOFF_MS[attempt]);
    try {
      const res = await fetch(`${PORTAL}/${path}`, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 401 && auth) {
        await refreshToken();
        lastErr = "401 (token refreshed)";
        continue;
      }
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      return res;
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`${path}: ${lastErr}`);
}

// "Seeks to amend notification No. 12/2017- Central Tax (Rate)" → ["12/2017-Central Tax (Rate)"].
// Best-effort by design: titles are free text, so we catch the common phrasings and leave
// the rest empty. In Phase 9 these edges become the "what changed for whom" graph.
function parseAmends(title: string): string[] {
  const out = new Set<string>();
  const re = /[Nn]otification\s*[Nn]o\.?\s*([0-9]{1,3}\/20[0-9]{2})\s*[-–]?\s*(Central Tax(?:\s*\(Rate\))?|Integrated Tax(?:\s*\(Rate\))?)?/g;
  for (const m of title.matchAll(re)) {
    out.add(m[2] ? `${m[1]}-${m[2].replace(/\s+/g, " ").trim()}` : m[1]);
  }
  // "amend ... CGST Rules" style references (rule amendments, no notification number)
  if (/amend[a-z]*\s+.{0,30}(CGST|Central Goods and Services Tax)\s+Rules/i.test(title)) {
    out.add("cgst-rules");
  }
  return [...out];
}

// A PDF "text layer" means the file stores actual characters (selectable text), not just a
// photograph of a page. Detection: ask pdf-parse for the first pages' text and measure
// characters-per-page. A born-digital notification yields 1000+; a scan yields ~0.
// Below 100 chars/page we flag needs_ocr — Phase 2 will route those through OCR instead.
async function detectNeedsOcr(buf: Buffer): Promise<boolean> {
  try {
    const parsed = await pdfParse(buf, { max: 2 });
    const pages = Math.min(parsed.numpages || 1, 2);
    return parsed.text.trim().length / pages < 100;
  } catch {
    return true; // unparseable = definitely needs human/OCR attention
  }
}

// "15/2022-Central Tax (Rate)" → "ntr-2022-015"; "194/06/2023-GST" → "cir-2023-194".
// The number field is messy human text ("36 /2017-…" with stray spaces), so the regex
// tolerates whitespace. Bare "Corrigendum" rows have no number at all — for those we hash
// the source file path, which is the one property guaranteed unique per document.
function makeDocId(prefix: string, number: string, filePath: string): string {
  const m = number.match(/^\s*([0-9]{1,3})\s*\/\s*(?:[0-9]{1,3}\s*\/\s*)?(20[0-9]{2})/);
  if (m) return `${prefix}-${m[2]}-${m[1].padStart(3, "0")}`;
  return `${prefix}-x-${createHash("sha256").update(filePath).digest("hex").slice(0, 8)}`;
}

async function downloadPdf(docFilePath: string): Promise<Buffer> {
  // Windows-style backslashes in the API's file paths become URL slashes.
  const urlPath = "content/pdf/" + docFilePath.replace(/\\/g, "/");
  const res = await apiGet(urlPath, false);
  const { data } = (await res.json()) as { data: string };
  const buf = Buffer.from(data, "base64");
  if (!buf.subarray(0, 4).equals(Buffer.from("%PDF"))) {
    throw new Error("decoded payload is not a PDF");
  }
  return buf;
}

async function main() {
  mkdirSync(STREAM_DIR, { recursive: true });
  await refreshToken();

  // Load prior manifest so re-runs skip verified files (idempotency), and fold in the
  // BASE documents so corpus/manifest.json describes the ENTIRE corpus in one place.
  const prior: ManifestDoc[] = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
    : [];
  const priorById = new Map(prior.map((d) => [d.doc_id, d]));

  const baseManifest = JSON.parse(readFileSync(join(ROOT, "corpus", "base", "manifest.json"), "utf8"));
  const docs: ManifestDoc[] = baseManifest.map((b: any) => ({
    doc_id: `base-${b.id}`,
    doc_type: b.id.includes("rules") ? "rules" : "act",
    number: b.id,
    date: b.asOn,
    title: b.title,
    source_url: b.url,
    local_path: b.file,
    sha256: b.sha256,
    bytes: b.bytes,
    needs_ocr: false,
    status: "downloaded" as const,
    amends: [],
  }));

  // ---- fetch the three series lists (2s apart — politeness applies to lists too) ----
  const listUrl = (ep: string, cat: string) =>
    `api/${ep}/${GST_TAX_ID}/${encodeURIComponent(cat)}`;

  console.log("Fetching document lists…");
  const centralTax = (await (await apiGet(listUrl("cbic-notification-msts/fetchNotificationByCategory", "Central Tax"), true)).json()) as any[];
  await sleep(DELAY_MS);
  const rate = (await (await apiGet(listUrl("cbic-notification-msts/fetchNotificationByCategory", "Central Tax (Rate)"), true)).json()) as any[];
  await sleep(DELAY_MS);
  const circulars = (await (await apiGet(listUrl("cbic-circular-msts/fetchCategoryRelatedCirculars", "Circulars CGST"), true)).json()) as any[];

  const approved = new Set(
    JSON.parse(readFileSync(join(__dirname, "approved-circulars.json"), "utf8")).map((c: any) => c.circularNo)
  );

  // Scope filters: English rows only; Central Tax from the Rules base date; Rate = all;
  // circulars = the approved e-commerce-relevant list.
  type Job = { prefix: string; doc_type: string; number: string; date: string; title: string; path: string };
  const jobs: Job[] = [
    ...centralTax
      .filter((n) => n.contentLanguage === "ENGLISH" && (n.notificationDt ?? "") >= CENTRAL_TAX_CUTOFF)
      .map((n) => ({ prefix: "nt", doc_type: "notification-central-tax", number: n.notificationNo, date: (n.notificationDt ?? "").slice(0, 10), title: n.notificationName ?? "", path: n.docFilePath })),
    ...rate
      .filter((n) => n.contentLanguage === "ENGLISH")
      .map((n) => ({ prefix: "ntr", doc_type: "notification-central-tax-rate", number: n.notificationNo, date: (n.notificationDt ?? "").slice(0, 10), title: n.notificationName ?? "", path: n.docFilePath })),
    ...circulars
      .filter((c) => approved.has(c.circularNo))
      .map((c) => ({ prefix: "cir", doc_type: "circular", number: c.circularNo, date: (c.circularDt ?? "").slice(0, 10), title: c.circularName ?? "", path: c.docFilePath })),
  ].filter((j) => j.path);

  // The API sometimes returns the same document as two or three identical rows —
  // dedupe by file path so each PDF is downloaded and recorded exactly once.
  const seenPaths = new Set<string>();
  const uniqueJobs = jobs.filter((j) => (seenPaths.has(j.path) ? false : (seenPaths.add(j.path), true)));
  jobs.length = 0;
  jobs.push(...uniqueJobs);

  console.log(`Queued: ${jobs.length} documents (central-tax=${jobs.filter(j => j.prefix === "nt").length}, rate=${jobs.filter(j => j.prefix === "ntr").length}, circulars=${jobs.filter(j => j.prefix === "cir").length})\n`);

  // ---- download loop ----
  let downloaded = 0, skipped = 0, failed = 0;
  for (const job of jobs) {
    const doc_id = makeDocId(job.prefix, job.number, job.path);
    const local_path = `corpus/stream/${doc_id}.pdf`;
    const abs = join(ROOT, local_path);

    // Idempotency: if this doc is in the manifest and the bytes on disk still match its
    // fingerprint, there is nothing to do. Checksum-skip, not filename-skip — a corrupted
    // or half-written file has the wrong sha256 and gets re-downloaded.
    const before = priorById.get(doc_id);
    if (before?.status === "downloaded" && existsSync(abs)) {
      const diskSha = createHash("sha256").update(readFileSync(abs)).digest("hex");
      if (diskSha === before.sha256) {
        docs.push(before);
        skipped++;
        continue;
      }
    }

    try {
      const buf = await downloadPdf(job.path);
      writeFileSync(abs, buf);
      docs.push({
        doc_id,
        doc_type: job.doc_type,
        number: job.number,
        date: job.date,
        title: job.title,
        source_url: `${PORTAL}/content/pdf/${job.path.replace(/\\/g, "/")}`,
        local_path,
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.length,
        needs_ocr: await detectNeedsOcr(buf),
        status: "downloaded",
        amends: parseAmends(job.title),
      });
      downloaded++;
      if (downloaded % 25 === 0) console.log(`  …${downloaded} downloaded, ${skipped} skipped`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${doc_id} (${job.number}): ${(e as Error).message}`);
      docs.push({
        doc_id, doc_type: job.doc_type, number: job.number, date: job.date, title: job.title,
        source_url: `${PORTAL}/content/pdf/${job.path.replace(/\\/g, "/")}`,
        local_path, sha256: "", bytes: 0, needs_ocr: false, status: "failed",
        amends: parseAmends(job.title),
      });
    }
    await sleep(DELAY_MS);
  }

  docs.sort((a, b) => (a.doc_type + a.date).localeCompare(b.doc_type + b.date));
  writeFileSync(MANIFEST_PATH, JSON.stringify(docs, null, 2) + "\n");

  // ---- validation report ----
  console.log("\n================ VALIDATION REPORT ================");
  console.log(`downloaded=${downloaded}  skipped(checksum)=${skipped}  failed=${failed}`);
  const byType = new Map<string, number>();
  for (const d of docs) byType.set(d.doc_type, (byType.get(d.doc_type) ?? 0) + 1);
  console.log("\nCounts by type:");
  for (const [t, n] of byType) console.log(`  ${t}: ${n}`);

  // Date-coverage gaps: within each stream series, flag any silence longer than 12 months —
  // GST notifications land near-monthly, so a long quiet stretch means we MISSED documents.
  console.log("\nDate-coverage gaps (>12 months between consecutive docs):");
  let gapFound = false;
  for (const t of ["notification-central-tax", "notification-central-tax-rate"]) {
    const dates = docs.filter((d) => d.doc_type === t && d.date).map((d) => d.date).sort();
    for (let i = 1; i < dates.length; i++) {
      const gapDays = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86_400_000;
      if (gapDays > 365) {
        console.log(`  ⚠ ${t}: ${dates[i - 1]} → ${dates[i]} (${Math.round(gapDays)} days)`);
        gapFound = true;
      }
    }
  }
  if (!gapFound) console.log("  none ✓");

  const ocr = docs.filter((d) => d.needs_ocr);
  console.log(`\nneeds_ocr: ${ocr.length}`);
  for (const d of ocr) console.log(`  ${d.doc_id} — ${d.number}`);

  const amendsCount = docs.filter((d) => d.amends.length > 0).length;
  console.log(`\namends[] parsed for ${amendsCount}/${docs.length} docs`);
  console.log("===================================================");
  if (failed > 0) process.exit(1);
}

main();
