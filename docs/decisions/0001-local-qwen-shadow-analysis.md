# ADR: local Qwen analysis starts in shadow mode

Status: accepted for the Qwen3.5 9B v2 experiment
Date: 2026-10-15

## Context

The existing Sales Intelligence architecture treats PostgreSQL as the operational source of truth and preserves historical analysis runs. The local Qwen runtime is a new provider and its quality/grounding are not yet validated enough to replace official analysis.

## Decision

Run Qwen3.5 9B through a provider-agnostic local adapter and persist first results as filesystem shadow artifacts. The CLI and resumable jobs do not write `analysis_runs`, `analysis_attempts`, or official analysis results by default.

Every shadow artifact must carry, when available:

- call and transcript identifiers;
- transcript SHA-256;
- model and quantization;
- llama.cpp/runtime endpoint profile;
- pipeline, schema, prompt, and chunk strategy versions;
- input/output tokens, latency, throughput, retries, pass/chunk counts;
- JSON/schema validity and deterministic grounding metrics;
- final output and internal grounding provenance.

A future persistence adapter may create a new `analysis_run` with `is_current=false`, `phase=shadow`, and explicit strategy/model versions. It must never overwrite a historical run or promote a shadow result implicitly.

## Consequences

- Real calls can be evaluated without changing official dashboards or production analysis.
- Filesystem artifacts need retention/PII handling and must stay outside Git.
- Promotion requires a separate human-reviewed step and a migration/adapter test if database persistence is added.
- The local endpoint remains loopback-only and is managed separately from the application worker.
