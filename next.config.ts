import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedding model runs as a native Node module (onnxruntime) inside server
  // components — it must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
