---
name: implement
description: Implement a scoped task or ticket in this repository using Hermes global engineering skills and the repository's review workflow.
disable-model-invocation: true
---

# Implement

Implement the task, issue, or spec the user selected.

This skill orchestrates delivery. It does not replace the specialized global skills.

## 1. Establish the working context

Before editing:

1. read `AGENTS.md`;
2. read the relevant parts of `README.md` and `docs/architecture.md` when they exist;
3. read relevant `CONTEXT.md` files and ADRs;
4. inspect the current branch and working tree;
5. identify the concrete acceptance criteria.

Never silently overwrite unrelated work.

Never develop directly on `main`.

If the working tree already contains unrelated changes, preserve them and keep the task isolated.

## 2. Understand before implementing

Inspect the smallest relevant slice of the codebase.

Do not preload the entire repository unless the task genuinely requires it.

For bugs, use the global `systematic-debugging` skill before attempting a fix.

For architectural uncertainty, use `codebase-design` or a global `spike` before committing to an implementation.

For UI/state uncertainty, use local `prototype`.

## 3. Implement test-first when applicable

For production behavior changes, use the global:

`test-driven-development`

Follow RED → GREEN → REFACTOR in vertical slices.

Exceptions such as generated files, configuration-only changes, or throwaway prototypes follow the exception rules in the global skill.

Do not recreate the former project-local TDD workflow.

## 4. Keep the change narrow

Implement only what the task requires.

Avoid:

- speculative abstractions;
- unrelated cleanup;
- opportunistic dependency upgrades;
- broad refactors not required by the acceptance criteria.

If a necessary change expands the task materially, surface it before silently absorbing the extra scope.

## 5. Verify continuously

During implementation:

- run the narrowest relevant tests frequently;
- run typechecking/linting appropriate to the touched package;
- keep generated artifacts and secrets out of Git.

Before completion, run the repository-level verification appropriate to the change.

Never claim a check passed without actually running it.

## 6. Review

Run the local:

`code-review`

It verifies both:

- implementation quality;
- fidelity to the originating task/spec.

Address material findings before completion.

## 7. Commit discipline

Commit only files belonging to this task.

Do not include unrelated working-tree changes.

Use a concise commit message describing the delivered behavior.

Do not push unless the user or enclosing workflow explicitly asks for a push.

## Completion criteria

The task is complete only when:

- acceptance criteria are satisfied;
- relevant tests pass;
- lint/typecheck/build checks required by the touched area pass;
- local `code-review` has no unresolved material finding;
- no secrets, production PII, debug instrumentation, or generated local artifacts are staged;
- Git diff contains only the intended task.
