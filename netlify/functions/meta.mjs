// Read-only reference data the frontend needs to render the new-audit form and dashboards:
// counselors, programmes, scorecard structure, ZTP rules, KPI definitions. Any signed-in
// user can read this (it's not sensitive), but you must be signed in — no anonymous access.
import { query } from "./_lib/db.mjs";
import { requireUser, errorResponse, jsonResponse } from "./_lib/auth.mjs";
import { getParametersWithCategory } from "./_lib/audits.mjs";

export default async (req) => {
  const r = await requireUser(req, query);
  if (r.error) return r.error;

  const [counselors, programmes, categories, parameters, ztpRules, kpis] = await Promise.all([
    query("SELECT id, employee_code, name, email, team, status, joining_date FROM counselors ORDER BY name"),
    query("SELECT * FROM programmes ORDER BY name"),
    query("SELECT * FROM scorecard_categories ORDER BY sort_order"),
    getParametersWithCategory(query),
    query("SELECT * FROM ztp_rules WHERE active = TRUE ORDER BY code"),
    query("SELECT * FROM kpi_definitions ORDER BY id"),
  ]);

  return jsonResponse({
    counselors: counselors.rows,
    programmes: programmes.rows,
    scorecardCategories: categories.rows,
    scorecardParameters: parameters,
    ztpRules: ztpRules.rows,
    kpiDefinitions: kpis.rows,
  });
};

export const config = { path: "/api/meta" };
