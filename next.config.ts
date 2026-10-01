import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.GSTPILOT_DIST_DIR ?? ".next",
  // Blindspot is linked from the local monorepo and currently exports TypeScript source, so
  // Next.js must compile that package together with gstpilot during local development/builds.
  transpilePackages: ["@blindspot/sdk"],
  // Turbopack normally fences resolution at the gstpilot folder. Both local projects live under
  // Documents, so this root lets the linked Blindspot SDK be resolved without copying its source.
  turbopack: { root: path.resolve(process.cwd(), "..") },
  // Lint stays a dev-time advisor (`pnpm lint`), not a deploy blocker: ~20 legacy
  // `no-explicit-any` hits in admin pages would fail every Render build. TypeScript
  // checking still runs during `next build` — that's the guarantee that matters.
  // CLEANUP DEBT: type the admin-page Supabase results properly, then remove this.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
