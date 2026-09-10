# Production runbook

## Topology

```text
Internet
  -> nginx :443 (TLS reverse proxy)
  -> 127.0.0.1:3100
  -> sales-intelligence-web :3000
  -> postgres :5432 on the private Compose network
```

The host publishes the web container only on loopback. PostgreSQL remains published only on `127.0.0.1:5432` for the existing SSH-tunnel workflow. Neither port is public.

Production paths on `oracle-vps`:

- `/opt/sales-intelligence/docker-compose.yml`: active Compose definition;
- `/opt/sales-intelligence/postgres.env`: existing PostgreSQL secret;
- `/opt/sales-intelligence/app.env`: generated application database secret;
- `/opt/sales-intelligence/current`: current immutable release symlink;
- `/opt/sales-intelligence/releases/<commit>`: release contents;
- `/etc/nginx/sites-available/sales-igd.com.br`: reverse proxy;
- `/etc/nginx/.htpasswd-sales-igd`: legacy Basic Auth file, retained only for rollback;
- `/etc/nginx/sites-available/sales-igd.com.br.before-basic-auth-removal.<timestamp>.bak`: protected pre-removal nginx backup.

Basic Auth is not active. Do not read, rotate, delete or reuse the legacy password files during routine operations. Their contents must never be copied into the repository, issue tracker, documentation or deployment logs.

## Deploy an immutable validated ref

From a trusted local checkout:

```bash
npm run deploy:production
```

The command fetches GitHub, resolves `origin/main` to an immutable commit, archives only tracked files, uploads the release and rebuilds only the web service. It does not run migrations, seed data, recreate PostgreSQL or merge branches.

To deploy an explicitly approved branch without merging `main`:

```bash
./scripts/deploy-production.sh origin/feat/source-agnostic-ingestion
```

The installer builds both `web` and `worker`, but starts only `web`. Before paid work, configure the Gateway key. The read-only Vercel management inputs `VERCEL_AI_GATEWAY_KEY_ID`, `VERCEL_TOKEN` and, when applicable, `VERCEL_TEAM_ID`, enable periodic aggregate reconciliation but are not required on every request. Apply additive migrations and set the initial `AI_BUDGET_EXTERNAL_SPEND_BASELINE_USD`, `AI_BUDGET_LIMIT_USD=15` and a small `AI_BUDGET_SAFETY_RESERVE_USD` (initially `0.10`), then start a bounded 10-Call checkpoint:

```bash
ssh oracle-vps 'cd /opt/sales-intelligence && sudo docker compose run --rm worker node --import tsx scripts/migrate.ts'
ssh oracle-vps 'cd /opt/sales-intelligence && sudo docker compose run --rm worker node --import tsx scripts/process-analysis-queue.ts --apply --limit=10 --concurrency=2'
```

Record `PILOT_STARTED_AT` before the first command and generate the private mode-`600` report with `PILOT_LIMIT=10`. Its stdout contains only aggregate Luna-only/escalation, schema, grounding, unscorable, zero-score, error, cost and projected-backlog metrics. If escalation returns to nearly every Call, costs spike or errors are systemic, stop. Otherwise start the durable worker; the 10-Call checkpoint is a gate, not a permanent processing cap.

After the initial checkpoint and projected-cost check are healthy, start the durable worker:

```bash
ssh oracle-vps 'cd /opt/sales-intelligence && sudo SALES_RELEASE_SHA=$(readlink current | sed "s#.*/##") docker compose up -d --no-deps worker'
```

The worker uses renewable PostgreSQL leases, heartbeat rows and global budget reservations shared with benchmark tooling. Its lease must remain at least 60 seconds longer than `AI_GATEWAY_TIMEOUT_MS`. It fetches transcripts just in time with `GOOGLE_ACCESS_TOKEN`, one per concurrency slot, rather than downloading the full catalog; an authorized connector may instead preload a bounded window into PostgreSQL. Per-file retries are bounded by `TRANSCRIPT_MAX_ATTEMPTS`; an expired Google credential stops the worker and leaves the Call retryable. A budget pause, including provider 402, is durable, remains healthy/observable, and is not cleared by restart.

## Checks

```bash
ssh oracle-vps 'cd /opt/sales-intelligence && sudo docker compose ps'
curl -I https://sales-igd.com.br
curl -I https://sales-igd.com.br/login
curl -I https://www.sales-igd.com.br
```

Expected behavior:

- `/login` returns `200` without a `WWW-Authenticate: Basic` header;
- unauthenticated dashboard pages redirect to `/login`;
- unauthenticated data and spend APIs return `401`;
- individual application credentials create the session used by protected routes;
- `www` redirects to `https://sales-igd.com.br`;
- both containers report healthy;
- host ports 3100 and 5432 listen only on `127.0.0.1`.

The system `certbot.timer` performs automatic renewal. A non-destructive renewal check can be run with:

```bash
ssh oracle-vps 'sudo certbot renew --dry-run --cert-name sales-igd.com.br'
```

## Retired shared Basic Auth

The shared nginx Basic Auth was retired on 2026-09-09 after application login, session invalidation, page/API authorization, role scopes and spend guards were validated. Application authentication is now the primary access layer.

For an immediate operational rollback, select the exact timestamped backup created before removal and restore it only after inspecting the path:

```bash
ssh oracle-vps 'sudo cp --preserve=all /etc/nginx/sites-available/sales-igd.com.br.before-basic-auth-removal.<timestamp>.bak /etc/nginx/sites-available/sales-igd.com.br && sudo nginx -t && sudo systemctl reload nginx'
```

The legacy `/etc/nginx/.htpasswd-sales-igd` file remains in place for that rollback. Do not delete application authentication tables or operational data.

## Rollback

Releases are immutable. To roll back, deploy the previous commit explicitly:

```bash
./scripts/deploy-production.sh <previous-commit>
```

The PostgreSQL volume and application data are not changed by a web rollback.
