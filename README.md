// One-time, key-protected endpoint to load the demo dataset into a freshly-deployed database
// without needing Node/npm/psql on your own machine — just one authenticated request from a
// browser or curl. Protected by the SEED_KEY environment variable (set it in Netlify's
// Environment variables before calling this, and remove it afterward so the endpoint stops
// working). Refuses to run a second time once any users already exist, to avoid duplicate-id
// errors against a database that already has real data in it.
import { query } from "./_lib/db.mjs";
import { errorResponse, jsonResponse } from "./_lib/auth.mjs";
import { seed } from "../database/seed.mjs";

export default async (req) => {
  // Accepts either a POST with an x-seed-key header, or a plain GET with ?key=... so it can
  // be triggered by just visiting a URL in a browser — no terminal or API client needed.
  const expected = typeof Netlify !== "undefined" ? Netlify.env.get("SEED_KEY") : process.env.SEED_KEY;
  if (!expected) return errorResponse("SEED_KEY is not set in this site's environment variables — set it first, then retry.", 500);

  const url = new URL(req.url);
  const provided = req.headers.get("x-seed-key") || url.searchParams.get("key");
  if (provided !== expected) return errorResponse("Invalid or missing seed key. Visit this URL with ?key=<your SEED_KEY value> added to the end.", 401);

  const existing = await query("SELECT COUNT(*) AS n FROM users");
  if (Number(existing.rows[0].n) > 0) {
    return errorResponse("Database already has users in it — refusing to seed again (this would create duplicate-id errors). This endpoint only runs once against a fresh database.", 409);
  }

  try {
    const result = await seed(query);
    return jsonResponse({ ok: true, ...result, note: "Seed complete. Now remove SEED_KEY from your environment variables so this endpoint stops working." });
  } catch (e) {
    return errorResponse("Seed failed: " + e.message, 500);
  }
};

export const config = { path: "/api/admin/seed" };
