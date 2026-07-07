// Langfuse client — the observability side of evals and (from Phase 5) every model call.
// One factory so credentials are read in exactly one place. All Langfuse writes are
// best-effort: observability failing must never break the thing it observes.

import { Langfuse } from "langfuse";

let client: Langfuse | null = null;

export function getLangfuse(): Langfuse {
  client ??= new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
  });
  return client;
}
