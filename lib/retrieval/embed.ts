// Hosted retrieval is explicitly SQL keyword search against the reviewed corpus.
// Preserve the interface for existing ingestion callers, but never download a
// local model or submit an unmetered embedding request from this release.
export { EMBEDDING } from "./config";
import { requireExecution } from "../server/execution";
export interface EmbeddingProvider { embed(texts: string[]): Promise<number[][]>; }
class DisabledEmbeddings implements EmbeddingProvider {
  async embed(_texts: string[]): Promise<number[][]> {
    requireExecution();
    throw new Error("Dense embeddings are not enabled; use keyword retrieval.");
  }
}
export class LocalBgeM3 extends DisabledEmbeddings {}
export class HfApiBgeM3 extends DisabledEmbeddings {}
export function getEmbedder(): EmbeddingProvider { return new DisabledEmbeddings(); }

/** The context line + text that actually gets embedded for a chunk. */
export function embeddingInput(chunk: { act: string; heading_path: string[]; text: string }): string {
  return `${chunk.act} | ${chunk.heading_path.join(" › ")}\n${chunk.text}`;
}
