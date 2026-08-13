// GET  /api/users -> list all login accounts (ADMIN only — this is more sensitive than the
//                     counselor roster, since it includes who can sign in and as what role).
// POST /api/users -> create a new login account (ADMIN only). The admin sets an initial
//                     password directly; must_change_password is always forced TRUE so the
//                     new user is prompted to set their own on first login.
import { query } from "./_lib/db.mjs";
import { requireRoles, errorResponse, jsonResponse } from "./_lib/auth.mjs";
import { ADMIN_ONLY } from "./_lib/guard.mjs";
import { listUsers, createUser } from "./_lib/users.mjs";

export default async (req) => {
  const r = await requireRoles(req, query, ADMIN_ONLY);
  if (r.error) return r.error;

  if (req.method === "GET") {
    const rows = await listUsers(query);
    return jsonResponse({ rows });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) { return errorResponse("Invalid request body."); }
    try {
      const user = await createUser(query, body);
      return jsonResponse({ user }, 201);
    } catch (e) {
      return errorResponse(e.message || "Failed to create user.", 400);
    }
  }

  return errorResponse("Method not allowed", 405);
};

export const config = { path: "/api/users" };
