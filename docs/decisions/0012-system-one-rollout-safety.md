# ADR 0012 — System One rollout safety gates

## Status

Accepted for preparation only; no production mutation approved.

## Decision

Backups, analysis-specific export/restore validation, migration review, provider health, pilot scope and queue activation are separate gates. This branch does not deploy, migrate production, delete historical analysis, increase budget or enable `AUTO_QUEUE`.
