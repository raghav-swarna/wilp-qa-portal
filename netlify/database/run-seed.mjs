// One-time manual runner: `node netlify/database/run-seed.mjs`
// Connects directly to the real Netlify Database (Postgres) using the connection string
// Netlify exposes as NETLIFY_DATABASE_URL (or DATABASE_URL as a fallback), and loads the
// demo dataset. Run this once, right after the first deploy applies the migration and
// before anyone logs in — running it twice will fail on duplicate ids.
import pg from "pg";
import { seed } from "./seed.mjs";

const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("No database connection string found. Set NETLIFY_DATABASE_URL (copy it from `netlify env:list` or the Netlify project's Database tab) and re-run.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
async function query(sql, params) {
  return pool.query(sql, params || []);
}

seed(query)
  .then((result) => {
    console.log("Seed complete:", result);
    return pool.end();
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    return pool.end().finally(() => process.exit(1));
  });
