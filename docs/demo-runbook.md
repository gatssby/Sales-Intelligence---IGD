# Demo vertical slice

This demo keeps PostgreSQL private on the VPS and exposes it only through an SSH tunnel.

## Data path

```text
Google Drive Gemini notes
  -> one-time private seed
  -> PostgreSQL on oracle-vps (localhost only)
  -> Next.js server component
  -> executive + seller + call views
```

The private seed file contains the real transcript and Drive identifiers. It is deliberately stored outside the repository and ignored by Git.

## Local run

The private database settings must exist at `apps/web/.env.local`. This file is ignored by Git and the demo command restricts it to owner-only permissions.

From the repository root, run:

```bash
npm run demo
```

The command:

1. loads `apps/web/.env.local` without printing its values;
2. requires the database URL to use `127.0.0.1:5433`;
3. reuses or opens `5433 -> oracle-vps:5432` through SSH;
4. tests the PostgreSQL connection;
5. confirms a valid `analysis_run` with `status = completed` and `is_current = true`;
6. restarts only a previous dashboard process from this repository on port 3000;
7. starts Next.js on `127.0.0.1:3000`.

Wait for `Demo ready`, keep the terminal open, then open [http://127.0.0.1:3000](http://127.0.0.1:3000) in Safari. Press `Ctrl+C` after the presentation; the command also closes the SSH tunnel that it opened.

If dependencies are not installed yet, run `npm install` once before `npm run demo`.

To check the tunnel, database and analysis without starting Next.js:

```bash
npm run demo:check
```

## Why Safari previously showed the empty state

The Next.js process was listening on port 3000, but there was no listener on local port 5433. The database query failed and the dashboard intentionally returned the same empty state used when `DATABASE_URL` is absent. The Playwright view had been loaded while the SSH tunnel was active, so it continued to show the previously rendered data. The new command performs the database checks before starting Next.js and does not report the demo as ready when data is unavailable.

## What n8n replaces next

The one-time seed is only the demo bridge. The production workflow will replace it with:

1. scheduled discovery of active `source_locations`;
2. recursive Drive listing with checkpointing;
3. Gemini notes export and transcript normalization;
4. analysis job dispatch with retry and idempotency;
5. writes to the same PostgreSQL schema.

The dashboard does not depend on the temporary seed mechanism.

## Demo caveat

`insider-demo-v0` is explicitly unvalidated. It demonstrates explainability, evidence and versioning; it must not be used as an official performance KPI until a human-reviewed golden set is calibrated.
