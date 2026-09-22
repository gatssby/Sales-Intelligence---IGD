---
name: ask-matt
description: Route engineering work in this repository to the appropriate local and global Hermes skills.
disable-model-invocation: true
---

# Ask Matt

Use this skill when the right workflow is unclear.

This repository combines:

- project-local skills in `.agents/skills`;
- global Hermes software-development skills;
- global review/research skills;
- Hermes delegation and routing.

Do not invent a workflow or refer to a skill that is not installed.

## Main engineering flow

### Small, well-scoped change

Use `implement`.

`implement` owns the normal delivery loop:

1. understand the task and repository constraints;
2. implement using the global `test-driven-development` skill when applicable;
3. run verification;
4. run the local `code-review` skill;
5. commit only task-related changes.

### Idea or design still needs clarification

Use `grill-with-docs`.

It combines:

- `grilling` for decisions;
- `domain-modeling` for shared terminology and durable domain decisions.

Once the problem is sufficiently clear:

- small effort → `implement`;
- multi-session effort → `to-spec` → `to-tickets` → `implement`.

### Large multi-session build

Use:

`to-spec` → `to-tickets` → `implement`

Use `to-spec` to capture the intended outcome and constraints.

Use `to-tickets` to split the work into vertical tracer-bullet tickets with explicit blockers.

Run `implement` independently for each ready ticket.

### Very large or foggy effort

Use `wayfinder`.

`wayfinder` resolves the unknown decisions first.

When the path becomes clear:

`wayfinder` → `to-spec` → `to-tickets` → `implement`

Do not use `wayfinder` for ordinary features.

## Bugs and failures

Use the global Hermes skill:

`systematic-debugging`

It is the canonical debugging workflow for this repository.

Use debugger-specific global skills only when they materially improve the feedback loop:

- `node-inspect-debugger` for Node.js;
- `python-debugpy` for Python.

After the root cause is known, use global `test-driven-development` for the regression test and fix.

Do not use or recreate the former local `diagnosing-bugs` workflow.

## Tests

Use the global Hermes skill:

`test-driven-development`

It is the canonical TDD workflow.

Tests should still respect:

- the domain vocabulary in `CONTEXT.md`, when present;
- repository ADRs;
- public behavior rather than implementation details;
- vertical slices rather than large horizontal batches.

Do not use or recreate the former local `tdd` skill.

## Code review

Use local:

`code-review`

It preserves the repository-specific Spec axis while composing global Hermes review capabilities.

For substantial changes it may also use:

- global `requesting-code-review`;
- `ponytail-review` for unnecessary complexity and over-engineering.

Ponytail is a simplicity review, not a bug-finding substitute.

## Prototype vs spike

Use local `prototype` when the unanswered question is experiential or visual:

- UI direction;
- interaction;
- state model that benefits from a runnable demonstration.

Use global `spike` when the unanswered question is primarily technical:

- feasibility;
- unfamiliar library or API;
- performance characteristic;
- integration risk;
- technology comparison.

Both are learning tools, not production implementation.

## Research

Use local `research`.

It coordinates repository research while relying on appropriate Hermes capabilities, including global `grounded-citations` when external factual grounding is required.

The parent Hermes agent decides whether research should be performed directly or delegated. Do not hardcode a model or provider in this skill.

## Incoming issues

Use `triage` only for raw incoming bugs or feature requests that have not already been converted into implementation-ready tickets.

Tickets produced by `to-tickets` do not need triage.

## Architecture and domain

Use `domain-modeling` when the problem is primarily domain language:

- ambiguous terminology;
- glossary changes;
- domain scenarios;
- ADR-worthy domain decisions.

Use `codebase-design` when the problem is module/interface design:

- seam placement;
- deep vs shallow modules;
- testability;
- adapters;
- locality and leverage.

Use `improve-codebase-architecture` for a broader architecture-health scan.

Global `codebase-inspection` and `simplify-code` may be used as supporting tools where useful.

## Research-driven large efforts

`wayfinder` may create research tickets.

Those tickets use the local `research` skill.

Research informs decisions. It does not silently make product or architectural decisions for the user.

## Repository rules always win

Before engineering work, respect `AGENTS.md`.

In this repository in particular:

- do not work directly on `main`;
- do not commit secrets or production PII;
- PostgreSQL is the operational source of truth;
- n8n is orchestration, not the primary business-rule store;
- structural decisions may require ADRs;
- prefer the current vertical-slice priority documented by the project.

## Routing principle

Use the smallest workflow that safely solves the problem.

Do not turn a small task into `wayfinder`, a simple fix into an architecture project, or a technical spike into production code.
