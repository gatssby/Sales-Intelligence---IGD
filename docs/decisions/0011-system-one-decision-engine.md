# ADR 0011 — System One Decision Engine and Generative v1 isolation

## Status

Accepted for the isolated `feat/system-one-foundation` line; production rollout not approved.

## Context

The previous architecture used generative models for repetitive, typed sales decisions. Reanalysis must start from zero without deleting historical output or allowing archived results to become active by recency.

## Decision

- introduce a provider-agnostic `DecisionEngine` seam;
- keep Jev and Laya as adapters;
- persist System One decisions under `engine_family=system-one`;
- archive legacy rows logically as `generative-ai-v1` and keep them readable;
- require explicit labels/outcomes for continual learning;
- keep model assets generic and client profile configuration-specific;
- prepare only additive migrations in this phase.

## Consequences

The product can compare providers per decision, preserve historical provenance and run a local lab without touching production. The dashboard/worker must choose an engine family explicitly; a generic "latest analysis" query is invalid.
