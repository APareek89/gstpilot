import { ProviderError } from "./wire";
export const RESPONSE_BYTES = 512 * 1024;
export const DEADLINE_MS = 45_000;
/** Node fetch exposes decoded bytes. Bound those bytes, including error responses;
 * don't rewrap compressed headers and accidentally decompress them a second time. */
export async function providerPost(provider: "openai" | "anthropic", key: string, body: string, overallDeadline = Date.now() + DEADLINE_MS): Promise<{ raw: unknown; requestId?: string }> {
  const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages";
  const remaining = Math.min(DEADLINE_MS, overallDeadline - Date.now());
  if (remaining <= 0) throw new ProviderError("transport_unknown");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new ProviderError("transport_unknown")), { once: true }));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await Promise.race([fetch(url, { method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "identity",
        ...(provider === "openai" ? { Authorization: `Bearer ${key}` } : { "x-api-key": key, "anthropic-version": "2023-06-01" }) }, body }), deadline]);
    if (!res.body || !["", "identity", "gzip", "br", "deflate"].includes(res.headers.get("content-encoding") ?? "")) throw new ProviderError("transport_unknown");
    reader = res.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      total += value.byteLength; if (total > RESPONSE_BYTES) throw new ProviderError("transport_unknown"); chunks.push(value);
    }
    if (!res.ok) throw new ProviderError("provider_rejected");
    let raw: unknown; try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProviderError("invalid_response"); }
    const requestId = (res.headers.get("x-request-id") ?? res.headers.get("request-id") ?? "").match(/^[A-Za-z0-9._:-]{1,200}$/)?.[0];
    return { raw, requestId };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("transport_unknown");
  } finally {
    clearTimeout(timer); void reader?.cancel().catch(() => {}); controller.abort();
  }
}
