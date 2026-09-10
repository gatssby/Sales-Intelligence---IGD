import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleDriveFile, GoogleDriveTreeEntry } from "@igd/google";
import { catalogDriveTree, resolveDriveTranscript } from "./drive-discovery.js";

function file(id: string, name: string, mimeType: string): GoogleDriveFile {
  return {
    id, name, mimeType, parents: ["root-folder"], driveId: null, trashed: false,
    createdTime: "2026-09-10T12:00:00Z", modifiedTime: "2026-09-10T13:00:00Z",
    sharedWithMeTime: null, version: "1", webViewLink: null, resourceKey: null,
    shortcutDetails: null, owners: [], sharingUser: null, lastModifyingUser: null,
    capabilities: { canDownload: true, canListChildren: false },
  };
}

test("an inaccessible file does not abort the rest of a Drive catalog scan", async () => {
  const stored: string[] = [];
  const inaccessible: string[] = [];
  const entries: GoogleDriveTreeEntry[] = [
    { file: file("transcript-file-1", "Anotações do Gemini - Call", "application/vnd.google-apps.document"), ancestorIds: ["root-folder"], ancestorNames: ["Calls"], shortcutId: null },
    { file: file("unrelated-file-1", "Logo", "image/png"), ancestorIds: ["root-folder"], ancestorNames: ["Brand"], shortcutId: null },
  ];

  const summary = await catalogDriveTree({
    sourceId: "source-1",
    entries,
    errors: [{ fileId: "inaccessible-file-1", errorCode: "drive_access_denied" }],
  }, {
    async upsertDocument(input) { stored.push(input.googleFileId); return { documentId: input.googleFileId, created: true, changed: true, needsResolution: true }; },
    async markDocumentInaccessible(fileId) { inaccessible.push(fileId); },
  });

  assert.deepEqual(stored, ["transcript-file-1", "unrelated-file-1"]);
  assert.deepEqual(inaccessible, ["inaccessible-file-1"]);
  assert.deepEqual(summary, { discovered: 2, created: 2, existing: 0, candidates: 1, newCandidates: 1, ignored: 1, inaccessible: 1, errors: 0 });
});

test("legacy reconciliation precedes attribution and temporal membership", async () => {
  let readCalls = 0;
  const result = await resolveDriveTranscript({
    documentId: "document-1",
    entry: { file: file("legacy-file-1", "Call", "application/vnd.google-apps.document"), ancestorIds: [], ancestorNames: [], shortcutId: null },
    people: [],
    readTranscript: async () => { readCalls += 1; return "Synthetic"; },
    requestAnalysis: false,
  }, {
    async linkDocumentToExistingCall() { return { callId: "call-1", closerResolved: true }; },
    async recordDocumentResolution() { throw new Error("must_not_resolve"); },
    async getMemberships() { throw new Error("must_not_load_membership"); },
    async reconcileDocumentToCall() { throw new Error("must_not_create_call"); },
    async markDocumentInaccessible() { throw new Error("must_not_mark"); },
  });
  assert.deepEqual(result, { status: "linked", createdCall: false, matchedExistingCall: true, closerResolved: true });
  assert.equal(readCalls, 0);
});

test("a generic Google document is eligible for bounded content identification", async () => {
  const callbacks: Array<{ candidate: boolean; needsContentReview: boolean }> = [];
  await catalogDriveTree({
    sourceId: "source-1",
    entries: [{
      file: file("generic-document-1", "Documento sem padrão", "application/vnd.google-apps.document"),
      ancestorIds: ["root-folder"], ancestorNames: ["Arquivos"], shortcutId: null,
    }],
    errors: [],
  }, {
    async upsertDocument(input) { return { documentId: input.googleFileId, created: true, changed: true, needsResolution: true }; },
    async markDocumentInaccessible() {},
  }, async (input) => { callbacks.push(input); });
  assert.equal(callbacks[0]?.candidate, false);
  assert.equal(callbacks[0]?.needsContentReview, true);
});

test("an explicitly authorized queue cycle revisits an unchanged linked document", async () => {
  let callbacks = 0;
  await catalogDriveTree({
    sourceId: "source-1",
    entries: [{
      file: file("linked-document-1", "Call V9001", "application/vnd.google-apps.document"),
      ancestorIds: ["root-folder"], ancestorNames: ["Calls"], shortcutId: null,
    }],
    errors: [],
    revisitLinkedDocuments: true,
  }, {
    async upsertDocument(input) { return { documentId: input.googleFileId, created: false, changed: false, needsResolution: false }; },
    async markDocumentInaccessible() {},
  }, async () => { callbacks += 1; });
  assert.equal(callbacks, 1);
});

test("owner and incidental transcript dates do not become primary closer or actual call time", async () => {
  const recorded: Array<{ personId?: string | null; callTimeMethod?: string | null }> = [];
  const entry = file("candidate-file-1", "Call 2026-09-10", "application/vnd.google-apps.document");
  entry.owners = [{ displayName: "Supervisora Sintética", emailAddress: "supervisor@example.invalid" }];
  await resolveDriveTranscript({
    documentId: "document-1",
    entry: { file: entry, ancestorIds: [], ancestorNames: ["Shared"], shortcutId: null },
    people: [{ personId: "supervisor", sellerId: null, sellerCode: "V9002", fullName: "Supervisora Sintética", email: "supervisor@example.invalid" }],
    readTranscript: async () => "Cliente: Em 2025-01-03 comprei outro produto.\nSupervisora Sintética: entendido.",
    requestAnalysis: false,
  }, {
    async linkDocumentToExistingCall() { return null; },
    async recordDocumentResolution(input) { recorded.push(input); },
    async getMemberships() { throw new Error("must_not_load_membership"); },
    async reconcileDocumentToCall() { throw new Error("must_not_create_call"); },
    async markDocumentInaccessible() { throw new Error("must_not_mark"); },
  });
  assert.equal(recorded[0]?.personId ?? null, null);
  assert.equal(recorded[0]?.callTimeMethod, "name_metadata");
});

test("a document still needing transcript review cannot be promoted to a call", async () => {
  let reconciled = false;
  const recorded: Array<{ status: string; personId?: string | null; transcriptStatus?: string }> = [];
  await resolveDriveTranscript({
    documentId: "document-review-1",
    entry: { file: file("review-file-1", "Notas V9001", "application/vnd.google-apps.document"), ancestorIds: [], ancestorNames: ["Shared"], shortcutId: null },
    people: [{ personId: "person-1", sellerId: "seller-1", sellerCode: "V9001", fullName: "Closer Sintético" }],
    readTranscript: async () => "Documento administrativo sem estrutura de conversa.",
    requestAnalysis: false,
  }, {
    async linkDocumentToExistingCall() { return null; },
    async recordDocumentResolution(input) { recorded.push(input); },
    async getMemberships() { throw new Error("must_not_load_membership"); },
    async reconcileDocumentToCall() { reconciled = true; throw new Error("must_not_create_call"); },
    async markDocumentInaccessible() { throw new Error("must_not_mark"); },
  });
  assert.equal(reconciled, false);
  assert.deepEqual(recorded[0], {
    documentId: "document-review-1",
    status: "needs_review",
    personId: "person-1",
    attributionMethod: "seller_code",
    attributionConfidence: 1,
    attributionProvenance: [{ method: "seller_code", source: "file_name" }],
    attributionCandidatePersonIds: ["person-1"],
    startedAt: "2026-09-10T12:00:00.000Z",
    callTimeMethod: "drive_created_time",
    callTimeConfidence: 0.55,
    transcriptStatus: "needs_review",
  });
});

test("Drive owner metadata is not copied into call participants", async () => {
  const candidate = file("participant-file-1", "Call V9001", "application/vnd.google-apps.document");
  candidate.owners = [{ displayName: "Supervisora Sintética", emailAddress: "supervisor@example.invalid" }];
  let participantIds: string[] = [];
  await resolveDriveTranscript({
    documentId: "participant-document-1",
    entry: { file: candidate, ancestorIds: [], ancestorNames: ["Calls"], shortcutId: null },
    people: [
      { personId: "closer", sellerId: "seller-1", sellerCode: "V9001", fullName: "Closer Sintético" },
      { personId: "supervisor", sellerId: null, sellerCode: "V9002", fullName: "Supervisora Sintética", email: "supervisor@example.invalid" },
    ],
    requestAnalysis: false,
  }, {
    async linkDocumentToExistingCall() { return null; },
    async recordDocumentResolution() { throw new Error("must_not_record"); },
    async getMemberships() {
      return [{ membershipId: "membership-1", personId: "closer", teamId: "team-1", validFrom: "2026-01-01T00:00:00Z", validTo: null, productKey: "insider", frontKey: "closers" }];
    },
    async reconcileDocumentToCall(input) { participantIds = input.participantPersonIds; return { callId: "call-1", created: true, matchedExisting: false }; },
    async markDocumentInaccessible() { throw new Error("must_not_mark"); },
  });
  assert.deepEqual(participantIds, ["closer"]);
});

test("a transient content read failure cannot promote a candidate", async () => {
  let reconciled = false;
  await assert.rejects(() => resolveDriveTranscript({
    documentId: "transient-document-1",
    entry: { file: file("transient-file-1", "Call V9001", "application/vnd.google-apps.document"), ancestorIds: [], ancestorNames: ["Calls"], shortcutId: null },
    people: [{ personId: "closer", sellerId: "seller-1", sellerCode: "V9001", fullName: "Closer Sintético" }],
    readTranscript: async () => { throw new Error("transcript_rate_limited"); },
    requestAnalysis: false,
  }, {
    async linkDocumentToExistingCall() { return null; },
    async recordDocumentResolution() { throw new Error("must_not_record"); },
    async getMemberships() { throw new Error("must_not_load_membership"); },
    async reconcileDocumentToCall() { reconciled = true; throw new Error("must_not_create_call"); },
    async markDocumentInaccessible() { throw new Error("must_not_mark"); },
  }), /transcript_rate_limited/);
  assert.equal(reconciled, false);
});

test("a missing front keeps an otherwise resolved transcript in review", async () => {
  const recorded: Array<{ status: string; personId?: string | null }> = [];
  let reconciled = false;
  const result = await resolveDriveTranscript({
    documentId: "front-document-1",
    entry: { file: file("front-file-1", "Call V9001", "application/vnd.google-apps.document"), ancestorIds: [], ancestorNames: ["Calls"], shortcutId: null },
    people: [{ personId: "closer", sellerId: "seller-1", sellerCode: "V9001", fullName: "Closer Sintético" }],
    requestAnalysis: false,
  }, {
    async linkDocumentToExistingCall() { return null; },
    async recordDocumentResolution(input) { recorded.push(input); },
    async getMemberships() {
      return [{ membershipId: "membership-1", personId: "closer", teamId: "team-1", validFrom: "2026-01-01T00:00:00Z", validTo: null, productKey: "insider", frontKey: null }];
    },
    async reconcileDocumentToCall() { reconciled = true; throw new Error("must_not_create_call"); },
    async markDocumentInaccessible() { throw new Error("must_not_mark"); },
  });
  assert.equal(result.status, "needs_review");
  assert.equal(recorded[0]?.personId, "closer");
  assert.equal(reconciled, false);
});
