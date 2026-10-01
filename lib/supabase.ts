/** Historical CLI import shim. Public runtime uses explicit PostgreSQL repositories.
 * This deliberately exposes no Supabase connection or credentials. */
export const TABLE_PREFIX='gstpilot_';
export function getServiceClient(): any {
  throw new Error('The legacy Supabase connector is retired. Corpus writes require separately approved PostgreSQL ingestion tooling.');
}
