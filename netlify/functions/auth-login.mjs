import { query } from "./_lib/db.mjs";
import { verifyPassword, createSession, sessionCookieHeader, jsonResponse, errorResponse, checkLockout, recordFailedLogin, clearFailedLogins } from "./_lib/auth.mjs";

export default async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  let body;
  try { body = await req.json(); } catch (e) { return errorResponse("Invalid request body."); }
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) return errorResponse("Email and password are required.");

  const lockout = await checkLockout(query, email);
  if (lockout.locked) {
    return errorResponse(`Too many failed attempts. Try again after ${new Date(lockout.until).toLocaleTimeString()}.`, 429);
  }

  const res = await query("SELECT * FROM users WHERE email = $1", [email]);
  const user = res.rows[0];
  if (!user || !user.active) {
    await recordFailedLogin(query, email);
    return errorResponse("Invalid email or password.", 401);
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordFailedLogin(query, email);
    return errorResponse("Invalid email or password.", 401);
  }
  await clearFailedLogins(query, email);

  const token = await createSession(query, user.id);
  const { password_hash, ...safeUser } = user;
  return jsonResponse(
    { user: safeUser },
    200,
    { "set-cookie": sessionCookieHeader(token) }
  );
};

export const config = { path: "/api/auth/login" };
