import { query } from "./_lib/db.mjs";
import { getSessionUser, jsonResponse, errorResponse } from "./_lib/auth.mjs";

export default async (req) => {
  const session = await getSessionUser(req, query);
  if (!session) return errorResponse("Not signed in.", 401);
  const { password_hash, ...safeUser } = session.user;
  return jsonResponse({ user: safeUser });
};

export const config = { path: "/api/auth/me" };
