// POST /api/audits/:id/correct — amend a submitted audit's qa_comments or coaching_priority.
// Submitted audits are otherwise locked; every correction is written to audit_history with a
// required reason, never a silent edit. QA_ANALYST/ADMIN only.
import { query } from "./_lib/db.mjs";
import { requireRoles, errorResponse, jsonResponse } from "./_lib/auth.mjs";
import { QA_AND_ABOVE } from "./_lib/guard.mjs";
import { correctAuditAfterSubmission } from "./_lib/audits.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  const r = await requireRoles(req, query, QA_AND_ABOVE);
  if (r.error) return r.error;

  const id = Number(context.params.id);
  if (!id) return errorResponse("Invalid audit id.");
  let body;
  try { body = await req.json(); } catch (e) { return errorResponse("Invalid request body."); }
  if (!body.field || body.newValue === undefined || !body.reason) {
    return errorResponse("field, newValue, and reason are all required.");
  }
  try {
    await correctAuditAfterSubmission(query, id, body.field, body.newValue, body.reason, r.user.id);
    return jsonResponse({ ok: true });
  } catch (e) {
    return errorResponse(e.message || "Failed to correct audit.", 400);
  }
};

export const config = { path: "/api/audits/:id/correct" };
