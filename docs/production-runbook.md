# Production runbook

## Topology

```text
Internet
  -> nginx :443 (TLS + Basic Auth)
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
- `/etc/nginx/.htpasswd-sales-igd`: Basic Auth hash.

The initial Basic Auth username and generated password are stored only in a root-readable file on the VPS. Retrieve them from an authorized terminal with:

```bash
ssh oracle-vps 'sudo cat /root/sales-igd-basic-auth.txt'
```

Do not paste this credential into the repository, issue tracker or deployment logs. The plaintext handoff file is `root:root 600`; nginx reads only the password hash from a separate `root:www-data 640` file.

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

The installer builds both `web` and `worker`, but starts only `web`. Apply additive migrations and reconcile `AI_BUDGET_EXTERNAL_SPEND_BASELINE_USD` from Vercel before any paid run. Start a bounded pilot first:

```bash
ssh oracle-vps 'cd /opt/sales-intelligence && sudo docker compose run --rm worker node --import tsx scripts/migrate.ts'
ssh oracle-vps 'cd /opt/sales-intelligence && sudo docker compose run --rm worker node --import tsx scripts/process-analysis-queue.ts --apply --limit=10 --concurrency=2'
```

Only after the 10-call gate is healthy may the durable worker be started:

```bash
ssh oracle-vps 'cd /opt/sales-intelligence && sudo SALES_RELEASE_SHA=$(readlink current | sed "s#.*/##") docker compose up -d --no-deps worker'
```

The worker uses PostgreSQL leases, heartbeat rows and global budget reservations. It fetches transcripts just in time with `GOOGLE_ACCESS_TOKEN`, one per concurrency slot, rather than downloading the full catalog. Per-file retries are bounded by `TRANSCRIPT_MAX_ATTEMPTS`; an expired Google credential stops the worker and leaves the Call retryable. A budget pause is durable and is not cleared by restart.

## Checks

```bash
ssh oracle-vps 'cd /opt/sales-intelligence && sudo docker compose ps'
curl -I https://sales-igd.com.br
curl -I https://www.sales-igd.com.br
```

Expected behavior:

- the primary domain returns `401` without credentials;
- valid credentials return the dashboard;
- `www` redirects to `https://sales-igd.com.br`;
- both containers report healthy;
- host ports 3100 and 5432 listen only on `127.0.0.1`.

The system `certbot.timer` performs automatic renewal. A non-destructive renewal check can be run with:

```bash
ssh oracle-vps 'sudo certbot renew --dry-run --cert-name sales-igd.com.br'
```

## Future transition from shared Basic Auth

Application authentication does not automatically replace the nginx Basic Auth layer. Follow the gated transition in [authentication-access-control.md](authentication-access-control.md): migrate the schema, bootstrap the first administrator, validate individual accounts in an isolated environment, optionally run both layers, and remove nginx Basic Auth only in a separate explicitly approved change.

If application login fails during a future transition, restore the previous immutable release and keep `/etc/nginx/.htpasswd-sales-igd` enabled. Database authentication tables are additive and do not require deleting operational or analysis data for rollback.

## Rollback

Releases are immutable. To roll back, deploy the previous commit explicitly:

```bash
./scripts/deploy-production.sh <previous-commit>
```

The PostgreSQL volume and application data are not changed by a web rollback.
