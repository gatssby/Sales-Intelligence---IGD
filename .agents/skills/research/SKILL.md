---
name: research
description: Research a question for this repository using primary sources, grounded citations, and Hermes delegation when useful.
---

# Research

Research a concrete question that is blocking design, planning, or implementation.

Research produces evidence. It does not silently make product decisions.

## Source hierarchy

Prefer, in order:

1. authoritative primary sources;
2. official documentation;
3. repository-local primary evidence;
4. high-quality secondary sources when primary material is insufficient.

For factual claims from external sources, use the global:

`grounded-citations`

Do not present unsupported assumptions as research findings.

## Delegation

The parent Hermes agent decides whether to:

- research directly;
- delegate independent reading tasks;
- use specialist agents.

Do not hardcode a model, provider, or delegation backend in this skill.

When multiple independent questions can be researched in parallel, delegation is appropriate.

## Repository-local research

Inspect relevant code, docs, Git history, ADRs, schemas, fixtures, and tests directly.

Distinguish clearly between:

- what the repository currently does;
- what documentation claims;
- what external sources recommend;
- your inference.

## Output

For transient research requested only for the current conversation, report the findings directly.

When another repository workflow needs a durable artifact, write a cited Markdown research note in an appropriate repository location and include:

- question;
- short answer;
- evidence;
- citations/links;
- uncertainties;
- implications for the pending decision.

Do not persist secrets, tokens, production PII, or sensitive captured payloads.

## Wayfinder integration

When `wayfinder` creates a research ticket:

- investigate only the ticket's question;
- record the evidence needed for that decision;
- return the findings to the parent decision flow;
- do not implement the destination feature as part of research.

## Completion criterion

Research is complete when the pending decision has enough reliable evidence to proceed, or when the remaining uncertainty is explicitly identified and cannot be resolved with the available sources.
