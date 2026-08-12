# WILP QA Portal — Production Build

A real, server-backed version of the QA portal: Postgres database (Netlify Database), bcrypt
password hashing, revocable session cookies, and server-side scoring so a client can no longer
submit a fabricated audit result — the exact bug found in the earlier localStorage demo (a
1.25-minute call scoring "GOOD" on every parameter) is now structurally impossible, because the
server recomputes every score from the raw inputs you send it.

**Current scope:** authentication and the core call-audit workflow (create/score/submit an
audit, view audit details and history, correct a submitted audit's comments with a required
reason). Disputes, calibration, coaching, governance, counselor management, and settings are not
built yet in this backend — they exist in the earlier localStorage demo but still need to be
ported to real APIs as a follow-up.

## Deploying (no GitHub account required to start, but one is needed for auto-deploy)

Netlify can only run this automatically — installing dependencies and applying the database
migration — from a **connected Git repository**. A plain file upload only handles static assets
and can't run the migration, so a repo is required. GitHub is the easiest free option.

1. **Create a free GitHub account** at github.com/join (email + password, no payment info).
2. **Create a new repository** (github.com → "+" → New repository). Any name, e.g. `wilp-qa-portal`.
3. **Upload this folder's contents.** On the new repo's page, click "uploading an existing
   file" and drag this entire project folder in (in Chrome/Edge you can drag a folder directly;
   it will preserve the `netlify/` subfolder structure). Commit.
4. **In Netlify**, open your site → *Site configuration → Build & deploy → Continuous deployment*
   → "Link repository" → choose the repo you just created.
5. **Set the `AUTH_SECRET` environment variable**: Site configuration → Environment variables →
   Add a variable named `AUTH_SECRET`, value = any long random string (this signs login
   sessions — treat it like a password). Scope: all deploy contexts.
6. **Trigger a deploy** (Netlify usually does this automatically once linked). Netlify will
   install dependencies, provision a Postgres database automatically (via `@netlify/database`),
   apply `netlify/database/migrations/001_init/migration.sql`, and publish the site.
7. **Load the demo dataset** (29 users, 169 scored audits) so there's something to look at:
   - Set one more environment variable, `SEED_KEY`, to any random string.
   - Redeploy (or wait for env var to apply), then visit
     `https://<your-site>.netlify.app/api/admin/seed` — send a POST request with header
     `x-seed-key: <the value you set>`. Easiest way without a terminal: use a tool like
     [Hoppscotch](https://hoppscotch.io) (free, no login) — POST to that URL with that header.
   - Once it responds `{"ok": true, ...}`, **delete the `SEED_KEY` environment variable** so
     the endpoint stops working (it also refuses to run twice against a non-empty database).
8. **Sign in** with a seeded account, e.g. `admin@wilp-qa.local` / `Welcome@123` (Admin) or
   `priya.qa@wilp-qa.local`-style QA analyst accounts — check `netlify/database/seed_data.json`
   for the full list of emails and roles. **Change these passwords or remove the demo accounts
   before giving anyone real access** — they're intentionally simple for a first login.

## What's actually enforced server-side (not just hidden in the UI)

- A `COUNSELOR`-role user can only ever see their own audits — the server ignores any
  `counselorId` filter they send and forces it to their own id.
- Only `QA_ANALYST`/`ADMIN` can create or correct audits — checked on every request, not just
  by hiding the button.
- Every audit's overall score, rating, ZTP fail-gate, and auto-coaching trigger are computed
  server-side from the raw per-parameter scores you submit — a client cannot submit a
  precomputed "final score" and have it trusted.
- Corrections to a submitted audit are restricted to specific fields (`qa_comments`,
  `coaching_priority`), always require a reason, and are written to `audit_history` — never a
  silent edit.
- Login lockout (5 failed attempts → 15-minute lock) is tracked in the database, so it survives
  server restarts/cold starts, not just in-memory.
- Signing out actually revokes the session server-side (via the `sessions` table) — the cookie
  isn't just cleared client-side.

## Local development / testing

This was tested end-to-end (real bcrypt, real JWT sessions, a real Postgres-compatible engine
via PGlite, and the actual frontend files under `public/` driven through jsdom) before being
handed off — not just spot-checked. There's no bundled test suite in this repo (the test
harness lived outside it), but the design choice to make every business-logic function take a
`query(sql, params)` function as its first argument means you can point the same code at any
Postgres-compatible engine for local testing without needing `@netlify/database`, which only
resolves inside Netlify's own runtime.

To run against Netlify Database locally via `netlify dev`, you'll need the Netlify CLI
installed on your own machine (`npm install -g netlify-cli`, then `netlify dev` inside this
folder after linking the site with `netlify link`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | Yes | Signs session tokens. Any long random string. |
| `SEED_KEY` | Only during initial setup | Authorizes the one-time `/api/admin/seed` call. Remove after seeding. |

`@netlify/database` provisions its own Postgres connection automatically — you don't set a
database URL yourself in normal operation.
