// Server-side Supabase client for GSTPilot.
// Supabase is our hosted Postgres database (plus auth, storage, and auto-generated APIs on top).
// This file creates ONE way to talk to it from server code — API routes, agents, ingestion scripts.
// It uses the service-role key, which bypasses all row-level security, so it must NEVER be
// imported into client-side (browser) code. Everything that touches law chunks goes through here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// We temporarily share a staging database with another project, so every table GSTPilot
// creates carries this prefix. All code must build table names from it (never hard-code
// "chunks") — when we move to a dedicated Supabase project, we change one string here.
export const TABLE_PREFIX = "gstpilot_";

// Cache the client across calls so we don't rebuild the HTTP connection pool on every request.
let cached: SupabaseClient | null = null;

// Returns the server-side Supabase client, creating it on first use.
// Why lazy (a function, not a top-level constant): reading env vars at import time crashes
// builds and scripts that load this file before .env exists; failing at call time gives a
// clear, actionable error exactly where the database is actually needed.
export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill them in."
    );
  }

  cached = createClient(url, key, {
    auth: {
      // This client is a server process, not a logged-in person — no session to persist.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
