// Core audit workflow business logic — ported line-for-line in spirit from the static
// demo's app.js, but every function here takes `query` as its first argument (Postgres via
// db.mjs in production, PGlite in local tests) and the server always recomputes weighted
// scores / final result / ZTP gate / coaching-required from the raw submitted scores rather
// than trusting any pre-computed numbers the client might send.
import { round1, round2, scoreParameter, computeFinalResult, isCoachingRequired, getCoachingPriority } from "./scoring.mjs";

function nowIso() { return new Date().toISOString(); }
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getParametersWithCategory(query) {
  const res = await query(
    `SELECT p.*, c.name AS category_name, c.max_points AS category_max_points, c.sort_order AS category_sort_order
     FROM scorecard_parameters p JOIN scorecard_categories c ON c.id = p.category_id
     ORDER BY c.sort_order, p.sort_order`
  );
  return res.rows;
}
export async function totalScorecardPoints(query) {
  const res = await query("SELECT COALESCE(SUM(max_points),0) AS total FROM scorecard_categories");
  return Number(res.rows[0].total);
}
export async function getCategoryIdByName(query, name) {
  const res = await query("SELECT id FROM scorecard_categories WHERE name = $1", [name]);
  return res.rows[0] ? res.rows[0].id : null;
}
export async function checkRepeatError(query, counselorId, parameterId) {
  const res = await query("SELECT 1 FROM error_records WHERE counselor_id = $1 AND parameter_id = $2 LIMIT 1", [counselorId, parameterId]);
  return res.rows.length > 0;
}
export async function appendHistory(query, auditId, action, field, oldValue, newValue, reason, userId) {
  await query(
    "INSERT INTO audit_history (audit_id, action, field, old_value, new_value, reason, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [auditId, action, field, oldValue, newValue, reason, userId, nowIso()]
  );
}
export async function createCoachingAction(query, input) {
  const res = await query(
    `INSERT INTO coaching_actions (audit_id, counselor_id, error_summary, root_cause, coaching_type, action, owner_user_id, due_date, before_score, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [input.auditId || null, input.counselorId, input.errorSummary, input.rootCause || null, input.coachingType, input.action, input.ownerUserId, input.dueDate || null, input.beforeScore == null ? null : input.beforeScore, nowIso()]
  );
  return res.rows[0].id;
}

export async function getAuditScores(query, auditId) {
  const res = await query("SELECT * FROM audit_scores WHERE audit_id = $1", [auditId]);
  return res.rows;
}
export async function getAuditHistory(query, auditId) {
  const res = await query("SELECT * FROM audit_history WHERE audit_id = $1 ORDER BY id DESC", [auditId]);
  return res.rows;
}

/** Creates a call + a fully-scored, submitted audit in one step, mirroring the static demo's
 *  createAndSubmitAudit(): weighted scoring, ZTP gate, error_records, auto coaching action,
 *  history entry. All scoring is recomputed here from raw score_percent values — the caller
 *  cannot inject a pre-computed overall score. */
export async function createAndSubmitAudit(query, input) {
  const callRes = await query(
    `INSERT INTO calls (counselor_id, programme_id, call_date, call_type, applicant_stage, duration_seconds, applicant_name, applicant_phone, disposition, recording_disclosed, has_recording, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12) RETURNING id`,
    [input.counselorId, input.programmeId, input.callDate, input.callType, input.applicantStage, input.durationSeconds, input.applicantName, input.applicantPhone || null, input.disposition || null, !!input.recordingDisclosed, input.auditorUserId, nowIso()]
  );
  const callId = callRes.rows[0].id;

  const auditRes = await query(
    `INSERT INTO audits (call_id, counselor_id, auditor_user_id, audit_date, status, ztp_flag, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'DRAFT',FALSE,$5,$5) RETURNING id`,
    [callId, input.counselorId, input.auditorUserId, input.callDate, nowIso()]
  );
  const auditId = auditRes.rows[0].id;
  await appendHistory(query, auditId, "CREATED", null, null, null, "Audit created", input.auditorUserId);

  const params = await getParametersWithCategory(query);
  const byPid = {};
  params.forEach((p) => { byPid[p.id] = p; });

  for (const s of input.scores || []) {
    const p = byPid[s.parameterId];
    const weight = p ? Number(p.weight) : 0;
    const clamped = Math.max(0, Math.min(100, Number(s.scorePercent)));
    const weighted = scoreParameter(weight, clamped);
    await query(
      "INSERT INTO audit_scores (audit_id, parameter_id, score_percent, weighted_score, evidence, aoi) VALUES ($1,$2,$3,$4,$5,$6)",
      [auditId, s.parameterId, clamped, weighted, s.evidence || "", s.aoi || ""]
    );
  }

  const savedScores = await getAuditScores(query, auditId);
  const parameterResults = savedScores.map((s) => {
    const p = byPid[s.parameter_id];
    return { parameterId: s.parameter_id, weight: Number(p.weight), scorePercent: Number(s.score_percent), severity: p.error_severity, weightedScore: Number(s.weighted_score) };
  });
  const maxPossible = await totalScorecardPoints(query);
  const overallScore = round2(savedScores.reduce((sum, r) => sum + Number(r.weighted_score), 0));
  const ztpConfirmed = !!input.ztpConfirmed;
  const result = computeFinalResult(overallScore, maxPossible, ztpConfirmed);
  const coachingRequired = isCoachingRequired(overallScore, maxPossible, ztpConfirmed, parameterResults);
  const coachingPriority = getCoachingPriority(overallScore, maxPossible, ztpConfirmed, parameterResults);

  const complianceCategoryId = await getCategoryIdByName(query, "Compliance");
  const complianceScores = savedScores.filter((s) => byPid[s.parameter_id] && byPid[s.parameter_id].category_id === complianceCategoryId);
  const complianceMax = params.filter((p) => p.category_id === complianceCategoryId).reduce((s, p) => s + Number(p.weight), 0);
  const complianceEarned = complianceScores.reduce((s, r) => s + Number(r.weighted_score), 0);
  const complianceScore = complianceMax > 0 ? round2((complianceEarned / complianceMax) * 100) : 0;

  await query(
    `UPDATE audits SET overall_score=$1, max_possible_score=$2, compliance_score=$3, final_result=$4, ztp_flag=$5, ztp_rule_id=$6,
     coaching_priority=$7, qa_comments=$8, status='SUBMITTED', submitted_at=$9, updated_at=$9 WHERE id=$10`,
    [overallScore, maxPossible, complianceScore, result.finalResultCode, ztpConfirmed, input.ztpRuleId || null, coachingPriority, input.qaComments || "", nowIso(), auditId]
  );

  for (const s of savedScores) {
    if (Number(s.score_percent) < 50) {
      const p = byPid[s.parameter_id];
      const isRepeat = await checkRepeatError(query, input.counselorId, s.parameter_id);
      await query(
        "INSERT INTO error_records (audit_id, counselor_id, parameter_id, ztp_rule_id, severity, root_cause_category, is_repeat, created_at) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7)",
        [auditId, input.counselorId, s.parameter_id, p.error_severity, input.rootCauseCategory || null, isRepeat, nowIso()]
      );
    }
  }
  if (ztpConfirmed && input.ztpRuleId) {
    await query(
      "INSERT INTO error_records (audit_id, counselor_id, parameter_id, ztp_rule_id, severity, root_cause_category, is_repeat, created_at) VALUES ($1,$2,NULL,$3,'FATAL',$4,FALSE,$5)",
      [auditId, input.counselorId, input.ztpRuleId, input.rootCauseCategory || null, nowIso()]
    );
  }

  await appendHistory(query, auditId, "SUBMITTED", "status", "DRAFT", "SUBMITTED", "Final result: " + result.rating + (ztpConfirmed ? " (ZTP gate applied)" : ""), input.auditorUserId);

  if (coachingRequired) {
    await createCoachingAction(query, {
      auditId,
      counselorId: input.counselorId,
      errorSummary: ztpConfirmed ? "Zero Tolerance Policy violation confirmed during audit." : `Overall score (${result.rating}) triggered coaching per policy.`,
      coachingType: ztpConfirmed ? "1:1 Disciplinary Coaching" : "Refresher Training",
      action: ztpConfirmed ? "Mandatory retraining and supervised calls per ZTP corrective action." : "Targeted coaching on weakest scorecard parameters.",
      ownerUserId: input.auditorUserId,
      dueDate: addDays(nowIso().slice(0, 10), 14),
      beforeScore: round1((overallScore / maxPossible) * 100),
    });
  }

  return { auditId, callId, overallScore, maxPossibleScore: maxPossible, complianceScore, rating: result.rating, finalResultCode: result.finalResultCode, coachingRequired, coachingPriority };
}

export async function correctAuditAfterSubmission(query, auditId, field, newValue, reason, userId) {
  const ALLOWED_FIELDS = ["qa_comments", "coaching_priority"];
  if (!ALLOWED_FIELDS.includes(field)) throw new Error("That field cannot be corrected through this endpoint.");
  if (!reason) throw new Error("A reason is required to correct a submitted audit.");
  const res = await query("SELECT * FROM audits WHERE id = $1", [auditId]);
  const audit = res.rows[0];
  if (!audit) throw new Error("Audit not found.");
  const oldValue = audit[field] == null ? "" : String(audit[field]);
  await query(`UPDATE audits SET ${field} = $1, updated_at = $2 WHERE id = $3`, [newValue, nowIso(), auditId]);
  await appendHistory(query, auditId, "CORRECTED", field, oldValue, String(newValue), reason, userId);
}

export async function listAudits(query, filters) {
  const clauses = [];
  const params = [];
  if (filters.counselorId) { params.push(filters.counselorId); clauses.push(`a.counselor_id = $${params.length}`); }
  if (filters.status) { params.push(filters.status); clauses.push(`a.status = $${params.length}`); }
  if (filters.from) { params.push(filters.from); clauses.push(`a.audit_date >= $${params.length}`); }
  if (filters.to) { params.push(filters.to); clauses.push(`a.audit_date <= $${params.length}`); }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const limit = Math.min(Number(filters.limit) || 50, 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  params.push(limit, offset);
  const res = await query(
    `SELECT a.*, c.name AS counselor_name, cl.applicant_name, cl.duration_seconds, cl.has_recording
     FROM audits a JOIN counselors c ON c.id = a.counselor_id JOIN calls cl ON cl.id = a.call_id
     ${where} ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const countRes = await query(`SELECT COUNT(*) AS n FROM audits a ${where}`, params.slice(0, params.length - 2));
  return { rows: res.rows, total: Number(countRes.rows[0].n) };
}

export async function getAuditDetail(query, auditId) {
  const res = await query(
    `SELECT a.*, c.name AS counselor_name, c.team, cl.applicant_name, cl.applicant_phone, cl.call_type, cl.applicant_stage,
            cl.duration_seconds, cl.disposition, cl.has_recording, cl.call_date, u.name AS auditor_name
     FROM audits a JOIN counselors c ON c.id = a.counselor_id JOIN calls cl ON cl.id = a.call_id JOIN users u ON u.id = a.auditor_user_id
     WHERE a.id = $1`,
    [auditId]
  );
  const audit = res.rows[0];
  if (!audit) return null;
  const scores = await getAuditScores(query, auditId);
  const history = await getAuditHistory(query, auditId);
  return { audit, scores, history };
}
