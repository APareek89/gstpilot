// Retrieval configuration — the PINNED embedding model.
// Pinning matters because an embedding is only comparable to embeddings from the SAME model
// weights: if the model silently updates, new query vectors and old chunk vectors live in
// subtly different meaning-spaces and search quality decays with no error anywhere. Changing
// anything below is a real migration: re-embed every chunk, re-run the eval set, then ship.

export const EMBEDDING = {
  // Which implementation serves embeddings is an ENV decision, not a code decision:
  //   EMBEDDINGS_PROVIDER unset/"local" → bge-m3 runs in-process (dev default; ~1.5GB RAM)
  //   EMBEDDINGS_PROVIDER="hf-api"      → the SAME bge-m3, served by Hugging Face's Inference
  //                                       API (needs HF_API_KEY) — this is what lets the app
  //                                       fit Render's free 512MB instance for the portfolio
  //                                       deploy. Same model = same vector space = the 1064
  //                                       chunk vectors in Supabase stay valid, NO re-embedding.
  provider: "local-transformers" as const,
  // bge-m3: strongest open multilingual retriever (handles Hinglish queries against English
  // legal text), natively 1024-dim — matches our vector(1024) column exactly.
  modelId: "Xenova/bge-m3",        // the ONNX port used by the local path
  apiModelId: "BAAI/bge-m3",       // the original weights the ONNX port was converted from —
                                   // what HF's API serves; same space, quantization-level diffs only
  revision: "main", // TODO: pin to a commit hash after the golden-set eval blesses this version
  dimensions: 1024,
  // bge-m3 is instruction-free: queries and documents embed the same way, no prefix needed.
} as const;
