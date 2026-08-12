// Real authentication: bcrypt password hashing, signed httpOnly session cookies backed by
// a revocable `sessions` table (so logout actually invalidates the token server-side,
// unlike a bare stateless JWT). Every protected endpoint re-fetches the user row from the
// DB on each request rather than trusting cached claims, so a deactivated account or a
// role change takes effect immediately, not just after the token expires.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const COOKIE_NAME = "wilpqa_session";
const SESSION_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function secret() {
  // Netlify Functions expose env vars via the global `Netlify.env` object, not process.env.
  // The `typeof Netlify` guard lets this same file run under plain Node (local/PGlite tests)
  // by falling back to process.env there, since the `Netlify` global only exists at runtime.
  const s = (typeof Netlify !== "undefined" ? Netlify.env.get("AUTH_SECRET") : undefined) || process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set. Add it in Netlify project environment variables (Site configuration -> Environment variables) before deploying.");
  return s;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createSession(query, userId) {
  const jti = crypto.randomUUID();
  const now = new Date().toISOString();
  await query("INSERT INTO sessions (jti, user_id, created_at) VALUES ($1,$2,$3)", [jti, userId, now]);
  const token = jwt.sign({ sub: userId, jti }, secret(), { expiresIn: SESSION_DAYS + "d" });
  return token;
}

export async function revokeSession(query, jti) {
  await query("UPDATE sessions SET revoked_at = $1 WHERE jti = $2", [new Date().toISOString(), jti]);
}

export function sessionCookieHeader(token) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  const parts = header.split(";").map((p) => p.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

/** Returns { user, jti } for a valid, non-revoked session, or null. `user` is the full,
 *  freshly-read row from the DB (never a cached JWT claim) so deactivation/role changes
 *  apply immediately. */
export async function getSessionUser(req, query) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch (e) {
    return null;
  }
  const sessRes = await query("SELECT * FROM sessions WHERE jti = $1", [payload.jti]);
  const sess = sessRes.rows[0];
  if (!sess || sess.revoked_at) return null;
  const userRes = await query("SELECT * FROM users WHERE id = $1", [payload.sub]);
  const user = userRes.rows[0];
  if (!user || !user.active) return null;
  return { user, jti: payload.jti };
}

export function jsonResponse(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json" }, extraHeaders || {}),
  });
}
export function errorResponse(message, status) {
  return jsonResponse({ error: message }, status || 400);
}

/** requireUser: 401 if not signed in. requireRoles: also 403 if role not in the allowed list. */
export async function requireUser(req, query) {
  const session = await getSessionUser(req, query);
  if (!session) return { error: errorResponse("Not signed in.", 401) };
  return { user: session.user, jti: session.jti };
}
export async function requireRoles(req, query, roles) {
  const r = await requireUser(req, query);
  if (r.error) return r;
  if (!roles.includes(r.user.role)) return { error: errorResponse("You don't have permission to do that.", 403) };
  return r;
}

// ---- Login lockout (DB-backed, persists across function cold starts) ----
export async function checkLockout(query, email) {
  const res = await query("SELECT * FROM login_attempts WHERE email = $1", [email]);
  const rec = res.rows[0];
  if (!rec || !rec.locked_until) return { locked: false };
  if (new Date(rec.locked_until).getTime() > Date.now()) return { locked: true, until: rec.locked_until };
  return { locked: false };
}
export async function recordFailedLogin(query, email) {
  const res = await query("SELECT * FROM login_attempts WHERE email = $1", [email]);
  const rec = res.rows[0];
  const now = new Date().toISOString();
  if (!rec) {
    await query("INSERT INTO login_attempts (email, failed_count, locked_until, updated_at) VALUES ($1,1,NULL,$2)", [email, now]);
    return;
  }
  const failedCount = rec.failed_count + 1;
  const lockedUntil = failedCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : rec.locked_until;
  await query("UPDATE login_attempts SET failed_count = $1, locked_until = $2, updated_at = $3 WHERE email = $4", [failedCount, lockedUntil, now, email]);
}
export async function clearFailedLogins(query, email) {
  await query("UPDATE login_attempts SET failed_count = 0, locked_until = NULL, updated_at = $1 WHERE email = $2", [new Date().toISOString(), email]);
}
