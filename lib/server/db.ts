import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { readFile } from 'node:fs/promises';
import { localPreview } from './runtime';
import { HttpError } from './http';
let pool: pg.Pool | undefined;
let starting: Promise<pg.Pool> | undefined;
export function ownerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400,'Invalid resource identifier.');
  return value.toLowerCase();
}
async function initialize() {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_NAME) throw new Error('Database configuration is required.');
  if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Legacy database configuration is not supported.');
  const url = new URL(process.env.DATABASE_URL); const preview = localPreview();
  let ssl: false | {rejectUnauthorized: true, ca: string};
  if (process.env.DATABASE_SSL === 'disable') {
    if ((process.env.NODE_ENV === 'production' && !preview) || !['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)) throw new Error('TLS is required.');
    ssl = false;
  } else {
    if (!process.env.DATABASE_SSL_CA_FILE) throw new Error('Database CA is required.');
    ssl = {rejectUnauthorized:true,ca:await readFile(process.env.DATABASE_SSL_CA_FILE,'utf8')};
  }
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('ssl')) url.searchParams.delete(key);
  const candidate = new pg.Pool({connectionString:url.toString(),ssl,max:6,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,statement_timeout:10000});
  let client: PoolClient | undefined;
  try {
    client = await candidate.connect();
    const row = (await client.query(`select current_database() db,r.rolsuper,r.rolbypassrls,has_schema_privilege(current_user,'public','CREATE') can_create from pg_roles r where rolname=current_user`)).rows[0];
    if (row.db !== process.env.DATABASE_NAME || row.rolsuper || row.rolbypassrls || row.can_create) throw new Error('Unsafe database identity.');
    if (!(await client.query("select version from gstpilot_portfolio_schema where version=1")).rowCount) throw new Error('Database migration is required.');
    if ((await client.query("select has_table_privilege(current_user,'gstpilot_legal_chunks','INSERT,UPDATE,DELETE,TRUNCATE') writable")).rows[0].writable) throw new Error('Shared law corpus must be read-only.');
    pool = candidate; return candidate;
  } catch (e) { client?.release(); client = undefined; await candidate.end(); throw e; }
  finally { client?.release(); }
}
export async function database() {
  if (!starting) starting=initialize().catch(e=>{starting=undefined;throw e;});
  return starting;
}
export async function query<T extends QueryResultRow = any>(sql: string, values: unknown[] = []) { return (await database()).query<T>(sql,values); }
export async function transaction<T>(action:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await (await database()).connect();
  try { await client.query('BEGIN'); const value=await action(client); await client.query('COMMIT');return value; }
  catch(e) { await client.query('ROLLBACK');throw e; } finally {client.release();}
}
export async function closeDatabase(){ const old=pool;pool=undefined;starting=undefined;await old?.end(); }
