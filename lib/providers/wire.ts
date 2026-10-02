import type Anthropic from "@anthropic-ai/sdk";

export type MessageInput = Anthropic.MessageCreateParamsNonStreaming;
export type ModelSpec = { provider: "openai" | "anthropic"; model: string; inputPrice: number; outputPrice: number; cachedPrice: number };
export const MAX_INPUT_BYTES = 96 * 1024;
export const MAX_OUTPUT_TOKENS = 2048;
export class ProviderError extends Error {
  readonly noRetry = true;
  constructor(readonly category: "input_bound" | "configuration" | "transport_unknown" | "provider_rejected" | "invalid_response" | "truncated" | "refusal", readonly upstreamStatus?: number) {
    super(`Model request failed: ${category}`); this.name = "ProviderError";
  }
}
const fail = () => { throw new ProviderError("input_bound"); };
function text(value: unknown): string { if (typeof value !== "string") return fail(); return value; }
function id(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return fail(); return value; }
function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some(b => b?.type !== "text")) return fail();
  return content.map(b => text(b.text)).join("\n");
}

export function modelSpec(requested: string): ModelSpec {
  const provider = process.env.GSTPILOT_PROVIDER ?? "openai";
  if (provider === "openai") {
    const model = process.env.GSTPILOT_OPENAI_MODEL ?? "gpt-4o-mini";
    if (model !== "gpt-4o-mini") throw new ProviderError("configuration");
    return { provider, model, inputPrice: .15, outputPrice: .60, cachedPrice: .075 };
  }
  if (provider !== "anthropic") throw new ProviderError("configuration");
  if (requested === "claude-sonnet-4-6") return { provider, model: requested, inputPrice: 3, outputPrice: 15, cachedPrice: .30 };
  if (requested === "claude-haiku-4-5-20251001") return { provider, model: requested, inputPrice: 1, outputPrice: 5, cachedPrice: .10 };
  throw new ProviderError("configuration");
}

/** Keep the app's text/tool DTO; never accept files, URLs, server tools or arbitrary hosts. */
export function toWire(input: MessageInput, spec: ModelSpec): Record<string, unknown> {
  if (input.stream || !Number.isInteger(input.max_tokens) || input.max_tokens < 1 || input.max_tokens > MAX_OUTPUT_TOKENS ||
      !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 32 ||
      (input.temperature != null && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1))) return fail();
  const system = input.system == null ? undefined : blocksText(input.system);
  const tools = input.tools?.map(t => {
    if (!("name" in t) || !("input_schema" in t) || t.type || t.input_schema.type !== "object") return fail();
    return { name: id(t.name), description: t.description == null ? "" : text(t.description), input_schema: t.input_schema };
  });
  if (tools && tools.length > 8) return fail();
  const normalized = input.messages.map(m => {
    if (!["user", "assistant"].includes(m.role)) return fail();
    const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    if (!Array.isArray(content) || content.length > 16) return fail();
    return { role: m.role, content: content.map(b => {
      if (b.type === "text") return { type: "text" as const, text: text(b.text) };
      if (b.type === "tool_use" && m.role === "assistant") {
        if (!b.input || typeof b.input !== "object" || Array.isArray(b.input)) return fail();
        return { type: "tool_use" as const, id: id(b.id), name: id(b.name), input: b.input };
      }
      if (b.type === "tool_result" && m.role === "user") return { type: "tool_result" as const, tool_use_id: id(b.tool_use_id), content: blocksText(b.content ?? "") };
      return fail();
    }) };
  });
  let wire: Record<string, unknown>;
  if (spec.provider === "anthropic") {
    wire = { model: spec.model, max_tokens: input.max_tokens, temperature: input.temperature ?? 0,
      ...(system == null ? {} : { system }), ...(tools?.length ? { tools } : {}), messages: normalized, stream: false };
  } else {
    const messages: Record<string, unknown>[] = system == null ? [] : [{ role: "system", content: system }];
    for (const m of normalized) {
      const words = m.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      const calls = m.content.filter(b => b.type === "tool_use").map(b => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      const results = m.content.filter(b => b.type === "tool_result");
      if (words || calls.length || !results.length) messages.push({ role: m.role, content: words || null, ...(calls.length ? { tool_calls: calls } : {}) });
      for (const b of results) messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
    }
    wire = { model: spec.model, messages, max_tokens: input.max_tokens, temperature: input.temperature ?? 0, stream: false,
      ...(tools?.length ? { tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })), parallel_tool_calls: false } : {}) };
  }
  if (Buffer.byteLength(JSON.stringify(wire)) > MAX_INPUT_BYTES) return fail();
  return wire;
}

export type Tokens = { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningOutputTokens: number; requestId?: string };
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e7;
export function tokensFrom(raw: any, provider: ModelSpec["provider"]): Tokens {
  const u = raw?.usage;
  const input = provider === "openai" ? u?.prompt_tokens : u?.input_tokens;
  const output = provider === "openai" ? u?.completion_tokens : u?.output_tokens;
  const cache = (provider === "openai" ? u?.prompt_tokens_details?.cached_tokens : u?.cache_read_input_tokens) ?? 0;
  const reasoning = (provider === "openai" ? u?.completion_tokens_details?.reasoning_tokens : u?.output_tokens_details?.thinking_tokens) ?? 0;
  // Explicit Anthropic requests never enable cache creation. Unexpected charged categories
  // stay uncertain instead of being under-counted as ordinary input.
  if (![input, output, cache, reasoning].every(count) || reasoning > output || (provider === "openai" && cache > input) || (provider === "anthropic" && u?.cache_creation_input_tokens)) throw new ProviderError("invalid_response");
  return { inputTokens: provider === "anthropic" ? input + cache : input, outputTokens: output, cachedInputTokens: cache, reasoningOutputTokens: reasoning };
}

/** Call only after durable settlement; malformed/truncated semantic output may still be billed. */
export function messageFrom(raw: any, spec: ModelSpec, tokens: Tokens): Anthropic.Message {
  let content: any[]; let stop: string;
  if (spec.provider === "openai") {
    const choice = raw?.choices?.[0]; const msg = choice?.message;
    if (choice?.finish_reason === "length") throw new ProviderError("truncated");
    if (choice?.finish_reason === "content_filter" || msg?.refusal) throw new ProviderError("refusal");
    if (!["stop", "tool_calls"].includes(choice?.finish_reason) || !msg) throw new ProviderError("invalid_response");
    content = [];
    if (typeof msg.content === "string" && msg.content) content.push({ type: "text", text: msg.content, citations: null });
    if (msg.tool_calls != null && (!Array.isArray(msg.tool_calls) || msg.tool_calls.length > 8)) throw new ProviderError("invalid_response");
    for (const call of msg.tool_calls ?? []) {
      let value; try { value = JSON.parse(call.function.arguments); } catch { throw new ProviderError("invalid_response"); }
      if (call.type !== "function" || !value || typeof value !== "object" || Array.isArray(value)) throw new ProviderError("invalid_response");
      content.push({ type: "tool_use", id: id(call.id), name: id(call.function.name), input: value });
    }
    stop = choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
  } else {
    if (raw?.stop_reason === "max_tokens") throw new ProviderError("truncated");
    if (raw?.stop_reason === "refusal") throw new ProviderError("refusal");
    if (!["end_turn", "tool_use", "stop_sequence"].includes(raw?.stop_reason) || !Array.isArray(raw.content)) throw new ProviderError("invalid_response");
    content = raw.content.map((b: any) => {
      if (b.type === "text" && typeof b.text === "string") return { type: "text", text: b.text, citations: null };
      if (b.type === "tool_use" && b.input && typeof b.input === "object" && !Array.isArray(b.input)) return { type: "tool_use", id: id(b.id), name: id(b.name), input: b.input };
      throw new ProviderError("invalid_response");
    }); stop = raw.stop_reason;
  }
  if (!content.length || content.length > 16) throw new ProviderError("invalid_response");
  return { id: typeof raw.id === "string" ? raw.id.slice(0, 200) : "provider-response", type: "message", role: "assistant", model: typeof raw.model === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(raw.model) ? raw.model : spec.model,
    content, stop_reason: stop, stop_sequence: null, container: null, stop_details: null,
    usage: { input_tokens: tokens.inputTokens, output_tokens: tokens.outputTokens, cache_read_input_tokens: tokens.cachedInputTokens,
      cache_creation_input_tokens: 0, cache_creation: null, inference_geo: null, output_tokens_details: null, server_tool_use: null, service_tier: null } } as Anthropic.Message;
}
