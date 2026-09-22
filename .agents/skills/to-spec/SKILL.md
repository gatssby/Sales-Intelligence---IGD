---
name: to-spec
description: Turn a sufficiently understood engineering effort into a proportionate implementation specification.
---

# To Spec

Convert the current discussion, research, prototypes, and repository context into a buildable specification.

Use this for work that benefits from a durable spec before being split into tickets.

Do not inflate a small task into a large document.

## Preconditions

Before writing the spec:

- the core problem should be understood;
- major product decisions should be settled;
- important unknowns should either be resolved or explicitly listed;
- relevant repository constraints should be known.

If fundamental decisions are still open, return to `grill-with-docs`, `research`, `prototype`, `spike`, or `wayfinder` as appropriate.

## Proportionality

The specification must be proportional to the work.

A small multi-step feature may need a short spec.

A cross-system or multi-session effort may need substantial detail.

Do not force long lists of user stories merely to make the document look complete.

Use user stories only when they improve clarity for genuinely user-facing behavior.

## Required content

Include the sections that materially apply:

### Problem / outcome

What problem is being solved and what observable outcome defines success?

### Context

Relevant existing behavior, repository constraints, domain terminology, ADRs, and dependencies.

### Scope

What is included.

### Non-goals

What is intentionally excluded.

### Required behavior

Concrete behaviors and invariants the implementation must preserve or introduce.

For product-facing work, use scenarios or user stories when useful.

For backend/data/infrastructure work, precise behavioral requirements are usually clearer than artificial user stories.

### Architecture constraints

Important seams, persistence rules, provider boundaries, compatibility requirements, migration constraints, or operational requirements.

Do not invent architecture beyond what the requirement needs.

### Data and security

When relevant:

- schemas;
- migrations;
- PII constraints;
- secrets;
- retention;
- idempotency;
- retries;
- auditability.

### Failure modes

Important errors, retries, partial failures, concurrency behavior, and recovery expectations.

### Verification

Define how the implementation will be proven correct:

- tests;
- typecheck/lint/build;
- fixtures;
- integration checks;
- observability;
- manual validation when unavoidable.

### Acceptance criteria

A concise, testable set of completion conditions.

### Open questions

Only unresolved questions that genuinely remain.

Do not hide unresolved design decisions inside implementation prose.

## Repository alignment

Respect `AGENTS.md`.

For this repository in particular, preserve documented rules around:

- PostgreSQL as operational source of truth;
- n8n as orchestration;
- AI provider abstraction;
- versioned prompts/rubrics/schemas;
- auditability;
- synthetic test data instead of production PII.

## Handoff

A completed spec should contain enough information for `to-tickets` to create vertical, independently understandable implementation tickets without reconstructing the original conversation.
