# ADR 0001: Demo-first vertical slice

## Status

Accepted for the 2026-09-09 demonstration.

## Decision

Use a Next.js monolith with server-side PostgreSQL reads, a versioned AI package, and a one-time private seed for the first call. PostgreSQL runs on `oracle-vps`, bound only to loopback and accessed locally through SSH.

## Consequences

- The demo can show real analysis data without committing PII.
- n8n can later replace the seed without changing the dashboard schema.
- Authentication and full ingestion orchestration remain required before production use.
- The v0 rubric is demonstrative and not an official seller-performance KPI.
