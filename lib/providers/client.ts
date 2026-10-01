import type SDK from "@anthropic-ai/sdk";
import { requireExecution, isPrepared, isMock } from "../server/execution";
import { reserve, markDispatched, settle, uncertain } from "../server/usage";
import { fixtureText } from "./fixtures";
import { providerPost } from "./transport";
import { messageFrom, modelSpec, toWire, tokensFrom, ProviderError, type MessageInput } from "./wire";
export { ProviderError } from "./wire";

/** Anthropic-compatible text/tool surface keeps the existing gates/calculators intact.
 * One invocation means at most one HTTP dispatch. Keys and actor state are never cached. */
export class ProviderClient {
  messages = { create: async (input: MessageInput): Promise<SDK.Message> => {
    const actor = requireExecution();
    const spec = modelSpec(input.model); const wire = toWire(input, spec);
    if (isPrepared() || isMock()) {
      return messageFrom({ id: "mock-response", choices: [{ finish_reason: "stop", message: { content: fixtureText(input) } }] },
        { ...spec, provider: "openai" }, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 });
    }
    const key = spec.provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
    if (!key) throw new ProviderError("configuration");
    const body = JSON.stringify(wire);
    const reservation = await reserve({ provider: spec.provider, model: spec.model, inputBytes: Buffer.byteLength(body),
      maxOutputTokens: input.max_tokens, inputPrice: spec.inputPrice, outputPrice: spec.outputPrice, cachedPrice: spec.cachedPrice });
    // Revoked/expired sessions are checked immediately before dispatch. The durable
    // hook releases a still-undispatched reservation when that check rejects it.
    await markDispatched(reservation);
    let settled = false;
    try {
      const { raw, requestId } = await providerPost(spec.provider, key, body, actor.deadlineMs);
      const returnedModel = (raw as { model?: unknown })?.model;
      const providerModel = typeof returnedModel === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(returnedModel) ? returnedModel : undefined;
      const usage = { ...tokensFrom(raw, spec.provider), ...(requestId ? { requestId } : {}), ...(providerModel ? { providerModel } : {}) };
      await settle(reservation, usage); settled = true;
      // Truncation, malformed function arguments or later application JSON validation
      // cannot erase the real tokens already durably accounted for above.
      return messageFrom(raw, spec, usage);
    } catch (error) {
      if (!settled) await uncertain(reservation);
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("transport_unknown");
    }
  } };
}
export namespace ProviderClient {
  export type Tool = SDK.Tool;
  export type MessageParam = SDK.MessageParam;
  export type ToolResultBlockParam = SDK.ToolResultBlockParam;
}

export default ProviderClient;
