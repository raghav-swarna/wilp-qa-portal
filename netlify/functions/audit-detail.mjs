// GET /api/audits/:id -> full audit detail (scores + history). A COUNSELOR may only view
// their own audits — enforced here, not just hidden in the UI.
import { query } from "./_lib/db.mjs";
import { requireUser, errorResponse, jsonResponse } from "./_lib/auth.mjs";
import { getAuditDetail } from "./_lib/audits.mjs";

export default async (req, context) => {
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);
  const r = await requireUser(req, query);
  if (r.error) return r.error;

  const id = Number(context.params.id);
  if (!id) return errorResponse("Invalid audit id.");
  const detail = await getAuditDetail(query, id);
  if (!detail) return errorResponse("Audit not found.", 404);

  if (r.user.role === "COUNSELOR" && detail.audit.counselor_id !== r.user.counselor_id) {
    return errorResponse("You don't have access to this audit.", 403);
  }
  return jsonResponse(detail);
};

export const config = { path: "/api/audits/:id" };
