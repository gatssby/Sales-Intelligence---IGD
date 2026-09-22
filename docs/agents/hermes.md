# Hermes Agent setup

This repository uses Hermes Agent as a primary engineering agent.

## Project-local skills

Repo-local skills live under `.agents/skills/`.

Hermes must trust this repository before those skills load.

Command: hermes skills trust .

## Required global Hermes skills

The project workflows expect these global or builtin skills to be enabled:

- test-driven-development
- systematic-debugging
- requesting-code-review
- spike
- grounded-citations
- ponytail-review

Configure them with: hermes skills config

The first three must be enabled in All platforms (global default), not only in CLI.

## Canonical ownership

The project intentionally does not maintain local copies of:

- tdd
- diagnosing-bugs

Use instead:

- test-driven-development
- systematic-debugging

Project-owned custom skills:

- ask-matt
- code-review
- implement
- research
- to-spec

The remaining skills listed in skills-lock.json continue to be managed from their upstream source.

## Routing

Small implementation:
implement -> test-driven-development when applicable -> code-review

Bug or regression:
systematic-debugging -> test-driven-development for regression coverage

Large understood feature:
to-spec -> to-tickets -> implement

Large unclear effort:
wayfinder -> to-spec -> to-tickets -> implement

UI or interaction experiment:
prototype

Technical feasibility experiment:
spike

External factual research:
research -> grounded-citations
