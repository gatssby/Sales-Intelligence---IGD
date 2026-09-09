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

1. Open the database tunnel:

   ```bash
   ssh -N -L 5433:127.0.0.1:5432 oracle-vps
   ```

2. Copy `.env.example` to `apps/web/.env.local` and fill the private database credentials.
3. Run `npm install` and `npm run dev`.
4. Open `http://localhost:3000`.

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
