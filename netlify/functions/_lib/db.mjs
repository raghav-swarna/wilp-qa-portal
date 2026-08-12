// Production DB connection — Netlify Database (Postgres), auto-provisioned on deploy.
// Every repo/business-logic function takes a `query(sql, params) -> {rows}` function as
// its first argument instead of importing this module directly, so the same logic can be
// exercised in local tests against PGlite (an in-process Postgres-compatible engine)
// without needing @netlify/database (which only resolves inside Netlify's own runtime).
import { getDatabase } from "@netlify/database";

let _pool;
function getPool() {
  if (!_pool) _pool = getDatabase().pool;
  return _pool;
}

export async function query(sql, params) {
  const pool = getPool();
  return pool.query(sql, params || []);
}
