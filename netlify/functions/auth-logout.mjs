import { query } from "./_lib/db.mjs";
import { getSessionUser, revokeSession, clearCookieHeader, jsonResponse } from "./_lib/auth.mjs";

export default async (req) => {
  const session = await getSessionUser(req, query);
  if (session) await revokeSession(query, session.jti);
  return jsonResponse({ ok: true }, 200, { "set-cookie": clearCookieHeader() });
};

export const config = { path: "/api/auth/logout" };
