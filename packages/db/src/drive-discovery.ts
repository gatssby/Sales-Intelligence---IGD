import type { Sql } from "postgres";

export type DriveSource = {
  sourceId: string;
  googleFileId: string;
  name: string | null;
  sellerId: string | null;
  resourceKey: string | null;
  lastScanAt: string | null;
  lastFullScanAt: string | null;
};

export type DriveDiscoveryState = {
  changesPageToken: string | null;
  bootstrapCompletedAt: string | null;
  lastChangesScanAt: string | null;
  lastSharedWithMeScanAt: string | null;
};

export type DriveDocumentInput = {
  sourceId: string;
  googleFileId: string;
  name: string;
  mimeType: string | null;
  parentIds: string[];
  ancestorIds?: string[];
  ancestorNames?: string[];
  shortcutFileId?: string | null;
  webViewLink?: string | null;
  driveId?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  sharedWithMeTime?: string | null;
  googleVersion?: string | null;
  transcriptStatus: "discovered" | "candidate" | "identified" | "needs_review" | "ignored" | "inaccessible" | "ready" | "processed";
  documentType: "folder" | "shortcut" | "transcript" | "document" | "other";
  classificationMethod?: string | null;
  classificationConfidence?: number | null;
  rawMetadata?: Record<string, unknown>;
};

export type ReconcileDriveDocumentInput = {
  documentId: string;
  sellerCode: string;
  primaryCloserId: string;
  participantPersonIds: string[];
  productKey: string;
  teamId?: string | null;
  membershipId?: string | null;
  startedAt: string;
  callTimeMethod: string;
  callTimeConfidence: number;
  attributionMethod: string;
  attributionConfidence: number;
  attributionProvenance: Array<{ method: string; source: string }>;
  attributionCandidatePersonIds: string[];
  requestAnalysis: boolean;
};

export type DriveDataQualitySnapshot = {
  driveSources: number;
  documentsDiscovered: number;
  transcriptCandidates: number;
  linkedCalls: number;
  closerResolved: number;
  closerUnresolved: number;
  needsAttributionReview: number;
  productUnresolved: number;
  frontUnresolved: number;
  teamUnresolved: number;
  inaccessible: number;
  ignored: number;
  awaitingAnalysis: number;
  processing: number;
  analyzed: number;
};

function asDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid_drive_timestamp");
  return date;
}

export class PostgresDriveDiscoveryRepository {
  constructor(readonly sql: Sql) {}

  async upsertSourceCandidate(input: {
    googleFileId: string; name: string; mimeType: string; resourceKey?: string | null; driveId?: string | null;
  }): Promise<{ sourceId: string; created: boolean }> {
    if (input.mimeType !== "application/vnd.google-apps.folder") throw new Error("drive_source_must_be_folder");
    const rows = await this.sql<{ id: string; created: boolean }[]>`
      insert into source_locations (
        seller_id, provider, external_folder_id, active, name, source_type, registration_status, metadata
      ) values (
        null, 'google_drive', ${input.googleFileId}, false, ${input.name}, 'folder', 'candidate',
        ${this.sql.json({ discovery: "shared_with_me", resource_key: input.resourceKey ?? null, drive_id: input.driveId ?? null })}
      )
      on conflict (provider, external_folder_id) do update set
        name=excluded.name,
        metadata=source_locations.metadata||excluded.metadata,
        updated_at=now()
      returning id, (xmax=0) created
    `;
    return { sourceId: rows[0].id, created: rows[0].created };
  }

  async setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
    const rows = await this.sql`
      update source_locations set active=${enabled}, registration_status=${enabled ? "enabled" : "disabled"},
        scan_lease_owner=null, scan_lease_expires_at=null, updated_at=now()
      where id=${sourceId} and provider='google_drive'
      returning id
    `;
    if (!rows.length) throw new Error("drive_source_not_found");
  }

  async getSharedInboxSourceId(): Promise<string> {
    const rows = await this.sql<{ id: string }[]>`
      select id from source_locations
      where provider='google_drive' and source_type='shared_inbox' and external_folder_id='sharedWithMeInbox'
      limit 1
    `;
    if (!rows[0]) throw new Error("drive_shared_inbox_missing");
    return rows[0].id;
  }

  async listEnabledSources(): Promise<DriveSource[]> {
    const rows = await this.sql<{
      id: string; external_folder_id: string; name: string | null; seller_id: string | null; resource_key: string | null; last_scan_at: Date | null; last_full_scan_at: Date | null;
    }[]>`
      select id, external_folder_id, name, seller_id, metadata->>'resource_key' resource_key, last_scan_at, last_full_scan_at
      from source_locations
      where provider='google_drive' and source_type='folder' and active=true and registration_status='enabled'
      order by last_scan_at asc nulls first, id
    `;
    return rows.map((row) => ({
      sourceId: row.id,
      googleFileId: row.external_folder_id,
      name: row.name,
      sellerId: row.seller_id,
      resourceKey: row.resource_key,
      lastScanAt: row.last_scan_at?.toISOString() ?? null,
      lastFullScanAt: row.last_full_scan_at?.toISOString() ?? null,
    }));
  }

  async listSourceRegistrations(): Promise<Array<{
    sourceId: string; name: string | null; registrationStatus: "candidate" | "enabled" | "disabled";
    enabled: boolean; lastScanAt: string | null; lastFullScanAt: string | null;
  }>> {
    const rows = await this.sql<{
      id: string; name: string | null; registration_status: "candidate" | "enabled" | "disabled";
      active: boolean; last_scan_at: Date | null; last_full_scan_at: Date | null;
    }[]>`
      select id,name,registration_status,active,last_scan_at,last_full_scan_at
      from source_locations
      where provider='google_drive' and source_type='folder'
      order by registration_status,name nulls last,id
    `;
    return rows.map((row) => ({
      sourceId: row.id,
      name: row.name,
      registrationStatus: row.registration_status,
      enabled: row.active,
      lastScanAt: row.last_scan_at?.toISOString() ?? null,
      lastFullScanAt: row.last_full_scan_at?.toISOString() ?? null,
    }));
  }

  async claimNextSource(input: { workerId: string; leaseSeconds: number }): Promise<DriveSource | null> {
    if (!input.workerId.trim() || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30) {
      throw new Error("invalid_drive_source_claim");
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx<{
        id: string; external_folder_id: string; name: string | null; seller_id: string | null; resource_key: string | null; last_scan_at: Date | null; last_full_scan_at: Date | null;
      }[]>`
        select id, external_folder_id, name, seller_id, metadata->>'resource_key' resource_key, last_scan_at, last_full_scan_at
        from source_locations
        where provider='google_drive' and source_type='folder' and active=true and registration_status='enabled'
          and (scan_lease_expires_at is null or scan_lease_expires_at < now())
        order by last_scan_at asc nulls first, id
        for update skip locked
        limit 1
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        update source_locations set scan_lease_owner=${input.workerId},
          scan_lease_expires_at=now()+(${input.leaseSeconds}*interval '1 second'), updated_at=now()
        where id=${row.id}
      `;
      return {
        sourceId: row.id,
        googleFileId: row.external_folder_id,
        name: row.name,
        sellerId: row.seller_id,
        resourceKey: row.resource_key,
        lastScanAt: row.last_scan_at?.toISOString() ?? null,
        lastFullScanAt: row.last_full_scan_at?.toISOString() ?? null,
      };
    });
  }

  async claimSourceById(input: { sourceId: string; workerId: string; leaseSeconds: number }): Promise<DriveSource | null> {
    if (!input.workerId.trim() || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30) {
      throw new Error("invalid_drive_source_claim");
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx<{
        id: string; external_folder_id: string; name: string | null; seller_id: string | null; resource_key: string | null; last_scan_at: Date | null; last_full_scan_at: Date | null;
      }[]>`
        select id, external_folder_id, name, seller_id, metadata->>'resource_key' resource_key, last_scan_at, last_full_scan_at
        from source_locations
        where id=${input.sourceId} and provider='google_drive' and source_type='folder' and active=true and registration_status='enabled'
          and (scan_lease_expires_at is null or scan_lease_expires_at < now())
        for update skip locked
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        update source_locations set scan_lease_owner=${input.workerId},
          scan_lease_expires_at=now()+(${input.leaseSeconds}*interval '1 second'), updated_at=now()
        where id=${row.id}
      `;
      return {
        sourceId: row.id, googleFileId: row.external_folder_id, name: row.name,
        sellerId: row.seller_id, lastScanAt: row.last_scan_at?.toISOString() ?? null,
        resourceKey: row.resource_key,
        lastFullScanAt: row.last_full_scan_at?.toISOString() ?? null,
      };
    });
  }

  async completeSourceScan(input: { sourceId: string; workerId: string; fullScan: boolean; success: boolean }): Promise<void> {
    await this.sql`
      update source_locations set
        last_scan_at=case when ${input.success} then now() else last_scan_at end,
        last_full_scan_at=case when ${input.success && input.fullScan} then now() else last_full_scan_at end,
        last_synced_at=case when ${input.success} then now() else last_synced_at end,
        scan_lease_owner=null, scan_lease_expires_at=null, updated_at=now()
      where id=${input.sourceId} and scan_lease_owner=${input.workerId}
    `;
  }

  async renewSourceLease(input: { sourceId: string; workerId: string; leaseSeconds: number }): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      update source_locations set scan_lease_expires_at=now()+(${input.leaseSeconds}*interval '1 second'),updated_at=now()
      where id=${input.sourceId} and scan_lease_owner=${input.workerId} and scan_lease_expires_at>now()
      returning id
    `;
    return rows.length === 1;
  }

  async deactivateSourceDocumentsNotSeenSince(input: { sourceId: string; scanStartedAt: string }): Promise<number> {
    const rows = await this.sql<{ id: string }[]>`
      update drive_document_sources set active=false
      where source_location_id=${input.sourceId} and active=true
        and last_seen_at < ${asDate(input.scanStartedAt)}
      returning drive_document_id id
    `;
    return rows.length;
  }

  async upsertDocument(input: DriveDocumentInput): Promise<{
    documentId: string; created: boolean; changed: boolean; needsResolution: boolean;
  }> {
    return this.sql.begin(async (tx) => {
      const previous = await tx<{
        mime_type: string | null; name: string; parent_ids: string[]; modified_time: Date | null; google_version: string | null;
      }[]>`
        select mime_type,name,parent_ids,modified_time,google_version
        from drive_documents where google_file_id=${input.googleFileId}
        for update
      `;
      const rows = await tx<{ id: string; created: boolean; call_id: string | null; transcript_status: string }[]>`
        insert into drive_documents (
            google_file_id, mime_type, name, parent_ids, web_view_link, drive_id,
            created_time, modified_time, shared_with_me_time, google_version,
            document_type, transcript_status, classification_method, classification_confidence,
            raw_metadata, last_classified_at
          ) values (
            ${input.googleFileId}, ${input.mimeType}, ${input.name}, ${input.parentIds}, ${input.webViewLink ?? null}, ${input.driveId ?? null},
            ${asDate(input.createdTime)}, ${asDate(input.modifiedTime)}, ${asDate(input.sharedWithMeTime)}, ${input.googleVersion ?? null},
            ${input.documentType}, ${input.transcriptStatus}, ${input.classificationMethod ?? null}, ${input.classificationConfidence ?? null},
            ${tx.json(JSON.parse(JSON.stringify(input.rawMetadata ?? {})))}, now()
          )
          on conflict (google_file_id) do update set
            mime_type=excluded.mime_type,
            name=excluded.name,
            parent_ids=excluded.parent_ids,
            web_view_link=excluded.web_view_link,
            drive_id=excluded.drive_id,
            created_time=excluded.created_time,
            modified_time=excluded.modified_time,
            shared_with_me_time=excluded.shared_with_me_time,
            google_version=excluded.google_version,
            document_type=excluded.document_type,
            transcript_status=case
              when drive_documents.transcript_status in ('ready','processed') and excluded.transcript_status not in ('inaccessible')
                then drive_documents.transcript_status
              else excluded.transcript_status
            end,
            classification_method=excluded.classification_method,
            classification_confidence=excluded.classification_confidence,
            raw_metadata=excluded.raw_metadata,
            removed=false,
            inaccessible_reason=null,
            last_seen_at=now(),
            last_classified_at=now(),
            updated_at=now()
        returning id, (xmax=0) created, call_id, transcript_status
      `;
      const row = rows[0];
      const prior = previous[0];
      const modifiedTime = asDate(input.modifiedTime);
      const changed = row.created || !prior
        || prior.mime_type !== input.mimeType
        || prior.name !== input.name
        || JSON.stringify(prior.parent_ids) !== JSON.stringify(input.parentIds)
        || prior.modified_time?.getTime() !== modifiedTime?.getTime()
        || prior.google_version !== (input.googleVersion ?? null);
      await tx`
        insert into drive_document_sources (
          drive_document_id, source_location_id, ancestor_ids, ancestor_names, shortcut_file_id
        ) values (
          ${row.id}, ${input.sourceId}, ${input.ancestorIds ?? []}, ${input.ancestorNames ?? []}, ${input.shortcutFileId ?? null}
        )
        on conflict (drive_document_id, source_location_id) do update set
          ancestor_ids=excluded.ancestor_ids,
          ancestor_names=excluded.ancestor_names,
          shortcut_file_id=excluded.shortcut_file_id,
          active=true,
          last_seen_at=now(),
          metadata=excluded.metadata
      `;
      return {
        documentId: row.id,
        created: row.created,
        changed,
        needsResolution: row.call_id === null && ["candidate", "identified", "needs_review"].includes(row.transcript_status),
      };
    });
  }

  async markDocumentInaccessible(googleFileId: string, reason: string): Promise<void> {
    const safeReason = reason.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "drive_inaccessible";
    await this.sql`
      update drive_documents set transcript_status='inaccessible', attribution_status='unresolved',
        inaccessible_reason=${safeReason}, removed=${safeReason === "drive_removed"}, updated_at=now()
      where google_file_id=${googleFileId}
    `;
  }

  async recordDocumentResolution(input: {
    documentId: string;
    status: "unresolved" | "resolved" | "needs_review";
    personId?: string | null;
    attributionMethod?: string | null;
    attributionConfidence?: number | null;
    attributionProvenance?: Array<{ method: string; source: string }>;
    attributionCandidatePersonIds?: string[];
    startedAt?: string | null;
    callTimeMethod?: string | null;
    callTimeConfidence?: number | null;
    transcriptStatus?: "identified" | "needs_review" | "inaccessible";
  }): Promise<void> {
    await this.sql`
      update drive_documents set
        attribution_status=${input.status},
        primary_closer_id=${input.personId ?? null},
        attribution_method=${input.attributionMethod ?? null},
        attribution_confidence=${input.attributionConfidence ?? null},
        attribution_provenance=${this.sql.json(input.attributionProvenance ?? [])},
        attribution_candidate_person_ids=${input.attributionCandidatePersonIds ?? []},
        possible_call_started_at=${asDate(input.startedAt)},
        call_time_method=${input.callTimeMethod ?? null},
        call_time_confidence=${input.callTimeConfidence ?? null},
        transcript_status=coalesce(${input.transcriptStatus ?? null}, transcript_status),
        updated_at=now()
      where id=${input.documentId}
    `;
  }

  async linkDocumentToExistingCall(documentId: string, requestAnalysis = false): Promise<{ callId: string; closerResolved: boolean } | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<{
        document_id: string; google_file_id: string; web_view_link: string | null; document_name: string;
        mime_type: string | null; resource_key: string | null;
        call_id: string; seller_code: string | null; primary_closer_id: string | null; seller_person_id: string | null;
        seller_team_id: string | null;
        transcript_present: boolean; analysis_completed: boolean;
      }[]>`
        select d.id document_id,d.google_file_id,d.web_view_link,d.name document_name,d.mime_type,d.raw_metadata->>'resource_key' resource_key,
          c.id call_id,s.seller_code,c.primary_closer_id,s.person_id seller_person_id,s.team_id seller_team_id,
          exists(select 1 from transcripts t where t.call_id=c.id) transcript_present,
          exists(select 1 from analysis_runs ar where ar.call_id=c.id and ar.status='completed' and ar.is_current) analysis_completed
        from drive_documents d
        join calls c on c.transcript_file_id=d.google_file_id
        join sellers s on s.id=c.seller_id
        where d.id=${documentId}
        for update of d,c
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        insert into call_sources (
          call_id,source_type,source_external_id,source_uri,transcript_file_id,transcript_url,metadata
        ) values (
          ${row.call_id},'google_drive_discovery',${row.google_file_id},${row.web_view_link},
          ${row.google_file_id},${row.web_view_link},${tx.json({ drive_document_id: row.document_id, document_name: row.document_name, mime_type: row.mime_type, resource_key: row.resource_key })}
        )
        on conflict (source_type,source_external_id) do update set
          call_id=excluded.call_id,source_uri=excluded.source_uri,transcript_file_id=excluded.transcript_file_id,
          transcript_url=excluded.transcript_url,last_seen_at=now(),metadata=excluded.metadata,updated_at=now()
      `;
      const primaryCloserId = row.primary_closer_id ?? row.seller_person_id;
      if (primaryCloserId) {
        await tx`
          update calls set primary_closer_id=coalesce(primary_closer_id,${primaryCloserId}),
            legacy_team_snapshot_id=coalesce(legacy_team_snapshot_id,${row.seller_team_id}),
            organization_attribution_method=coalesce(organization_attribution_method,'legacy_current_snapshot'),
            attribution_method=coalesce(attribution_method,'legacy_seller'),
            attribution_confidence=coalesce(attribution_confidence,1),
            attribution_provenance=case when attribution_provenance='[]'::jsonb
              then '[{"method":"legacy_seller"}]'::jsonb else attribution_provenance end,
            updated_at=now()
          where id=${row.call_id}
        `;
        await tx`
          insert into call_participants(call_id,person_id,participant_role,attribution_method,confidence)
          values (${row.call_id},${primaryCloserId},'primary_closer','legacy_seller',1)
          on conflict (call_id,person_id) do update set
            participant_role='primary_closer',confidence=greatest(call_participants.confidence,1),updated_at=now()
        `;
      }
      if (requestAnalysis && !row.analysis_completed) {
        await tx`update calls set analysis_eligible=true,updated_at=now() where id=${row.call_id}`;
        await tx`
          insert into analysis_jobs(call_id,status,stage)
          values (${row.call_id},${row.transcript_present ? "ready" : "awaiting_transcript"},${row.transcript_present ? "queue" : "transcript"})
          on conflict(call_id) do nothing
        `;
      }
      await tx`
        update drive_documents set call_id=${row.call_id},
          transcript_status=${row.analysis_completed ? "processed" : row.transcript_present ? "ready" : "identified"},
          attribution_status=${primaryCloserId ? "resolved" : "unresolved"},
          attribution_method=case when ${primaryCloserId !== null} then 'legacy_seller' else attribution_method end,
          attribution_confidence=case when ${primaryCloserId !== null} then 1 else attribution_confidence end,
          attribution_provenance=case when ${primaryCloserId !== null}
            then '[{"method":"legacy_seller"}]'::jsonb else attribution_provenance end,
          primary_closer_id=coalesce(primary_closer_id,${primaryCloserId}),updated_at=now()
        where id=${row.document_id}
      `;
      return { callId: row.call_id, closerResolved: primaryCloserId !== null };
    });
  }

  async reconcileDocumentToCall(input: ReconcileDriveDocumentInput): Promise<{ callId: string; created: boolean; matchedExisting: boolean }> {
    return this.sql.begin(async (tx) => {
      const documents = await tx<{
        id: string; google_file_id: string; web_view_link: string | null; name: string;
        mime_type: string | null; resource_key: string | null;
        transcript_status: string; call_id: string | null;
      }[]>`
        select id, google_file_id, web_view_link, name, mime_type, raw_metadata->>'resource_key' resource_key, transcript_status, call_id
        from drive_documents where id=${input.documentId} for update
      `;
      const document = documents[0];
      if (!document) throw new Error("drive_document_not_found");
      if (["ignored", "inaccessible"].includes(document.transcript_status)) throw new Error("drive_document_not_reconcilable");

      const sellers = await tx<{ seller_id: string; person_id: string }[]>`
        select id seller_id, person_id from sellers
        where upper(seller_code)=upper(${input.sellerCode}) and person_id=${input.primaryCloserId}
        limit 1
      `;
      if (!sellers[0]) throw new Error("primary_closer_seller_mismatch");
      const outcomes = await tx<{
        call_id: string; created: boolean; transcript_present: boolean; official_analysis_completed: boolean;
      }[]>`
        select * from upsert_call_source(
          ${input.sellerCode}, null, null, ${input.productKey}, ${asDate(input.startedAt)}, null, 'google_drive_discovery',
          ${document.google_file_id}, ${document.web_view_link}, null,
          'google_drive_discovery', ${document.google_file_id}, ${document.web_view_link},
          ${tx.json({ drive_document_id: document.id, document_name: document.name, mime_type: document.mime_type, resource_key: document.resource_key })}
        )
      `;
      const outcome = outcomes[0];
      const existing = await tx<{
        primary_closer_id: string | null; seller_person_id: string | null; started_at: Date | null;
      }[]>`
        select c.primary_closer_id, s.person_id seller_person_id, c.started_at
        from calls c join sellers s on s.id=c.seller_id where c.id=${outcome.call_id}
      `;
      const attributionConflict = Boolean(
        (existing[0].primary_closer_id && existing[0].primary_closer_id !== input.primaryCloserId)
        || (existing[0].seller_person_id && existing[0].seller_person_id !== input.primaryCloserId),
      );
      const proposedStartedAt = asDate(input.startedAt)!;
      const callTimeConflict = Boolean(
        !outcome.created && existing[0].started_at
        && Math.abs(existing[0].started_at.getTime() - proposedStartedAt.getTime()) > 1_000,
      );
      const conflict = attributionConflict || callTimeConflict;
      const teams = input.teamId
        ? await tx<{ front_key: string | null }[]>`select front_key from teams where id=${input.teamId}`
        : [];
      await tx`
        update calls set
          primary_closer_id=case when ${conflict} then primary_closer_id else coalesce(primary_closer_id, ${input.primaryCloserId}) end,
          team_id=coalesce(team_id, ${input.teamId ?? null}),
          front_key=coalesce(front_key, ${teams[0]?.front_key ?? null}),
          resolved_membership_id=coalesce(resolved_membership_id, ${input.membershipId ?? null}),
          organization_attribution_method=coalesce(organization_attribution_method,'temporal_membership'),
          attribution_method=case when ${attributionConflict} then attribution_method else coalesce(attribution_method, ${input.attributionMethod}) end,
          attribution_confidence=case when ${attributionConflict} then attribution_confidence else coalesce(attribution_confidence, ${input.attributionConfidence}) end,
          attribution_provenance=case when ${attributionConflict} then attribution_provenance else ${tx.json(input.attributionProvenance)} end,
          attribution_candidate_person_ids=${input.attributionCandidatePersonIds},
          needs_attribution_review=${attributionConflict},
          call_time_method=case when ${callTimeConflict} then call_time_method else coalesce(call_time_method, ${input.callTimeMethod}) end,
          call_time_confidence=case when ${callTimeConflict} then call_time_confidence else coalesce(call_time_confidence, ${input.callTimeConfidence}) end,
          needs_call_time_review=${callTimeConflict},
          analysis_eligible=case
            when ${outcome.created} then ${input.requestAnalysis}
            else calls.analysis_eligible or ${input.requestAnalysis}
          end,
          status=case when ${conflict} and status<>'analyzed' then 'needs_review' else status end,
          updated_at=now()
        where id=${outcome.call_id}
      `;
      for (const personId of [...new Set(input.participantPersonIds)]) {
        await tx`
          insert into call_participants (call_id, person_id, participant_role, attribution_method, confidence)
          values (
            ${outcome.call_id}, ${personId}, ${personId === input.primaryCloserId ? "primary_closer" : "other_igd"},
            ${input.attributionMethod}, ${input.attributionConfidence}
          )
          on conflict (call_id, person_id) do update set
            participant_role=case when excluded.participant_role='primary_closer' then 'primary_closer' else call_participants.participant_role end,
            attribution_method=excluded.attribution_method,
            confidence=greatest(call_participants.confidence, excluded.confidence),
            updated_at=now()
        `;
      }
      await tx`
        update drive_documents set
          call_id=${outcome.call_id},
          transcript_status=${conflict ? "needs_review" : "ready"},
          attribution_status=${conflict ? "needs_review" : "resolved"},
          attribution_method=${input.attributionMethod},
          attribution_confidence=${input.attributionConfidence},
          attribution_provenance=${tx.json(input.attributionProvenance)},
          attribution_candidate_person_ids=${input.attributionCandidatePersonIds},
          primary_closer_id=case when ${attributionConflict} then primary_closer_id else ${input.primaryCloserId} end,
          possible_call_started_at=${asDate(input.startedAt)},
          call_time_method=${input.callTimeMethod},
          call_time_confidence=${input.callTimeConfidence},
          updated_at=now()
        where id=${document.id}
      `;
      if (input.requestAnalysis && !conflict && !outcome.official_analysis_completed) {
        await tx`
          insert into analysis_jobs(call_id,status,stage)
          values (${outcome.call_id}, ${outcome.transcript_present ? "ready" : "awaiting_transcript"}, ${outcome.transcript_present ? "queue" : "transcript"})
          on conflict (call_id) do nothing
        `;
      }
      return { callId: outcome.call_id, created: outcome.created, matchedExisting: !outcome.created };
    });
  }

  async getPeopleDirectory(): Promise<Array<{ personId: string; sellerId: string | null; sellerCode: string | null; fullName: string; email: string | null; aliases: string[] }>> {
    const rows = await this.sql<{
      id: string; seller_id: string | null; seller_code: string | null; full_name: string; email: string | null; aliases: string[];
    }[]>`
      select p.id, s.id seller_id, p.seller_code, p.full_name, p.email,
        coalesce(array_agg(pa.alias order by pa.alias) filter (where pa.id is not null and pa.active), '{}') aliases
      from people p left join sellers s on s.person_id=p.id left join person_aliases pa on pa.person_id=p.id
      where p.active=true
      group by p.id,s.id
      order by p.id
    `;
    return rows.map((row) => ({ personId: row.id, sellerId: row.seller_id, sellerCode: row.seller_code, fullName: row.full_name, email: row.email, aliases: row.aliases }));
  }

  async getMemberships(personId: string): Promise<Array<{ membershipId: string; personId: string; teamId: string; validFrom: string; validTo: string | null; productKey: string; frontKey: string | null }>> {
    const rows = await this.sql<{
      id: string; person_id: string; team_id: string; valid_from: Date; valid_to: Date | null; product_key: string; front_key: string | null;
    }[]>`
      select m.id,m.person_id,m.team_id,m.valid_from,m.valid_to,t.product_key,t.front_key
      from person_team_memberships m join teams t on t.id=m.team_id
      where m.person_id=${personId}
      order by m.valid_from
    `;
    return rows.map((row) => ({
      membershipId: row.id, personId: row.person_id, teamId: row.team_id,
      validFrom: row.valid_from.toISOString(), validTo: row.valid_to?.toISOString() ?? null,
      productKey: row.product_key, frontKey: row.front_key,
    }));
  }

  async getSnapshot(): Promise<DriveDataQualitySnapshot> {
    const rows = await this.sql<Record<string, number>[]>`
      select
        (select count(*)::integer from source_locations where provider='google_drive' and source_type='folder' and registration_status='enabled') drive_sources,
        (select count(*)::integer from drive_documents) documents_discovered,
        (select count(*)::integer from drive_documents where transcript_status in ('candidate','identified','ready','processed')) transcript_candidates,
        (select count(*)::integer from drive_documents where call_id is not null) linked_calls,
        (select count(*)::integer from drive_documents where primary_closer_id is not null) closer_resolved,
        (select count(*)::integer from drive_documents where document_type='transcript' and primary_closer_id is null and transcript_status<>'ignored') closer_unresolved,
        (select count(*)::integer from drive_documents where attribution_status='needs_review') needs_attribution_review,
        (select count(*)::integer from drive_documents d left join calls c on c.id=d.call_id where d.document_type='transcript' and c.product_key is null) product_unresolved,
        (select count(*)::integer from drive_documents d left join calls c on c.id=d.call_id where d.document_type='transcript' and c.front_key is null) front_unresolved,
        (select count(*)::integer from drive_documents d left join calls c on c.id=d.call_id where d.document_type='transcript' and c.team_id is null) team_unresolved,
        (select count(*)::integer from drive_documents where transcript_status='inaccessible') inaccessible,
        (select count(*)::integer from drive_documents where transcript_status='ignored') ignored,
        (select count(*)::integer from analysis_jobs where status in ('awaiting_transcript','ready','retry_wait','paused_budget')) awaiting_analysis,
        (select count(*)::integer from analysis_jobs where status='claimed') processing,
        (select count(*)::integer from drive_documents d join analysis_runs ar on ar.call_id=d.call_id where ar.status='completed' and ar.is_current) analyzed
    `;
    const row = rows[0] as Record<string, number>;
    return {
      driveSources: row.drive_sources,
      documentsDiscovered: row.documents_discovered,
      transcriptCandidates: row.transcript_candidates,
      linkedCalls: row.linked_calls,
      closerResolved: row.closer_resolved,
      closerUnresolved: row.closer_unresolved,
      needsAttributionReview: row.needs_attribution_review,
      productUnresolved: row.product_unresolved,
      frontUnresolved: row.front_unresolved,
      teamUnresolved: row.team_unresolved,
      inaccessible: row.inaccessible,
      ignored: row.ignored,
      awaitingAnalysis: row.awaiting_analysis,
      processing: row.processing,
      analyzed: row.analyzed,
    };
  }

  async findSourceIdsForChange(fileId: string, parentIds: string[]): Promise<string[]> {
    const rows = await this.sql<{ source_id: string }[]>`
      select distinct source_id from (
        select dds.source_location_id source_id
        from drive_documents d join drive_document_sources dds on dds.drive_document_id=d.id
        where d.google_file_id=${fileId} or d.google_file_id=any(${parentIds}) or dds.shortcut_file_id=${fileId}
        union
        select sl.id source_id from source_locations sl
        where sl.provider='google_drive' and sl.registration_status='enabled' and sl.active=true
          and (sl.external_folder_id=${fileId} or sl.external_folder_id=any(${parentIds}))
      ) matched
    `;
    return rows.map((row) => row.source_id);
  }

  async claimDiscoveryState(input: { workerId: string; leaseSeconds: number }): Promise<DriveDiscoveryState | null> {
    if (!input.workerId.trim() || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30) {
      throw new Error("invalid_drive_discovery_claim");
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx<{
        changes_page_token: string | null; bootstrap_completed_at: Date | null;
        last_changes_scan_at: Date | null; last_shared_with_me_scan_at: Date | null;
      }[]>`
        select changes_page_token,bootstrap_completed_at,last_changes_scan_at,last_shared_with_me_scan_at
        from drive_discovery_state
        where id='google_oauth_principal' and (lease_expires_at is null or lease_expires_at<now())
        for update skip locked
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        update drive_discovery_state set lease_owner=${input.workerId},
          lease_expires_at=now()+(${input.leaseSeconds}*interval '1 second'),updated_at=now()
        where id='google_oauth_principal'
      `;
      return {
        changesPageToken: row.changes_page_token,
        bootstrapCompletedAt: row.bootstrap_completed_at?.toISOString() ?? null,
        lastChangesScanAt: row.last_changes_scan_at?.toISOString() ?? null,
        lastSharedWithMeScanAt: row.last_shared_with_me_scan_at?.toISOString() ?? null,
      };
    });
  }

  async completeDiscoveryState(input: {
    workerId: string;
    changesPageToken?: string | null;
    bootstrapCompleted?: boolean;
    sharedWithMeScanned?: boolean;
    changesScanned?: boolean;
    success: boolean;
  }): Promise<void> {
    await this.sql`
      update drive_discovery_state set
        changes_page_token=case when ${input.success && input.changesPageToken !== undefined}
          then ${input.changesPageToken ?? null} else changes_page_token end,
        bootstrap_completed_at=case when ${input.success && input.bootstrapCompleted === true}
          then coalesce(bootstrap_completed_at,now()) else bootstrap_completed_at end,
        last_shared_with_me_scan_at=case when ${input.success && input.sharedWithMeScanned === true}
          then now() else last_shared_with_me_scan_at end,
        last_changes_scan_at=case when ${input.success && input.changesScanned === true}
          then now() else last_changes_scan_at end,
        lease_owner=null,lease_expires_at=null,updated_at=now()
      where id='google_oauth_principal' and lease_owner=${input.workerId}
    `;
  }

  async renewDiscoveryLease(input: { workerId: string; leaseSeconds: number }): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      update drive_discovery_state set lease_expires_at=now()+(${input.leaseSeconds}*interval '1 second'),updated_at=now()
      where id='google_oauth_principal' and lease_owner=${input.workerId} and lease_expires_at>now()
      returning id
    `;
    return rows.length === 1;
  }

  async heartbeat(input: { workerId: string; releaseSha: string | null; status: "starting" | "running" | "idle" | "error" | "stopping" | "stopped"; errorCode?: string }): Promise<void> {
    const safeCode = input.errorCode?.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) ?? null;
    await this.sql`
      insert into drive_discovery_heartbeats(worker_id,release_sha,status,last_error_code)
      values (${input.workerId},${input.releaseSha},${input.status},${safeCode})
      on conflict(worker_id) do update set release_sha=excluded.release_sha,status=excluded.status,
        last_error_code=excluded.last_error_code,last_seen_at=now()
    `;
  }
}
