// Enricher: ONE claude-haiku call per chunk, filling exactly two judgment fields —
// provision_type (from a closed list) and cross_refs (sections/rules the text mentions).
//
// Why this is the lowest-risk possible use of a language model:
//   1. It never touches identity — act, section, id, text are already fixed by config and
//      pattern-matching before the model ever sees the chunk.
//   2. The output space is CLOSED — a label must be one of ten known strings; anything else
//      is rejected and retried, so the model literally cannot invent a category.
//   3. Temperature 0 + strict JSON: the most deterministic mode a model has.
//   4. Failure is graceful: a wrong label slightly degrades retrieval ranking; it cannot
//      change what the law says or what gets cited. (Compare: a wrong section number would.)

import Anthropic from "../providers/client";
import { getServiceClient, TABLE_PREFIX } from "../supabase";

// "clarification" was added after the closed set rejected it 500+ times for circulars —
// the model was right (circulars ARE clarifications); the vocabulary was incomplete.
// Expanding the set is a HUMAN decision made here in code review, never a model freewheel.
const LABELS = [
  "definition", "levy", "exemption", "eligibility", "procedure", "clarification",
  "restriction", "penalty", "rate-schedule", "amendment", "other",
] as const;

const CONCURRENCY = 8;

const PROMPT = (text: string) => `You label chunks of Indian GST law. Respond with ONLY a JSON object, no prose.

Schema: {"provision_type": one of ${JSON.stringify(LABELS)}, "cross_refs": array of strings like "section 49" or "rule 36" that this text explicitly refers to (max 10, [] if none)}

provision_type MUST be exactly one string from that list. If none fits perfectly, pick the CLOSEST one (e.g. liability provisions -> "restriction", amnesty/waiver schemes -> "exemption"). Never invent a new label.

Text:
"""
${text.slice(0, 6000)}
"""`;

async function labelOne(anthropic: Anthropic, id: string, text: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: "user", content: PROMPT(text) }],
    });
    const raw = res.content[0].type === "text" ? res.content[0].text : "";
    try {
      const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ""));
      if (!LABELS.includes(parsed.provision_type)) throw new Error(`label '${parsed.provision_type}' not in closed set`);
      return {
        provision_type: parsed.provision_type as string,
        cross_refs: (Array.isArray(parsed.cross_refs) ? parsed.cross_refs : []).slice(0, 10).map(String),
      };
    } catch (e) {
      if (attempt === 1) throw new Error(`${id}: ${(e as Error).message}`);
    }
  }
  throw new Error("unreachable");
}

// Enrich every chunk that hasn't been labeled yet (re-runnable: already-labeled rows are
// skipped, so a crash resumes and a re-run after new chunks load touches only the new ones).
export async function enrichChunks(): Promise<{ labeled: number; failed: number }> {
  const supabase = getServiceClient();
  const anthropic = new Anthropic();
  let labeled = 0, failed = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(`${TABLE_PREFIX}legal_chunks`)
      .select("id, text")
      .is("provision_type", null)
      .limit(200);
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (let i = 0; i < data.length; i += CONCURRENCY) {
      const results = await Promise.allSettled(
        data.slice(i, i + CONCURRENCY).map(async (row: { id: string; text: string }) => {
          const labels = await labelOne(anthropic, row.id, row.text);
          const { error: upErr } = await supabase
            .from(`${TABLE_PREFIX}legal_chunks`)
            .update(labels)
            .eq("id", row.id);
          if (upErr) throw new Error(upErr.message);
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") labeled++;
        else { failed++; console.log(`  ✗ ${r.reason}`); }
      }
      if (labeled % 100 < CONCURRENCY) console.log(`  …${labeled} labeled`);
    }
    if (failed > 20) throw new Error("too many enrichment failures — stopping");
  }
  return { labeled, failed };
}
