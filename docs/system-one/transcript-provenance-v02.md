# System One V0.2 — transcript provenance and eligibility

Status: experimental, read-only audit and reusable domain infrastructure. No migration, PostgreSQL write, provider execution, inference, ASR, deploy, or production routing is authorized.

## Domain invariant

Behavioral evaluation requires preserved original speech. Source assets are classified before cohort selection as:

- `verified_transcript`: explicit transcript provenance plus a secondary structural check consistent with preserved conversation;
- `ai_notes`: Gemini Notes, AI Notes, meeting notes, automatic summaries, or equivalent transformed content;
- `recording_only`: an identifiable original recording without an eligible transcript;
- `unknown`: provenance is absent, ambiguous, conflicting, or structurally unverified.

Only records satisfying both conditions below are eligible:

```text
eligible_for_system_one == true
AND provenance_class == verified_transcript
```

The invariant is fail-closed. Structural characteristics cannot promote AI notes or provenance-free text. Missing provenance, narrative structure, and unresolved conflicts remain ineligible.

## Required pipeline order

```text
source assets
  ↓
provenance classification
  ↓
logical-call asset reconciliation
  ↓
verified transcript pool
  ↓
cohort selection / sampling / balancing
  ↓
chunking
  ↓
System One analysis
```

A logical call may have a verified transcript, AI notes, a recording, and other assets. It counts once. The selected analysis asset is the verified transcript only. AI notes remain available to other products but never substitute for original speech in behavioral evaluation, human labels, model comparison, or future training data.

A `recording_only` call may become eligible only after a future ASR process creates a transcript with explicit machine-transcript provenance. ASR is outside this round.

## Reusable code boundary

`@igd/core` owns `classifySystemOneSource` and `selectEligibleSystemOneCalls`. The selector applies the invariant before any sampling and deduplicates by logical call identity. It never falls back to AI notes, recordings, or unknown assets.

The active Drive classifier now fails closed before Call creation: AI-note names are ignored, and folder context or conversational-looking content cannot promote a document. Only explicit transcript naming is admitted as a candidate; the reusable System One selector still requires the secondary structural check before eligibility.

## Current database audit limitation

The approved `system_one_pilot_ro` role exposes the `calls` and `transcripts` fields needed for a bounded audit, but not `drive_documents`, `call_artifacts`, `call_sources`, or recording metadata. The persisted transcript source `manual_or_programmatic_import` does not prove whether the source document preserved original speech. Those rows therefore remain `unknown`, even when their text has speaker-like structure.

The private audit catalog records only blinded identifiers and sanitized cohort metadata. It contains no transcript body. Recording and multi-asset combination counts remain `unknown` when the read-only provenance surface cannot establish them.

## Original 30-call cohort

The V0.1 cohort and all historical outputs remain unchanged. Each historical call is classified through the same V0.2 provenance invariant. A historical result is potentially usable as behavioral benchmark evidence only when its selected asset is a `verified_transcript`; all other classes remain useful only for mechanical/schema testing.

## `/admin/ai` current semantics

The route `apps/web/app/admin/ai/page.tsx` calls `getProgressData`, which calls `ScopedSalesRepository.getBacklogProgress`. Its `total` currently comes from:

```sql
with scoped as (
  select c.id
  from calls c
  join sellers s on s.id = c.seller_id
  where <authorization scope> and <selected organization scope>
)
select count(*) from scoped
```

Therefore the displayed total counts logical rows in `public.calls` within scope. It does not currently require a transcript, verify provenance, inspect recordings, or apply System One eligibility. It cannot count Transcript and Gemini Notes as two calls when both are linked to the same `calls.id`, but separate incorrectly-created call rows could still be double-counted. It includes calls without transcripts and may include calls whose persisted transcript came from AI notes or unknown provenance.

The desired meaning is the count of distinct logical calls selected by the same verified-transcript eligibility relation used by System One. Wiring that count into production safely requires a provenance read model or persisted classification surface. Because the current schema and approved role do not provide that relation, the UI query was not changed and no migration or placeholder SQL was created.

## Safety

- PostgreSQL audit transactions are explicitly read-only.
- No INSERT, UPDATE, DELETE, schema change, or migration is used.
- No transcript, real Call ID, name, email, phone, or credential is printed.
- Private catalogs use mode `0600`; `private/system-one` uses `0700`.
- No provider, Laya, Jev, GPT, Gemini, or ASR execution is part of this workflow.
