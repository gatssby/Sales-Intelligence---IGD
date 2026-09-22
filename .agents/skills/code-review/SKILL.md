---
name: code-review
description: Review a change against both its originating specification and Hermes global quality/safety review standards.
---

# Code Review

Review a diff along independent axes.

Do not collapse them into one vague pass/fail judgment.

## 1. Establish the comparison point

Use the fixed point supplied by the user when one exists.

Otherwise determine the repository default branch and compare the current branch against its merge-base.

Confirm:

- the reference resolves;
- the diff is non-empty;
- the commit range is understood.

## 2. Locate the originating requirement

Find the source of intended behavior, in this order:

1. referenced GitHub issue or ticket;
2. explicit spec path supplied by the user;
3. matching spec under repository documentation;
4. acceptance criteria in the current conversation.

If no spec exists, state that the Spec axis is unavailable rather than inventing requirements.

## 3. Spec axis

Review the diff for:

- missing requirements;
- partially implemented requirements;
- implementation inconsistent with the requested behavior;
- scope creep;
- behavior added without a supporting requirement.

Tie every finding to the originating requirement where possible.

## 4. Quality axis

Use the global Hermes:

`requesting-code-review`

Let it perform the general engineering review, including relevant:

- safety checks;
- test verification;
- static/quality checks;
- independent code review.

Repository rules in `AGENTS.md` override generic guidance when they conflict.

## 5. Simplicity axis when useful

For a substantial or structurally complex diff, use:

`ponytail-review`

Use it specifically to detect:

- unnecessary abstractions;
- excessive indirection;
- speculative flexibility;
- over-engineering;
- complexity that can be removed without changing behavior.

Do not use Ponytail as a substitute for debugging or correctness review.

Skip it for trivial changes where it adds no value.

## 6. Report

Keep the axes separate:

### Spec
Requirements fidelity findings.

### Quality
Findings from the global review workflow.

### Simplicity
Ponytail findings when that review was run.

Do not let a clean axis hide a problem in another one.

Prioritize actionable findings with concrete file/location evidence.

If an axis has no material findings, say so explicitly.
