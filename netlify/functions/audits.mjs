// GET  /api/audits  -> list (paginated, filterable) — any signed-in user, but a COUNSELOR is
//                      always restricted server-side to their own counselor_id regardless of
//                      what query params they send (the demo only hid this client-side).
// POST /api/audits  -> create + submit a fully-scored audit — QA_ANALYST/ADMIN only.
import { query } from "./_lib/db.mjs";
import { requireUser, requireRoles, errorResponse, jsonResponse } from "./_lib/auth.mjs";
import { QA_AND_ABOVE } from "./_lib/guard.mjs";
import { listAudits, createAndSubmitAudit } from "./_lib/audits.mjs";

export default async (req) => {
  if (req.method === "GET") {
    const r = await requireUser(req, query);
    if (r.error) return r.error;
    const url = new URL(req.url);
    const filters = {
      status: url.searchParams.get("status") || undefined,
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      offset: url.searchParams.get("offset") || undefined,
      counselorId: url.searchParams.get("counselorId") || undefined,
    };
    if (r.user.role === "COUNSELOR") {
      filters.counselorId = r.user.counselor_id; // server-enforced, cannot be overridden by the client
    }
    const result = await listAudits(query, filters);
    return jsonResponse(result);
  }

  if (req.method === "POST") {
    const r = await requireRoles(req, query, QA_AND_ABOVE);
    if (r.error) return r.error;
    let body;
    try { body = await req.json(); } catch (e) { return errorResponse("Invalid request body."); }

    const required = ["counselorId", "programmeId", "callDate", "callType", "applicantStage", "durationSeconds", "applicantName", "scores"];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === "") return errorResponse(`Missing required field: ${f}`);
    }
    if (!Array.isArray(body.scores) || body.scores.length === 0) return errorResponse("At least one scorecard parameter score is required.");
    for (const s of body.scores) {
      if (typeof s.parameterId !== "number" || typeof s.scorePercent !== "number") return errorResponse("Each score must include a numeric parameterId and scorePercent.");
      if (s.scorePercent < 0 || s.scorePercent > 100) return errorResponse("Scores must be between 0 and 100.");
    }
    if (body.ztpConfirmed && !body.ztpRuleId) return errorResponse("A ZTP rule must be selected when confirming a Zero Tolerance Policy violation.");

    try {
      const result = await createAndSubmitAudit(query, { ...body, auditorUserId: r.user.id });
      return jsonResponse(result, 201);
    } catch (e) {
      return errorResponse(e.message || "Failed to create audit.", 500);
    }
  }

  return errorResponse("Method not allowed", 405);
};

export const config = { path: "/api/audits" };
