// Langfuse client — the observability side of evals and (from Phase 5) every model call.
// One factory so credentials are read in exactly one place. All Langfuse writes are
// best-effort: observability failing must never break the thing it observes.

import { Blindspot, type NodeRequirements } from "@blindspot/sdk";
import { Langfuse } from "langfuse";
import { randomUUID } from "node:crypto";
import { modelSpec } from "../providers/wire";

// Hosted traces stay in the owner-scoped PostgreSQL store. No prompts, account
// identities or provider errors leave through optional third-party telemetry.
const externalTelemetry = () => process.env.NODE_ENV !== "production" && process.env.GSTPILOT_EXTERNAL_TELEMETRY === "1";
function localTrace(traceId = randomUUID()): any {
  const trace: any = { id: randomUUID(), traceId, event() {}, end() {}, update() {}, score() {} };
  trace.span = () => localTrace(traceId); trace.generation = () => localTrace(traceId);
  return trace;
}
const localTelemetry = { trace: () => localTrace(), flushAsync: async () => {}, shutdownAsync: async () => {} } as unknown as Langfuse;

// Store the client on globalThis, NOT a plain module variable. In Next.js dev, editing any file
// hot-reloads modules and RESETS a plain `let client` — which orphans the old client's queued
// events (the trace gets an id and is returned to the UI, but its flush never lands → "Trace not
// found" in Langfuse). Pinning it to globalThis means every hot-reloaded copy of this module shares
// ONE client, so create-trace and flush always hit the same queue.
const g = globalThis as unknown as {
  __gstpilot_lf?: Langfuse;
  __gstpilot_blindspot?: Blindspot;
};

// A "parent" is anything a child observation can hang under: the turn's trace, or a span inside
// it. We derive the types from the SDK (no reliance on named exports) so a generation nests under
// whichever we pass. This is what turns the flat event list into a real NODE TREE in Langfuse.
type LfTrace = ReturnType<Langfuse["trace"]>;
type LfSpan = ReturnType<LfTrace["span"]>;
export type LfParent = LfTrace | LfSpan;

// recordGeneration — run a model call AND record it as a Langfuse generation node under `parent`,
// capturing model + input + output + token usage so the call is visible (and costed) in the trace
// tree. Best-effort: with no parent it just runs `fn` (standalone/eval paths keep working). The
// `extract` maps the call's result to what the node should show — kept generic so every model call
// (haiku classifier, sonnet generation, …) uses the same one helper.
export async function recordGeneration<T>(
  parent: LfParent | undefined,
  meta: { name: string; model: string; input: unknown; requirements?: NodeRequirements },
  fn: () => Promise<T>,
  extract?: (r: T) => { output?: unknown; inputTokens?: number; outputTokens?: number }
): Promise<T> {
  const actualModel = modelSpec(meta.model);
  const gen = parent?.generation({ name: meta.name, model: actualModel.model, ...(externalTelemetry() ? { input: meta.input } : {}) });
  try {
    // Keep Langfuse as gstpilot's detailed trace while also sending the same generation timing,
    // model and token counts to Blindspot. The operation is invoked exactly once; Blindspot is
    // best-effort and its SDK never changes which provider or model gstpilot calls.
    const r = parent && externalTelemetry()
      ? await getBlindspot().observeGeneration(
          {
            executionId: parent.traceId,
            // Blindspot currently records the turn-level pipeline root, so every model call hangs
            // from that stable root. Preserve the richer Langfuse parent separately as metadata.
            parentId: parent.traceId,
            node: meta.name,
            provider: actualModel.provider,
            model: actualModel.model,
            input: meta.input,
            requirements: {
              inputModalities: ["text"],
              outputModalities: ["text"],
              ...meta.requirements,
            },
            metadata: { langfuseTraceId: parent.traceId, langfuseParentId: parent.id },
          },
          fn,
          extract,
        )
      : await fn();
    const e = extract?.(r);
    gen?.end({
      ...(externalTelemetry() ? { output: e?.output } : {}),
      ...(e && (e.inputTokens != null || e.outputTokens != null)
        ? { usageDetails: { input: e.inputTokens ?? 0, output: e.outputTokens ?? 0 } }
        : {}),
    });
    return r;
  } catch (err) {
    gen?.end({ level: "ERROR", statusMessage: "Model operation failed" });
    throw err;
  }
}

// One process-wide Blindspot client survives Next.js development hot reloads, just like the
// Langfuse client above. Environment variables decide whether telemetry is enabled and whether
// only metadata, inputs, or full input/output content may leave gstpilot.
export function getBlindspot(): Blindspot {
  g.__gstpilot_blindspot ??= Blindspot.fromEnv({
    workflow: "gstpilot",
    framework: "custom-nextjs-agent",
    language: "typescript",
    onError: (error) => console.warn(`[blindspot] ${error.message}`),
  });
  return g.__gstpilot_blindspot;
}

// Start the turn-level agent span before gstpilot calls any model. Completing it marks the whole
// Blindspot execution terminal and flushes queued child generations, so a finished user request
// cannot remain misleadingly "running" merely because telemetry was still buffered.
export function beginBlindspotExecution(
  executionId: string,
  input: unknown,
  sessionId?: string,
) {
  if (!externalTelemetry()) return { complete(_output: unknown) {} };
  const client = getBlindspot();
  const root = client.span({
    id: executionId,
    executionId,
    sessionId,
    node: "pipeline",
    kind: "agent",
    input,
    metadata: { langfuseTraceId: executionId },
  });
  let ended = false;

  return {
    // Idempotence protects future callers from accidentally ending the same execution twice.
    complete(output: unknown) {
      if (ended) return;
      ended = true;
      const endedAt = new Date();
      root.end({
        status: "ok",
        output,
        executionStatus: "completed",
        executionEndedAt: endedAt,
      });
      // Delivery continues in the background: an observability outage must never add the SDK's
      // retry/timeout window to the GST answer the user is waiting for.
      void client.flush();
    },
  };
}

export function getLangfuse(): Langfuse {
  if (!externalTelemetry()) return localTelemetry;
  g.__gstpilot_lf ??= new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
  });
  return g.__gstpilot_lf;
}

export function langfuseHost(): string {
  return process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";
}

// Langfuse CLOUD trace URLs require the project segment — /project/<id>/traces/<id>. A bare
// /traces/<id> 404s (that was the broken link). The project id isn't in our env, but Langfuse
// exposes it via the public API using the keys we already have; we fetch it ONCE and cache it.
// Server-side only (uses the secret key). Env var LANGFUSE_PROJECT_ID short-circuits the fetch.
let cachedProjectId: string | null | undefined;
export async function getLangfuseProjectId(): Promise<string | null> {
  if (!externalTelemetry()) return null;
  if (cachedProjectId !== undefined) return cachedProjectId;
  if (process.env.LANGFUSE_PROJECT_ID) return (cachedProjectId = process.env.LANGFUSE_PROJECT_ID);
  try {
    const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
    const res = await fetch(`${langfuseHost()}/api/public/projects`, { headers: { Authorization: `Basic ${auth}` } });
    const j = (await res.json()) as { data?: { id: string }[] };
    return (cachedProjectId = j?.data?.[0]?.id ?? null);
  } catch {
    return (cachedProjectId = null); // fall back to the bare URL rather than throw
  }
}

// The correct, clickable trace URL. Falls back to the (imperfect) bare URL only if the project
// id can't be resolved — never returns nothing.
export async function langfuseTraceUrl(traceId: string): Promise<string> {
  if (!externalTelemetry()) return "";
  const pid = await getLangfuseProjectId();
  return pid ? `${langfuseHost()}/project/${pid}/traces/${traceId}` : `${langfuseHost()}/traces/${traceId}`;
}
