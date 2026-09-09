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

## Deploy after merge to main

From a trusted local checkout:

```bash
npm run deploy:production
```

The command fetches GitHub, resolves `origin/main` to an immutable commit, archives only tracked files, uploads the release and rebuilds only the web service. It does not run migrations, seed data, recreate PostgreSQL or merge branches.

To deploy an explicitly approved ref before merge:

```bash
./scripts/deploy-production.sh feat/demo-vertical-slice
```

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

## Rollback

Releases are immutable. To roll back, deploy the previous commit explicitly:

```bash
./scripts/deploy-production.sh <previous-commit>
```

The PostgreSQL volume and application data are not changed by a web rollback.
