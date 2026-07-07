// Setup verifier for GSTPilot. Run with: pnpm check-setup
// Confirms the four external services this project depends on are actually wired up:
// (1) Supabase is reachable, (2) the pgvector extension is enabled there,
// (3) the Anthropic API key works (cheapest possible 1-token call),
// (4) Langfuse keys are present. Green across the board = Phase 0 infrastructure done.

import "dotenv/config"; // loads .env into process.env before anything reads it
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// Small helper to keep the report readable: prints ✓/✗ plus a hint on failure.
function report(name: string, ok: boolean, detail: string): boolean {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

// Check 1: can we reach the Supabase project at all?
// We hit its REST endpoint with our key; any authenticated HTTP response means the
// project exists, DNS resolves, and the key is at least well-formed.
async function checkSupabaseReachable(url: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    return report("Supabase reachable", res.ok, res.ok ? url : `HTTP ${res.status} — check SUPABASE_URL and key`);
  } catch (e) {
    return report("Supabase reachable", false, `network error: ${(e as Error).message}`);
  }
}

// Check 2: is pgvector enabled? Calls the gstpilot_pgvector_enabled() helper that migration
// 0001 created (gstpilot_ prefix because we share a staging database with another project).
// If the function itself is missing, the migration hasn't been applied yet —
// that's a setup step, not a code bug, so the hint says exactly that.
async function checkPgvector(url: string, key: string): Promise<boolean> {
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("gstpilot_pgvector_enabled");
  if (error) {
    const missingFn = error.message.toLowerCase().includes("function");
    return report(
      "pgvector enabled",
      false,
      missingFn
        ? "helper function not found — run: pnpm migrate"
        : error.message
    );
  }
  return report("pgvector enabled", data === true, data === true ? "" : "extension not installed");
}

// Check 3: does the Anthropic key actually work? We ask the cheapest model for a
// single token — costs a fraction of a paisa, but proves auth end-to-end
// (a malformed or revoked key fails here, not deep inside Phase 5).
async function checkAnthropic(): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return report("Anthropic key valid", false, "ANTHROPIC_API_KEY missing in .env");
  try {
    const anthropic = new Anthropic();
    await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return report("Anthropic key valid", true, "1-token test call succeeded");
  } catch (e) {
    return report("Anthropic key valid", false, (e as Error).message);
  }
}

// Check 4: Langfuse keys present. We only check presence + expected prefixes here —
// Langfuse verifies them on first real trace, and we don't want setup to depend on
// their ingestion endpoint being up.
function checkLangfuse(): boolean {
  const pub = process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const sec = process.env.LANGFUSE_SECRET_KEY ?? "";
  const ok = pub.startsWith("pk-lf-") && sec.startsWith("sk-lf-");
  return report(
    "Langfuse keys present",
    ok,
    ok ? "" : "expected LANGFUSE_PUBLIC_KEY (pk-lf-…) and LANGFUSE_SECRET_KEY (sk-lf-…) in .env"
  );
}

async function main() {
  console.log("GSTPilot setup check\n");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let allOk = true;
  if (!url || !key) {
    allOk = report("Supabase reachable", false, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env");
    report("pgvector enabled", false, "skipped (no Supabase credentials)");
  } else {
    const reachable = await checkSupabaseReachable(url, key);
    allOk = reachable && allOk;
    allOk = (reachable ? await checkPgvector(url, key) : report("pgvector enabled", false, "skipped (unreachable)")) && allOk;
  }
  allOk = (await checkAnthropic()) && allOk;
  allOk = checkLangfuse() && allOk;

  console.log(allOk ? "\nAll checks passed — Phase 0 infrastructure is live." : "\nSome checks failed — fix the ✗ items above and re-run: pnpm check-setup");
  process.exit(allOk ? 0 : 1);
}

main();
