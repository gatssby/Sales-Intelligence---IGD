# System One V0.2 — transcript provenance and eligibility

Status: experimental, read-only audit and reusable domain infrastructure. No migration, PostgreSQL write, provider execution, inference, ASR, deploy, or production routing is authorized.

## Domain invariant

Behavioral evaluation requires preserved original speech. Source assets are classified before cohort selection as:

- `verified_transcript_candidate`: explicit transcript provenance; final eligibility still requires the secondary structural check;
- `ai_notes`: Gemini Notes, AI Notes, meeting notes, automatic summaries, or equivalent transformed content;
- `recording`: an identifiable original recording;
- `other_document`: a known non-transcript document type;
- `unknown`: provenance is absent, ambiguous, conflicting, or structurally unverified.

Only records satisfying both conditions below are eligible:

```text
eligible_for_system_one == true
AND asset_class == verified_transcript_candidate
AND structural_check_status == passed
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

A recording-only call may become eligible only after a future ASR process creates a transcript with explicit machine-transcript provenance. ASR is outside this round.

## Real Drive patterns observed on 2026-09-26

The existing OAuth integration was exercised read-only against the real Drive corpus before the classifier was revised. The observed distinctions are deterministic:

- Gemini Notes are Google Docs whose name, original filename, description, or source metadata carries `Anotações do Gemini` or an equivalent notes signal. Their exported text can contain many speaker-labelled turns and timestamps, so conversational structure is not transcript provenance.
- Google Meet transcripts exist as caption files with MIME type `text/plain` and `fullFileExtension=sbv`; WebVTT voice cues are also structurally recognized. Their names do not necessarily contain `Transcript` or `Transcrição`.
- A second real transcript pattern is an explicitly named Google Doc with dense multi-speaker turns but no timestamp cues. The structural check admits that pattern only at the observed minimum density; filename alone remains insufficient.
- The sampled SBV transcript was created alongside a `video/mp4` recording in the same parent and timestamp window.
- Recordings use media MIME types (`video/*`, `audio/*`) or `application/vnd.google-apps.vid` and remain ineligible without a verified transcript.
- No useful `properties` or `appProperties` discriminator appeared in the corpus. The inventory stores only hashes of property keys so future stable metadata can be adopted without storing names or values.

The classifier therefore gives AI-note signals first priority, recognizes SBV/VTT caption provenance independently of filenames, and uses explicit transcript naming only as a second provenance route. Structural validation never promotes an unknown document.

## Reusable code boundary

`@igd/core` owns `classifySystemOneSource`, `reconstructSystemOneLogicalCalls`, and `selectEligibleSystemOneCalls`. The reconstruction associates assets only when exactly one identical Drive parent, normalized generated-meeting basename, and normalized exact Drive creation instant agree. Missing/invalid creation time or zero/multiple parents isolates the asset rather than guessing an association. It fails closed when more than one valid transcript or any unknown-provenance asset competes in an associated group. It never falls back to AI notes, recordings, or unknown assets.

The inventory also aborts before reconstruction when the Drive API reports `incompleteSearch`, any enabled root is not a folder, or any enabled-root listing/file canonicalization fails. It never reports an eligibility decision from a partial Drive traversal.

For a current `public.calls` row whose Drive file cannot be read, the comparison records an opaque unresolved reference and marks that row ineligible with `unresolvable_drive_reference`; it never promotes such a row or treats it as a confident match. The summary marks that comparison slice as `partial_fail_closed`.

The active ingestion classifier continues to fail closed before Call creation. The V0.2 inventory classifier is narrower and corpus-backed: AI-note names are always excluded, SBV/VTT provenance is recognized from Drive metadata, and explicit transcript naming is accepted only as a candidate. Eligibility requires either timestamped multi-speaker dialogue or the observed dense untimestamped multi-speaker structure.

## Deterministic Drive inventory

Run the reusable dry-run with the existing protected OAuth and database environment:

```bash
npm run system-one:drive:inventory
```

The command:

1. validates that the OAuth token includes `drive.readonly` and rejects any write-capable Drive scope;
2. catalogs direct `Shared with me` files and recursively scans only explicitly enabled folder roots; shared folder candidates are counted but not traversed until enabled;
3. resolves shortcuts and deduplicates by canonical Drive file ID;
4. reads current `calls.transcript_file_id` values inside an explicitly read-only PostgreSQL transaction and resolves those IDs through Drive;
5. exports text only for provenance-backed transcript candidates;
6. reconstructs logical calls and compares them with the current `public.calls` rows;
7. writes only blinded, sanitized artifacts under ignored `private/system-one/`.

The script has no apply mode, provider import, inference endpoint, database mutation, or transcript persistence path. Re-execution is byte-stable for unchanged Drive and database metadata.

## Rebuild recommendation

Use option **B: a new staging/read model reconciled with `public.calls`**. The current schema makes `calls.transcript_file_id` both canonical call identity and the presumed transcript identity, while historical imports may point that field at Gemini Notes or recordings. Rewriting that column in place would blur source history and make deduplication destructive.

The safe target flow is:

```text
Drive assets
  → staged logical calls
  → selected verified transcript
  → persisted eligibility/provenance
  → reconciliation map to legacy public.calls
  → analysis queue
```

`public.calls` and prior analyses remain unchanged until a separately approved reconciliation applies additive provenance tables, maps zero or more legacy rows to one staged logical call, and switches queue reads only after count and exception review. A legacy row remains eligible only when its referenced Drive asset is the selected verified transcript; a Gemini Notes row sharing a logical meeting must be remapped explicitly rather than treated as eligible in place.

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
