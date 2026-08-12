// Role groupings — mirrors the constants in the original static app.js exactly, but here
// they are enforced server-side on every request. In the demo build these same names only
// gated which HTML got rendered in the browser, so anyone could bypass them via devtools;
// that is the core difference this production backend exists to fix.
export const QA_AND_ABOVE = ["ADMIN", "QA_ANALYST"];
export const REVIEW_ROLES = ["ADMIN", "QA_ANALYST", "TEAM_LEAD"];
export const MANAGEMENT_VIEW = ["ADMIN", "QA_ANALYST", "TEAM_LEAD", "LEADERSHIP"];
export const ADMIN_ONLY = ["ADMIN"];
export const ALL_ROLES = ["ADMIN", "QA_ANALYST", "TEAM_LEAD", "COUNSELOR", "LEADERSHIP"];

export function hasRole(user, roles) {
  return !!user && roles.includes(user.role);
}

/** A counselor may only ever act on their own record; everyone in REVIEW_ROLES (or above)
 *  can act on any counselor. Used for dispute-raising, self-service views, etc. */
export function isSelfOrReview(user, counselorId) {
  if (hasRole(user, REVIEW_ROLES)) return true;
  return user.role === "COUNSELOR" && user.counselor_id === counselorId;
}
