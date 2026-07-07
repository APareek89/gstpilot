// Chunker for the STREAM documents (notifications + circulars).
// A notification is already one legal act — usually short — so the default is ONE chunk per
// notification. Rate notifications amend TABLES ("against S. No. 243, substitute…"): the
// table rows stay in the chunk as text, and we append derived one-line summaries of each
// change so retrieval can match "what changed for S.No. 243" even when the original phrasing
// is legalese. Very long notifications (the original rate schedules run 100+ pages) split
// into parts at line boundaries, never mid-row.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Chunk } from "./chunk-acts";

const MAX_CHUNK_CHARS = 6_000;

type ManifestDoc = {
  doc_id: string; doc_type: string; number: string; date: string; title: string;
  local_path: string; status: string; needs_ocr: boolean; amends: string[];
};

const ACT_BY_TYPE: Record<string, string> = {
  "notification-central-tax": "NOTIF-CT",
  "notification-central-tax-rate": "NOTIF-CTR",
  "circular": "CIRCULAR",
};

// Pull "against S. No. 243, … substitute …"-style operations out of amendment text and
// turn each into a plain one-line summary. Best-effort: rows we can't parse simply get no
// summary line — the full text is still in the chunk, so nothing is lost.
export function deriveChangeSummaries(text: string): string[] {
  const out: string[] = [];
  // [\s\S] instead of the 's' flag keeps us compatible with the project's TS target.
  const re = /against\s+S\.?\s*Nos?\.?\s*([0-9]+[A-Z]?(?:\s*(?:,|and)\s*[0-9]+[A-Z]?)*)[\s,]+((?:[\s\S](?!against\s+S\.?\s*No))*?)(?:;|\.\s|$)/gi;
  for (const m of text.matchAll(re)) {
    const op =
      /omit/i.test(m[2]) ? "omitted" :
      /substitut/i.test(m[2]) ? "substituted" :
      /insert/i.test(m[2]) ? "inserted" : "amended";
    out.push(`CHANGE: S.No. ${m[1].replace(/\s+/g, " ")} ${op}: ${m[2].replace(/\s+/g, " ").trim().slice(0, 140)}`);
    if (out.length >= 40) break; // giant schedules: cap the summary block, keep full text
  }
  return out;
}

export function chunkNotifications(): Chunk[] {
  const manifest: ManifestDoc[] = JSON.parse(
    readFileSync(join(process.cwd(), "corpus", "manifest.json"), "utf8")
  );
  const chunks: Chunk[] = [];

  for (const doc of manifest) {
    const act = ACT_BY_TYPE[doc.doc_type];
    if (!act || doc.status !== "downloaded" || doc.needs_ocr) continue;

    const extracted = JSON.parse(
      readFileSync(join(process.cwd(), "corpus-text", `${doc.doc_id}.json`), "utf8")
    );
    let text: string = extracted.pages.map((p: { text: string }) => p.text).join("\n").trim();
    if (!text) continue;

    // Header line makes every chunk self-describing even when read in isolation.
    const header = `${doc.number} dated ${doc.date} — ${doc.title}`;
    const summaries = deriveChangeSummaries(text);
    if (summaries.length) {
      text += `\n\n--- derived change summaries ---\n${summaries.join("\n")}`;
    }
    text = `${header}\n\n${text}`;

    const base = {
      act,
      doc_type: doc.doc_type,
      section: null,
      heading_path: [doc.number],
      effective_date: doc.date || null,
      status: "in_force" as const,
      amends: doc.amends,
      source_doc_id: doc.doc_id,
    };

    if (text.length <= MAX_CHUNK_CHARS) {
      chunks.push({ id: `${act}/${doc.doc_id}`, ...base, text });
    } else {
      // Split at line boundaries so a table row is never cut in half.
      const lines = text.split("\n");
      let part = 1, buf: string[] = [], size = 0;
      const flush = () => {
        if (buf.length) {
          chunks.push({ id: `${act}/${doc.doc_id}/p${part}`, ...base, text: `${part > 1 ? header + " (contd.)\n\n" : ""}${buf.join("\n")}` });
          part++; buf = []; size = 0;
        }
      };
      for (const line of lines) {
        if (size + line.length > MAX_CHUNK_CHARS) flush();
        buf.push(line); size += line.length + 1;
      }
      flush();
    }
  }
  return chunks;
}
