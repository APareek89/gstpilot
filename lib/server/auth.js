import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getToken } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { query, transaction, ownerId } from "./db";
import { HttpError, json, readJson, route } from "./http.js";
import { authSecret, cookie, cookies, csrfToken, limit, origin, peer, requireCsrf, secureCookies } from "./security";

const dummyHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);
const SESSION_SECONDS = 7 * 86400;
function sessionCookie() { return secureCookies() ? "__Secure-gstpilot-session" : "gstpilot-session"; }

export function credentialsInput(value) {
  const email = typeof value?.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value?.password === "string" ? value.password : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password) > 72) throw new HttpError(400, "Use a valid email and a password of at least 12 characters, up to 72 UTF-8 bytes.");
  return { email, password };
}

export async function activeSession(id, sid) {
  if (!id || !sid) return null;
  try { ownerId(id); ownerId(sid); } catch { return null; }
  const result = await query(`SELECT u.id,u.email,s.id AS sid FROM gstpilot_users u JOIN gstpilot_sessions s ON s.owner_id=u.id
    WHERE u.id=$1 AND s.id=$2 AND NOT u.disabled AND s.revoked_at IS NULL AND s.expires_at>now()`, [id, sid]);
  return result.rows[0] || null;
}

async function authorize(value, request) {
  await limit(`login-ip:${peer(request)}`, 30, 900);
  let input;
  try { input = credentialsInput(value); } catch { return null; }
  await limit(`login-email:${input.email}`, 15, 900);
  const user = (await query("SELECT id,email,password_hash,disabled FROM gstpilot_users WHERE email=$1", [input.email])).rows[0];
  const valid = await bcrypt.compare(input.password, user?.password_hash || dummyHash);
  if (!user || !valid || user.disabled) return null;
  const sid = randomUUID();
  await transaction(async client => {
    await client.query("SELECT id FROM gstpilot_users WHERE id=$1 FOR UPDATE", [user.id]);
    await client.query("DELETE FROM gstpilot_sessions s WHERE owner_id=$1 AND (expires_at<now() OR revoked_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM gstpilot_usage u WHERE u.session_id=s.id)", [user.id]);
    const current = (await client.query("SELECT count(*)::int AS count FROM gstpilot_sessions WHERE owner_id=$1 AND revoked_at IS NULL AND expires_at>now()", [user.id])).rows[0].count;
    if (current >= 20) throw new HttpError(429, "Sign out of another session before signing in again.");
    await client.query("INSERT INTO gstpilot_sessions(id,owner_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [sid, user.id]);
  });
  return { id: user.id, email: user.email, sid };
}

// Lazy configuration keeps build-time imports independent of deployment secrets.
export const { handlers, auth } = NextAuth(() => ({
  secret: authSecret(),
  trustHost: true,
  useSecureCookies: secureCookies(),
  session: { strategy: "jwt", maxAge: SESSION_SECONDS },
  cookies: { sessionToken: { name: sessionCookie(), options: { httpOnly: true, sameSite: "lax", path: "/", secure: secureCookies() } } },
  providers: [Credentials({ credentials: { email: { type: "email" }, password: { type: "password" } }, authorize })],
  callbacks: {
    async jwt({ token, user }) { if (user) { token.id = user.id; token.sid = user.sid; } return token; },
    async session({ session, token }) {
      const actor = await activeSession(token.id, token.sid);
      return { ...session, user: actor ? { id: actor.id, email: actor.email } : undefined };
    },
    async redirect({ url }) {
      const base = origin();
      try { const target = new URL(url, base); return target.origin === base ? target.toString() : base; } catch { return base; }
    },
  },
  events: { async signOut(message) { const token = message.token; if (token?.id && token?.sid) await query("UPDATE gstpilot_sessions SET revoked_at=now() WHERE id=$1 AND owner_id=$2", [ownerId(token.sid), ownerId(token.id)]); } },
  logger: { error() {}, warn() {}, debug() {} },
}));

export async function actorFor(req) {
  const token = await getToken({ req, secret: authSecret(), cookieName: sessionCookie(), salt: sessionCookie(), secureCookie: secureCookies() });
  return token ? activeSession(token.id, token.sid) : null;
}
export async function requireActor(req, { write = false } = {}) {
  const actor = await actorFor(req);
  if (!actor) throw new HttpError(401, "Sign in to continue.");
  const expectedOwner = req.headers.get("x-gstpilot-owner");
  if (expectedOwner && expectedOwner !== actor.id) throw new HttpError(409,"session_expired");
  if (write) requireCsrf(req, actor);
  return actor;
}

export const sessionResponse = route(async req => {
  const actor = await actorFor(req);
  const previous = cookies(req);
  const subject = actor ? `session:${actor.sid}` : 'anonymous-signup';
  const csrf = csrfToken(previous.gstpilot_csrf, subject);
  const response = json({ enabled: true, user: actor ? { id: actor.id, email: actor.email } : null, csrf, mode: process.env.GSTPILOT_MOCK_MODE === "1" ? "mock" : "live" });
  response.headers.append("Set-Cookie", cookie("gstpilot_csrf", csrf, 48 * 3600));
  return response;
});

export const signupResponse = route(async req => {
  const actor = await actorFor(req);
  const body = await readJson(req, 4096);
  const headers = new Headers(req.headers);
  if (!headers.has("x-gstpilot-csrf") && typeof body.csrf === "string") headers.set("x-gstpilot-csrf", body.csrf);
  requireCsrf(new Request(req.url, {headers}), actor);
  await limit(`signup-ip:${peer(req)}`, 10, 3600);
  const { email, password } = credentialsInput(body);
  const hash = await bcrypt.hash(password, 12);
  try {
    await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(74435002)");
      if ((await client.query("SELECT count(*)::int AS count FROM gstpilot_users")).rows[0].count >= 1000) throw new HttpError(429, "Account capacity is reached. Please try later.");
      const id = randomUUID();
      await client.query("INSERT INTO gstpilot_users(id,email,password_hash) VALUES($1,$2,$3)", [id, email, hash]);
      await client.query("INSERT INTO gstpilot_user_profile(user_id,email) VALUES($1,$2)", [id,email]);
    });
  } catch (error) { if (error.code === "23505") throw new HttpError(409, "An account already exists for this email."); throw error; }
  return json({ ok: true }, 201);
});
