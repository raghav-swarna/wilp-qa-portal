import { query } from "./_lib/db.mjs";
import { requireUser, verifyPassword, hashPassword, jsonResponse, errorResponse } from "./_lib/auth.mjs";

export default async (req) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  const r = await requireUser(req, query);
  if (r.error) return r.error;
  let body;
  try { body = await req.json(); } catch (e) { return errorResponse("Invalid request body."); }
  const { currentPassword, newPassword } = body;
  if (!newPassword || newPassword.length < 8) return errorResponse("New password must be at least 8 characters.");
  const ok = await verifyPassword(currentPassword || "", r.user.password_hash);
  if (!ok) return errorResponse("Current password is incorrect.", 401);
  const newHash = await hashPassword(newPassword);
  await query("UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2", [newHash, r.user.id]);
  return jsonResponse({ ok: true });
};

export const config = { path: "/api/auth/change-password" };
