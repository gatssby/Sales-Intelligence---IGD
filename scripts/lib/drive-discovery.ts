import {
  classifyDriveDocument,
  normalizeComparable,
  parseHistoricalCallDate,
  resolveCallParticipants,
  resolveCallTime,
  resolveOrganizationAt,
  resolvePrimaryCloser,
  type AttributionEvidence,
  type AttributionPerson,
} from "@igd/core";
import type { DriveDocumentInput, ReconcileDriveDocumentInput } from "@igd/db";
import type { GoogleDriveTreeEntry, GoogleDriveTreeError } from "@igd/google";

export type DriveCatalogSummary = {
  discovered: number;
  created: number;
  existing: number;
  candidates: number;
  newCandidates: number;
  ignored: number;
  inaccessible: number;
  errors: number;
};

export interface DriveCatalogStore {
  upsertDocument(input: DriveDocumentInput): Promise<{
    documentId: string; created: boolean; changed: boolean; needsResolution: boolean;
  }>;
  markDocumentInaccessible(fileId: string, reason: string): Promise<void>;
}

export interface DriveTranscriptResolutionStore {
  recordDocumentResolution(input: {
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
  }): Promise<void>;
  linkDocumentToExistingCall(documentId: string, requestAnalysis?: boolean): Promise<{ callId: string; closerResolved: boolean } | null>;
  getMemberships(personId: string): Promise<Array<{
    membershipId: string; personId: string; teamId: string; validFrom: string; validTo: string | null;
    productKey: string; frontKey: string | null;
  }>>;
  reconcileDocumentToCall(input: ReconcileDriveDocumentInput): Promise<{ callId: string; created: boolean; matchedExisting: boolean }>;
  markDocumentInaccessible(fileId: string, reason: string): Promise<void>;
}

export type DrivePerson = AttributionPerson & { sellerId: string | null };

function extractStructuredEvidence(value: string): AttributionEvidence[] {
  const evidence: AttributionEvidence[] = [];
  for (const sellerCode of value.match(/\bV\d{2,}\b/gi) ?? []) evidence.push({ method: "seller_code", value: sellerCode, source: "file_name" });
  for (const email of value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) evidence.push({ method: "email", value: email, source: "file_name" });
  return evidence;
}

function extractKnownAliasEvidence(value: string, people: DrivePerson[]): AttributionEvidence[] {
  const comparable = normalizeComparable(value);
  const evidence: AttributionEvidence[] = [];
  const seen = new Set<string>();
  for (const person of people) {
    for (const alias of [person.fullName, ...(person.aliases ?? [])]) {
      const normalizedAlias = normalizeComparable(alias);
      if (normalizedAlias.length < 4 || !comparable.includes(normalizedAlias)) continue;
      const key = `${person.personId}:${normalizedAlias}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({ method: "alias", value: alias, source: "file_name" });
    }
  }
  return evidence;
}

function extractTimestamp(value: string): string | null {
  const timestamp = value.match(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/);
  if (timestamp) return timestamp[0].replace(" ", "T");
  const date = value.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);
  return date ? parseHistoricalCallDate(date[0])?.startedAt ?? null : null;
}

function extractResponsibleTranscriptEvidence(value: string): AttributionEvidence[] {
  const header = value.split(/\r?\n/).slice(0, 30).join("\n");
  const evidence: AttributionEvidence[] = [];
  for (const match of header.matchAll(/(?:closer|vendedor(?:a)?|consultor(?:a)?)\s*[:=-]\s*(V\d{2,})\b/gi)) {
    evidence.push({ method: "seller_code", value: match[1], source: "transcript_header" });
  }
  for (const match of header.matchAll(/(?:closer|vendedor(?:a)?|consultor(?:a)?)\s*[:=-]\s*[^\n<]*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    evidence.push({ method: "email", value: match[1], source: "transcript_header" });
  }
  return evidence;
}

function extractStructuredCallTimestamp(value: string): string | null {
  for (const line of value.split(/\r?\n/).slice(0, 30)) {
    if (!/(?:data\s+da\s+call|call\s+date|meeting\s+(?:date|started)|in[ií]cio\s+da\s+call|started\s+at|start\s+time)\s*[:=-]/i.test(line)) continue;
    const timestamp = extractTimestamp(line);
    if (timestamp) return timestamp;
  }
  return null;
}

export async function resolveDriveTranscript(input: {
  documentId: string;
  sourceSellerId?: string | null;
  entry: GoogleDriveTreeEntry;
  people: DrivePerson[];
  readTranscript?: (fileId: string) => Promise<string>;
  persistTranscript?: (callId: string, fileId: string, text: string) => Promise<void>;
  requestAnalysis: boolean;
}, store: DriveTranscriptResolutionStore): Promise<{
  status: "linked" | "unresolved" | "needs_review" | "inaccessible";
  createdCall: boolean;
  matchedExistingCall: boolean;
  closerResolved: boolean;
}> {
  const existing = await store.linkDocumentToExistingCall(input.documentId, input.requestAnalysis);
  if (existing) {
    return {
      status: "linked",
      createdCall: false,
      matchedExistingCall: true,
      closerResolved: existing.closerResolved,
    };
  }
  const evidence: AttributionEvidence[] = [
    ...extractStructuredEvidence(input.entry.file.name),
    ...extractKnownAliasEvidence(input.entry.file.name, input.people),
    { method: "folder_context", value: input.entry.ancestorNames.join(" "), source: "folder_ancestry" },
  ];
  const participantEvidence: AttributionEvidence[] = [];
  const sourcePerson = input.people.find((person) => person.sellerId === input.sourceSellerId);
  if (sourcePerson) evidence.push({ method: "folder_context", value: sourcePerson.sellerCode ?? sourcePerson.fullName, source: "registered_source" });

  let transcriptText: string | null = null;
  if (input.readTranscript && input.entry.file.capabilities.canDownload !== false) {
    try {
      transcriptText = await input.readTranscript(input.entry.file.id);
      const responsible = extractResponsibleTranscriptEvidence(transcriptText);
      evidence.push(...responsible);
      participantEvidence.push(...responsible, { method: "transcript_participant", value: transcriptText.slice(0, 100_000), source: "transcript_content" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "transcript_fetch_failed";
      if (["transcript_access_denied", "transcript_not_found", "drive_access_denied", "drive_file_not_found"].includes(code)) {
        await store.markDocumentInaccessible(input.entry.file.id, code);
        return { status: "inaccessible", createdCall: false, matchedExistingCall: false, closerResolved: false };
      }
      throw new Error(code.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "transcript_fetch_failed");
    }
  }

  const classification = classifyDriveDocument({
    mimeType: input.entry.file.mimeType,
    name: input.entry.file.name,
    ancestorNames: input.entry.ancestorNames,
    contentSample: transcriptText?.slice(0, 100_000),
  });
  const attribution = resolvePrimaryCloser(input.people, evidence);
  const attributionProvenance = attribution.provenance.map((item) => ({ method: item.method, source: item.source ?? "unspecified" }));
  const callTime = resolveCallTime({
    actualCallTime: transcriptText ? extractStructuredCallTimestamp(transcriptText) : null,
    nameMetadataTime: extractTimestamp(input.entry.file.name),
    driveCreatedTime: input.entry.file.createdTime,
    driveModifiedTime: input.entry.file.modifiedTime,
  });
  if (classification.transcriptStatus === "needs_review") {
    await store.recordDocumentResolution({
      documentId: input.documentId,
      status: "needs_review",
      personId: attribution.status === "resolved" ? attribution.personId : null,
      attributionMethod: attribution.method,
      attributionConfidence: attribution.confidence,
      attributionProvenance,
      attributionCandidatePersonIds: attribution.candidatePersonIds,
      startedAt: callTime?.startedAt,
      callTimeMethod: callTime?.method,
      callTimeConfidence: callTime?.confidence,
      transcriptStatus: "needs_review",
    });
    return {
      status: "needs_review",
      createdCall: false,
      matchedExistingCall: false,
      closerResolved: attribution.status === "resolved",
    };
  }
  if (attribution.status !== "resolved" || !attribution.personId || !attribution.method || !callTime) {
    const status = attribution.status === "needs_review" ? "needs_review" : "unresolved";
    await store.recordDocumentResolution({
      documentId: input.documentId,
      status,
      attributionMethod: attribution.method,
      attributionConfidence: attribution.confidence,
      attributionProvenance,
      attributionCandidatePersonIds: attribution.candidatePersonIds,
      startedAt: callTime?.startedAt,
      callTimeMethod: callTime?.method,
      callTimeConfidence: callTime?.confidence,
      transcriptStatus: status === "needs_review" ? "needs_review" : classification.transcriptStatus === "identified" ? "identified" : undefined,
    });
    return { status, createdCall: false, matchedExistingCall: false, closerResolved: false };
  }
  const person = input.people.find((candidate) => candidate.personId === attribution.personId)!;
  const memberships = await store.getMemberships(person.personId);
  const organization = resolveOrganizationAt(person.personId, callTime.startedAt, memberships);
  const membership = organization.status === "resolved"
    ? memberships.find((candidate) => candidate.membershipId === organization.membershipId)
    : null;
  if (!person.sellerCode || !membership || !membership.frontKey) {
    await store.recordDocumentResolution({
      documentId: input.documentId,
      status: "needs_review",
      personId: person.personId,
      attributionMethod: attribution.method,
      attributionConfidence: attribution.confidence,
      attributionProvenance,
      attributionCandidatePersonIds: attribution.candidatePersonIds,
      startedAt: callTime.startedAt,
      callTimeMethod: callTime.method,
      callTimeConfidence: callTime.confidence,
      transcriptStatus: "needs_review",
    });
    return { status: "needs_review", createdCall: false, matchedExistingCall: false, closerResolved: true };
  }
  const participants = resolveCallParticipants(input.people, participantEvidence);
  const outcome = await store.reconcileDocumentToCall({
    documentId: input.documentId,
    sellerCode: person.sellerCode,
    primaryCloserId: person.personId,
    participantPersonIds: participants.includes(person.personId) ? participants : [person.personId, ...participants],
    productKey: membership.productKey,
    teamId: membership.teamId,
    membershipId: membership.membershipId,
    startedAt: callTime.startedAt,
    callTimeMethod: callTime.method,
    callTimeConfidence: callTime.confidence,
    attributionMethod: attribution.method,
    attributionConfidence: attribution.confidence,
    attributionProvenance,
    attributionCandidatePersonIds: attribution.candidatePersonIds,
    requestAnalysis: input.requestAnalysis,
  });
  if (transcriptText && input.persistTranscript) {
    await input.persistTranscript(outcome.callId, input.entry.file.id, transcriptText);
  }
  return {
    status: "linked",
    createdCall: outcome.created,
    matchedExistingCall: outcome.matchedExisting,
    closerResolved: true,
  };
}

export async function catalogDriveTree(
  input: {
    sourceId: string;
    entries: GoogleDriveTreeEntry[];
    errors: GoogleDriveTreeError[];
    revisitLinkedDocuments?: boolean;
  },
  store: DriveCatalogStore,
  onCataloged?: (input: {
    entry: GoogleDriveTreeEntry; documentId: string; candidate: boolean; needsContentReview: boolean;
  }) => Promise<void>,
): Promise<DriveCatalogSummary> {
  const summary: DriveCatalogSummary = {
    discovered: 0,
    created: 0,
    existing: 0,
    candidates: 0,
    newCandidates: 0,
    ignored: 0,
    inaccessible: 0,
    errors: 0,
  };
  for (const issue of input.errors) {
    try {
      if (issue.name) {
        const classification = classifyDriveDocument({ mimeType: issue.mimeType ?? null, name: issue.name });
        await store.upsertDocument({
          sourceId: input.sourceId,
          googleFileId: issue.fileId,
          name: issue.name,
          mimeType: issue.mimeType ?? null,
          parentIds: [],
          ancestorIds: issue.ancestorIds ?? [],
          ancestorNames: issue.ancestorNames ?? [],
          shortcutFileId: issue.shortcutId ?? null,
          transcriptStatus: "inaccessible",
          documentType: classification.documentType,
          classificationMethod: classification.method,
          classificationConfidence: classification.confidence,
          rawMetadata: { shortcut_file_id: issue.shortcutId ?? null, inaccessible_error_code: issue.errorCode },
        });
        summary.discovered += 1;
      } else {
        await store.markDocumentInaccessible(issue.fileId, issue.errorCode);
      }
      summary.inaccessible += 1;
    } catch {
      summary.errors += 1;
    }
  }
  for (const entry of input.entries) {
    summary.discovered += 1;
    const classification = classifyDriveDocument({
      mimeType: entry.file.mimeType,
      name: entry.file.name,
      ancestorNames: entry.ancestorNames,
    });
    try {
      const result = await store.upsertDocument({
        sourceId: input.sourceId,
        googleFileId: entry.file.id,
        name: entry.file.name,
        mimeType: entry.file.mimeType,
        parentIds: entry.file.parents,
        ancestorIds: entry.ancestorIds,
        ancestorNames: entry.ancestorNames,
        shortcutFileId: entry.shortcutId,
        webViewLink: entry.file.webViewLink,
        driveId: entry.file.driveId,
        createdTime: entry.file.createdTime,
        modifiedTime: entry.file.modifiedTime,
        sharedWithMeTime: entry.file.sharedWithMeTime,
        googleVersion: entry.file.version,
        transcriptStatus: classification.transcriptStatus,
        documentType: classification.documentType,
        classificationMethod: classification.method,
        classificationConfidence: classification.confidence,
        rawMetadata: {
          shortcut_file_id: entry.shortcutId,
          resource_key: entry.file.resourceKey,
          can_download: entry.file.capabilities.canDownload,
          can_list_children: entry.file.capabilities.canListChildren,
          owners: entry.file.owners,
          sharing_user: entry.file.sharingUser,
          last_modifying_user: entry.file.lastModifyingUser,
        },
      });
      summary.created += Number(result.created);
      summary.existing += Number(!result.created);
      summary.candidates += Number(["candidate", "identified", "ready", "processed"].includes(classification.transcriptStatus));
      summary.newCandidates += Number(result.created && ["candidate", "identified", "ready", "processed"].includes(classification.transcriptStatus));
      summary.ignored += Number(classification.transcriptStatus === "ignored");
      if (onCataloged && (result.created || result.changed || result.needsResolution || input.revisitLinkedDocuments)) {
        await onCataloged({
          entry,
          documentId: result.documentId,
          candidate: ["candidate", "identified", "ready", "processed"].includes(classification.transcriptStatus),
          needsContentReview: classification.transcriptStatus === "needs_review"
            && ["application/vnd.google-apps.document", "text/plain", "text/vtt"].includes(entry.file.mimeType ?? ""),
        });
      }
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}
