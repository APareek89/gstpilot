// THE CHANGE-OVER-TIME LANE — "has the footwear rate changed in the last 6 months?"
// Bounded and honest: it can only claim a change when the corpus actually holds ≥2 DATED
// documents on the topic. It retrieves relevant notifications/circulars, sorts them by their
// government release date (effective_date — populated on every chunk from the manifest), filters
// to the asked window, and narrates a cited timeline. If it finds fewer than two dated docs, it
// says so plainly and points at the most recent one — it never fabricates a "change" to look
// helpful. Each line is tagged to a real chunk id, so the timeline is verifiable.

import { hybridSearch } from "../../retrieval/search";
import {chunksById} from "../../repositories/corpus";
import { resolveItem } from "../../rates/lookup";
import type { LaneOutcome } from "../lanes";
import type { LfParent } from "../../observability/langfuse";

// parseWindowMonths — how far back does the question ask us to look? Simple, readable rules over
// "6 months"/"2 saal"/"since 2023"/"last year"; defaults to 24 months when unspecified.
function parseWindowMonths(text: string): number {
  const t = text.toLowerCase();
  const m = t.match(/(\d+)\s*(months?|mahin[ae])/);
  if (m) return parseInt(m[1], 10);
  const y = t.match(/(\d+)\s*(years?|saal|varsh)/);
  if (y) return parseInt(y[1], 10) * 12;
  const since = t.match(/since\s+(20\d{2})/);
  if (since) {
    const now = new Date();
    return Math.max(1, (now.getFullYear() - parseInt(since[1], 10)) * 12 + now.getMonth() + 1);
  }
  if (/last year|pichhle saal|past year/.test(t)) return 12;
  if (/last month|pichhle mahine/.test(t)) return 1;
  return 24;
}

export async function runTimelineLane(question: string, context?: string, _intent?: string, parent?: LfParent): Promise<LaneOutcome> {
  const months = parseWindowMonths(`${context ?? ""} ${question}`);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const retrieval = await hybridSearch(question, "timeline", parent);
  const ids = retrieval.fused.map((c) => c.id);

  // Fetch the release date + source of each retrieved chunk; keep only dated notifications/
  // circulars, de-duplicated to one row per source document (a notification split across pages
  // must count once), then order oldest→newest.
  const data = await chunksById(ids);
  const byDoc = new Map<string, { id: string; date: string; heading: string }>();
  for (const r of data ?? []) {
    if (!["NOTIF-CT", "NOTIF-CTR", "CIRCULAR"].includes(r.act as string)) continue;
    if (!r.effective_date) continue;
    if (!byDoc.has(r.source_doc_id as string)) {
      byDoc.set(r.source_doc_id as string, {
        id: r.id as string,
        date: r.effective_date as string,
        heading: ((r.heading_path as string[]) ?? []).join(" › "),
      });
    }
  }

  // Anchor with the rate table: if this is a known item, its governing rate notification is the
  // most authoritative dated point on the topic — retrieval often buries it, so seed it directly.
  const entry = await resolveItem(question, context, parent);
  if (entry && !byDoc.has(entry.citation.split("/").slice(0, 2).join("/"))) {
    byDoc.set(`seed:${entry.item}`, { id: entry.citation, date: entry.effective_date, heading: `${cap(entry.item)} rate — ${entry.source_notif}` });
  }

  const all = [...byDoc.values()].sort((a, b) => a.date.localeCompare(b.date));
  const inWindow = all.filter((d) => d.date >= cutoffStr);

  // ≥2 dated docs in window → a real timeline (the only case we may narrate as a "change").
  if (inWindow.length >= 2) {
    const lines = inWindow.map((d) => `- ${d.date}: ${d.heading || "notification / circular"} [${d.id}]`);
    return {
      reply: [
        `Is topic pe pichhle ${months} mahine mein ye dated changes dikhte hain (government release date ke hisaab se, purane se naye):`,
        ...lines,
        "",
        "Har entry apni notification/circular se linked hai — exact badlaav us source mein hai.",
      ].join("\n"),
      abstained: false, mode: "timeline", citationIds: inWindow.map((d) => d.id), note: `${inWindow.length} dated docs`,
    };
  }

  // Exactly one dated doc in window → honest "just this one", not a false "no change".
  if (inWindow.length === 1) {
    const d = inWindow[0];
    return {
      reply: [
        `Is window (pichhle ${months} mahine) mein is topic pe ek hi dated document mila:`,
        `- ${d.date}: ${d.heading || "notification"} [${d.id}]`,
        "Isse purana koi aur dated change mujhe is window mein nahi dikha — poora historical comparison ke liye source dekhein.",
      ].join("\n"),
      abstained: false, mode: "one-doc", citationIds: [d.id], note: "1 dated doc in window",
    };
  }

  // Nothing in window but we do hold the topic → honest "no change in that window".
  if (all.length >= 1) {
    const latest = all[all.length - 1];
    return {
      reply: [
        `Is window (pichhle ${months} mahine) mein is topic pe mujhe koi naya change nahi dikha.`,
        `Sabse recent related document: ${latest.date} — ${latest.heading || "notification"} [${latest.id}].`,
        "Current exact position ke liye specific rate ya rule poochh sakte hain.",
      ].join("\n"),
      abstained: false, mode: "no-change", citationIds: [latest.id], note: "no change in window",
    };
  }
  return insufficient();
}

// insufficient — fewer than the two dated docs a timeline needs. We refuse to invent one.
function insufficient(): LaneOutcome {
  return {
    reply: "Is topic pe time-wise change dikhane ke liye mere paas do ya usse zyada dated notifications nahi hain, isliye main koi timeline nahi banaunga. Aap specific rate ya rule poochh sakte hain.",
    abstained: true, mode: "insufficient", citationIds: [], note: "<2 dated docs",
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
