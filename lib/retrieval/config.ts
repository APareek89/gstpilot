// Retrieval configuration — the PINNED embedding model.
// Pinning matters because an embedding is only comparable to embeddings from the SAME model
// weights: if the model silently updates, new query vectors and old chunk vectors live in
// subtly different meaning-spaces and search quality decays with no error anywhere. Changing
// anything below is a real migration: re-embed every chunk, re-run the eval set, then ship.

export const EMBEDDING = {
  provider: "local-transformers" as const,
  // bge-m3: strongest open multilingual retriever (handles Hinglish queries against English
  // legal text), natively 1024-dim — matches our vector(1024) column exactly.
  modelId: "Xenova/bge-m3",
  revision: "main", // TODO: pin to a commit hash after the golden-set eval blesses this version
  dimensions: 1024,
  // bge-m3 is instruction-free: queries and documents embed the same way, no prefix needed.
} as const;
