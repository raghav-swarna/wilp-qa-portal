// User (login account) management — separate from `counselors`, which are the audited call
// agents. A `users` row is a login: ADMIN/QA_ANALYST/TEAM_LEAD/LEADERSHIP staff, or a
// COUNSELOR-role self-service login optionally linked to a counselor record via counselor_id.
import { hashPassword } from "./auth.mjs";
import { ALL_ROLES } from "./guard.mjs";

function nowIso() { return new Date().toISOString(); }

export async function listUsers(query) {
  const res = await query(
    `SELECT id, name, email, role, counselor_id, team, active, must_change_password, created_at
     FROM users ORDER BY name`
  );
  return res.rows;
}

export async function createUser(query, input) {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const password = input.password || "";
  const role = input.role;

  if (!name) throw new Error("Name is required.");
  if (!email || !email.includes("@")) throw new Error("A valid email is required.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (!ALL_ROLES.includes(role)) throw new Error("Invalid role.");
  if (role === "COUNSELOR" && !input.counselorId) {
    throw new Error("A COUNSELOR-role login must be linked to a counselor record.");
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) throw new Error("A user with that email already exists.");

  if (input.counselorId) {
    const c = await query("SELECT id FROM counselors WHERE id = $1", [input.counselorId]);
    if (c.rows.length === 0) throw new Error("Selected counselor record was not found.");
  }

  const hash = await hashPassword(password);
  const res = await query(
    `INSERT INTO users (name, email, password_hash, role, counselor_id, team, active, must_change_password, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE,$7)
     RETURNING id, name, email, role, counselor_id, team, active, must_change_password, created_at`,
    [name, email, hash, role, input.counselorId || null, input.team || null, nowIso()]
  );
  return res.rows[0];
}

export async function setUserActive(query, userId, active) {
  await query("UPDATE users SET active = $1 WHERE id = $2", [!!active, userId]);
}
