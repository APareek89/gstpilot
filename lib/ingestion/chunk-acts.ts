// Structure-aware chunker for the BASE documents (CGST Act, IGST Act, CGST Rules).
// Splits extracted text at LEGAL boundaries — a new chunk starts only where the drafters
// started a new section/rule — so every chunk is a complete legal thought: the rule AND its
// provisos, explanations and exceptions stay together. Chapter headings are tracked as a
// path so a chunk knows where it lives ("CHAPTER V — INPUT TAX CREDIT").
//
// THE NUMBERED-EXPLANATION TRAP (why the boundary regexes look paranoid): law text is full
// of lines that BEGIN with "N." but are not sections — numbered Explanations ("Explanation
// 2.-…"), amendment footnotes ("1. Inserted (w.e.f. …) by s. 109 of The Finance Act…"),
// and sub-clauses. A naive /^\d+\./ boundary would slice these off and orphan them from
// their parent provision — the retriever would then serve a rule without its exception.
// Defense: each document format declares its own stricter pattern (portal exports prefix
// real sections with the word "Section"; the Rules PDF ends every real heading in ".-").

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Chunk = {
  id: string;
  act: string;
  doc_type: string;
  section: string | null;
  heading_path: string[];
  effective_date: string | null;
  status: "in_force" | "superseded";
  amends: string[];
  source_doc_id: string;
  text: string;
};

// Tier-1 metadata: facts we KNOW about each document — nothing here is inferred.
// `sectionRe` captures the section/rule number; `unit` prefixes the deterministic id.
const BASE_CONFIGS = [
  {
    docId: "base-cgst-act",
    act: "CGST-ACT",
    doc_type: "act",
    unit: "s",
    effective: "2022-09-28",
    // portal export: '* Section 16. Eligibility…'. Substituted provisions open inside an
    // amendment bracket — '1 [Section 44. Annual return…' — so the prefix is optional noise.
    sectionRe: /^(?:\d{1,2}\s*\[\s*)?\*?\s*Section\s+(\d{1,3}[A-Z]{0,2})\.\s/,
    chapterRe: /^CHAPTER\s+([IVXLCD]+)\.?\s*(.*)$/,
  },
  {
    docId: "base-igst-act",
    act: "IGST-ACT",
    doc_type: "act",
    unit: "s",
    effective: "2020-03-27",
    sectionRe: /^(?:\d{1,2}\s*\[\s*)?\*?\s*Section\s+(\d{1,3}[A-Z]{0,2})\.\s/,
    chapterRe: /^CHAPTER\s+([IVXLCD]+)\.?\s*(.*)$/,
  },
  {
    docId: "base-cgst-rules",
    act: "CGST-RULES",
    doc_type: "rules",
    unit: "r",
    effective: "2021-06-01",
    // CBIC rules PDF: '3. Intimation for composition levy.-(1) Any person…' — a real rule
    // heading always carries '.-' shortly after the number; footnotes don't. Substituted
    // rules open inside an amendment bracket ('1[11. Separate registration…'). Long titles
    // wrap, so the '.-' may only appear on the NEXT line — the chunker checks a two-line
    // window (lookaheadLines) for this config.
    // Observed heading shapes in the official PDF: '3. Title.-', '1[11. Title.-', '[59. Title.-',
    // '17.Title.-' (missing space), '25[Title.-' (dot swallowed by a substitution bracket),
    // '124. Title:-' (colon instead of dot). Hence: optional footnote/bracket prefix, optional
    // dot, optional bracket, then a Title ending in '.-' or ':-' within ~260 chars.
    sectionRe: /^(?:\d{0,2}\s*\[\s*)?(\d{1,3}[A-Z]{0,2})\.?\s*\[?\s*(?=[A-Z“―‖]).{0,260}?[.:]\s*-/,
    lookaheadLines: 1,
    chapterRe: /^CHAPTER\s+([IVXLCD]+)\s*$/,
  },
] as const;

// Words that may open a line inside a provision but must NEVER open a chunk. The boundary
// regexes already exclude them; this belt-and-braces check catches future format drift
// loudly instead of silently orphaning an exception from its rule.
const GLUE_OPENERS = /^(Provided\s|Explanation\s|Exception\s)/;

function loadPages(docId: string): string[] {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "corpus-text", `${docId}.json`), "utf8")
  );
  return raw.pages.map((p: { text: string }) => p.text);
}

export function chunkActs(): Chunk[] {
  const chunks: Chunk[] = [];

  for (const cfg of BASE_CONFIGS) {
    const lines = loadPages(cfg.docId).join("\n").split("\n");

    let currentChapter = "";
    let currentSection: string | null = null;
    let currentHeadingPath: string[] = [];
    let buf: string[] = [];
    let started = false; // stays false until the first real section — skips ToC/preamble

    const flush = () => {
      if (currentSection && buf.length) {
        const text = buf.join("\n").trim();
        if (text) {
          chunks.push({
            id: `${cfg.act}/${cfg.unit}${currentSection}`,
            act: cfg.act,
            doc_type: cfg.doc_type,
            section: currentSection,
            heading_path: currentHeadingPath,
            effective_date: cfg.effective,
            status: "in_force",
            amends: [],
            source_doc_id: cfg.docId,
            text,
          });
        }
      }
      buf = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Chapter headings update the path but don't own text. ToC lines are full of
      // dotted leaders ("CHAPTER V ..... 42") — the '.....' check skips them.
      const ch = line.match(cfg.chapterRe);
      if (ch && !line.includes("....")) {
        // In the Rules PDF the chapter title sits on the NEXT line ("CHAPTER I\nPRELIMINARY").
        const title = ch[2]?.trim() || (lines[i + 1] ?? "").trim();
        currentChapter = `CHAPTER ${ch[1]} — ${title}`;
        continue;
      }

      // Some formats wrap a rule's title across lines, putting the identifying '.-' on the
      // next line — test the boundary pattern against a small joined window, not one line.
      const window =
        "lookaheadLines" in cfg && cfg.lookaheadLines
          ? [line, ...lines.slice(i + 1, i + 1 + cfg.lookaheadLines)].join(" ")
          : line;
      const sec = window.match(cfg.sectionRe);
      if (sec && !GLUE_OPENERS.test(line)) {
        const num = sec[1];
        // Sections appear in ascending-ish order; a sudden repeat of an earlier number
        // means we matched something inside a later provision (cross-reference) — ignore it.
        flush();
        started = true;
        currentSection = num;
        currentHeadingPath = currentChapter ? [currentChapter] : [];
        buf.push(line);
        continue;
      }

      if (started) buf.push(line);
    }
    flush();
  }

  // Consolidated PDFs sometimes carry a provision TWICE — an omitted/substituted section's
  // current placeholder plus its historical text (e.g. s42 after the Finance Act 2022, the
  // twice-printed e-way bill rules). The first occurrence is the current consolidated
  // position and stays in_force; later occurrences are history: suffixed --v2 and marked
  // superseded, so retrieval can filter them out while the audit trail keeps them.
  const seen = new Map<string, number>();
  for (const c of chunks) {
    const n = (seen.get(c.id) ?? 0) + 1;
    seen.set(c.id, n);
    if (n > 1) {
      c.id = `${c.id}--v${n}`;
      c.status = "superseded";
    }
  }

  return chunks;
}
