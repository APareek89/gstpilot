const loopback = (value: string) => ['localhost','127.0.0.1','::1','[::1]'].includes(value);
export function localPreview() {
  if (process.env.GSTPILOT_LOCAL_PREVIEW !== '1') return false;
  const origin = new URL(process.env.PUBLIC_ORIGIN || '');
  const db = new URL(process.env.DATABASE_URL || '');
  if (origin.origin !== process.env.PUBLIC_ORIGIN || origin.protocol !== 'http:' || !loopback(origin.hostname) || !loopback(db.hostname) || process.env.GSTPILOT_MOCK_MODE !== '1' || process.env.GSTPILOT_BIND_HOST !== '127.0.0.1' || ['OPENAI_API_KEY','ANTHROPIC_API_KEY','HF_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].some(k=>process.env[k])) throw new Error('Local preview requires isolated loopback services and no provider keys.');
  return true;
}
