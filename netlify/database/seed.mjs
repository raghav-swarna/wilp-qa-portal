// Seeds a fresh database with the same demo dataset the static app shipped with (169 calls,
// 169 scored+submitted audits, 23 counselors, 29 users, etc.), so the production app has
// realistic data to demo/verify against on day one. NOT for repeated runs against a live
// database with real data — it always inserts with explicit ids and will collide on a
// second run. Every user's plaintext demo_password is bcrypt-hashed before insert; nothing
// plaintext ever reaches the database. Takes `query` as an argument (works against PGlite in
// local tests and against real Postgres via run-seed.mjs).
import bcrypt from "bcryptjs";
// A plain static `import ... from "./x.json"` is the one form esbuild is guaranteed to
// statically analyze and inline into the compiled function bundle at build time. Both
// fs.readFileSync(a resolved path) and createRequire()+require() were tried first and both
// failed in production — esbuild doesn't follow either of those to know it needs to copy or
// inline the JSON, so the deployed function bundle never actually contained the data. The
// `with { type: "json" }` attribute is required for this same file to also run correctly
// under plain Node (e.g. local testing, run-seed.mjs) — esbuild accepts and honors it too.
import seedData from "./seed_data.json" with { type: "json" };

function b(v) { return !!v; } // seed JSON uses 0/1 for booleans; Postgres BOOLEAN wants true/false
function n(v) { return v === undefined ? null : v; }

export async function seed(query) {
  const d = seedData;

  for (const p of d.programmes) {
    await query("INSERT INTO programmes (id, name, code, status) VALUES ($1,$2,$3,$4)", [p.id, p.name, p.code, p.status]);
  }

  for (const u of d.users) {
    const hash = await bcrypt.hash(u.demo_password || "ChangeMe@123", 10);
    await query(
      "INSERT INTO users (id, name, email, password_hash, role, counselor_id, team, active, must_change_password, created_at) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)",
      [u.id, u.name, u.email, hash, u.role, n(u.team), b(u.active), b(u.must_change_password), u.created_at]
    );
  }

  for (const c of d.counselors) {
    await query(
      "INSERT INTO counselors (id, employee_code, name, email, phone, team, team_lead_user_id, joining_date, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [c.id, c.employee_code, c.name, c.email, n(c.phone), c.team, n(c.team_lead_user_id), c.joining_date, c.status, c.created_at]
    );
  }

  // Backfill users.counselor_id now that counselors exist (self-service COUNSELOR-role logins).
  for (const u of d.users) {
    if (u.counselor_id) await query("UPDATE users SET counselor_id = $1 WHERE id = $2", [u.counselor_id, u.id]);
  }

  for (const c of d.scorecard_categories) {
    await query("INSERT INTO scorecard_categories (id, name, description, max_points, sort_order) VALUES ($1,$2,$3,$4,$5)", [c.id, c.name, n(c.description), c.max_points, c.sort_order]);
  }
  for (const p of d.scorecard_parameters) {
    await query(
      "INSERT INTO scorecard_parameters (id, category_id, name, description, weight, error_severity, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [p.id, p.category_id, p.name, n(p.description), p.weight, p.error_severity, p.sort_order]
    );
  }
  for (const r of d.ztp_rules) {
    await query(
      "INSERT INTO ztp_rules (id, code, category, definition, trigger_text, example_text, active) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [r.id, r.code, r.category, r.definition, n(r.trigger_text), n(r.example_text), b(r.active)]
    );
  }
  for (const k of d.kpi_definitions) {
    await query(
      "INSERT INTO kpi_definitions (id, kpi_key, name, definition, formula, unit, target_operator, target_value, amber_threshold, frequency, owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [k.id, k.kpi_key, k.name, n(k.definition), n(k.formula), k.unit, k.target_operator, k.target_value, k.amber_threshold, n(k.frequency), n(k.owner)]
    );
  }

  for (const c of d.calls) {
    await query(
      "INSERT INTO calls (id, counselor_id, programme_id, call_date, call_type, applicant_stage, duration_seconds, applicant_name, applicant_phone, disposition, recording_disclosed, has_recording, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12,$13)",
      [c.id, c.counselor_id, c.programme_id, c.call_date, c.call_type, c.applicant_stage, c.duration_seconds, c.applicant_name, n(c.applicant_phone), n(c.disposition), b(c.recording_disclosed), c.created_by, c.created_at]
    );
  }

  for (const a of d.audits) {
    await query(
      `INSERT INTO audits (id, call_id, counselor_id, auditor_user_id, audit_date, status, overall_score, max_possible_score, compliance_score, ztp_flag, ztp_rule_id, coaching_priority, final_result, qa_comments, submitted_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [a.id, a.call_id, a.counselor_id, a.auditor_user_id, a.audit_date, a.status, n(a.overall_score), n(a.max_possible_score), n(a.compliance_score), b(a.ztp_flag), n(a.ztp_rule_id), n(a.coaching_priority), n(a.final_result), n(a.qa_comments), n(a.submitted_at), a.created_at, a.updated_at]
    );
  }
  for (const s of d.audit_scores) {
    await query(
      "INSERT INTO audit_scores (id, audit_id, parameter_id, score_percent, weighted_score, evidence, aoi) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [s.id, s.audit_id, s.parameter_id, s.score_percent, s.weighted_score, n(s.evidence), n(s.aoi)]
    );
  }
  for (const h of d.audit_history) {
    await query(
      "INSERT INTO audit_history (id, audit_id, action, field, old_value, new_value, reason, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [h.id, h.audit_id, h.action, n(h.field), n(h.old_value), n(h.new_value), n(h.reason), h.user_id, h.created_at]
    );
  }
  for (const e of d.error_records) {
    await query(
      "INSERT INTO error_records (id, audit_id, counselor_id, parameter_id, ztp_rule_id, severity, root_cause_category, is_repeat, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [e.id, e.audit_id, e.counselor_id, n(e.parameter_id), n(e.ztp_rule_id), e.severity, n(e.root_cause_category), b(e.is_repeat), e.created_at]
    );
  }
  for (const c of d.calibration_records) {
    await query(
      "INSERT INTO calibration_records (id, call_id, auditor_user_id, auditor_score, reviewer_user_id, reviewer_score, variance, final_agreed_score, bias_flag, notes, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [c.id, c.call_id, c.auditor_user_id, c.auditor_score, c.reviewer_user_id, c.reviewer_score, c.variance, n(c.final_agreed_score), b(c.bias_flag), n(c.notes), c.status, c.created_at]
    );
  }
  for (const dp of d.disputes) {
    await query(
      "INSERT INTO disputes (id, audit_id, parameter_id, counselor_id, raised_by_user_id, reason, evidence, raised_at, sla_due_at, status, reviewed_by_user_id, decision_notes, original_score, revised_score, closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [dp.id, dp.audit_id, dp.parameter_id, dp.counselor_id, dp.raised_by_user_id, dp.reason, n(dp.evidence), dp.raised_at, dp.sla_due_at, dp.status, n(dp.reviewed_by_user_id), n(dp.decision_notes), n(dp.original_score), n(dp.revised_score), n(dp.closed_at)]
    );
  }
  for (const c of d.coaching_actions) {
    await query(
      "INSERT INTO coaching_actions (id, audit_id, counselor_id, error_summary, root_cause, coaching_type, action, owner_user_id, due_date, completion_date, status, before_score, after_score, verified_improvement, effectiveness, comments, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
      [c.id, n(c.audit_id), c.counselor_id, c.error_summary, n(c.root_cause), c.coaching_type, c.action, c.owner_user_id, n(c.due_date), n(c.completion_date), c.status, n(c.before_score), n(c.after_score), b(c.verified_improvement), n(c.effectiveness), n(c.comments), c.created_at]
    );
  }
  for (const g of d.governance_events) {
    await query(
      "INSERT INTO governance_events (id, title, cadence, description, owner_user_id, due_date, completed_date, status, linked_type, linked_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [g.id, g.title, g.cadence, n(g.description), n(g.owner_user_id), g.due_date, n(g.completed_date), g.status, n(g.linked_type), n(g.linked_id), g.created_at]
    );
  }

  const tables = ["users", "counselors", "programmes", "calls", "scorecard_categories", "scorecard_parameters", "ztp_rules", "kpi_definitions", "audits", "audit_scores", "audit_history", "error_records", "calibration_records", "disputes", "coaching_actions", "governance_events"];
  for (const t of tables) {
    await query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`);
  }

  return { usersSeeded: d.users.length, auditsSeeded: d.audits.length };
}
