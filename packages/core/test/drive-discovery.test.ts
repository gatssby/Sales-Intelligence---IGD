import assert from "node:assert/strict";
import test from "node:test";
import { classifyDriveDocument, resolveCallParticipants, resolveCallTime, resolveOrganizationAt, resolvePrimaryCloser } from "../src/index.js";

test("classifies likely transcripts deterministically and ignores unrelated files", () => {
  assert.deepEqual(classifyDriveDocument({
    mimeType: "application/vnd.google-apps.document",
    name: "Anotações do Gemini - Call 2026-09-10",
    ancestorNames: ["Calls"],
  }), {
    documentType: "transcript",
    transcriptStatus: "candidate",
    confidence: 0.9,
    method: "mime_name",
  });

  assert.deepEqual(classifyDriveDocument({
    mimeType: "image/png",
    name: "Logotipo.png",
    ancestorNames: ["Brand"],
  }), {
    documentType: "other",
    transcriptStatus: "ignored",
    confidence: 1,
    method: "unsupported_mime_type",
  });
});

test("resolves temporal team membership without rewriting historical attribution", () => {
  const memberships = [
    { membershipId: "membership-a", personId: "person-a", teamId: "team-a", validFrom: "2026-01-01T00:00:00Z", validTo: "2026-07-01T00:00:00Z" },
    { membershipId: "membership-b", personId: "person-a", teamId: "team-b", validFrom: "2026-07-01T00:00:00Z", validTo: null },
  ];

  assert.deepEqual(resolveOrganizationAt("person-a", "2026-05-15T12:00:00Z", memberships), {
    status: "resolved",
    membershipId: "membership-a",
    teamId: "team-a",
  });
  assert.deepEqual(resolveOrganizationAt("person-a", "2026-08-15T12:00:00Z", memberships), {
    status: "resolved",
    membershipId: "membership-b",
    teamId: "team-b",
  });
});

test("resolves call time by provenance and never lets modifiedTime replace a real timestamp", () => {
  const real = resolveCallTime({
    actualCallTime: "2026-05-15T14:00:00-03:00",
    driveCreatedTime: "2026-05-16T10:00:00Z",
    driveModifiedTime: "2026-09-10T10:00:00Z",
  });
  assert.deepEqual(real, {
    startedAt: "2026-05-15T17:00:00.000Z",
    method: "actual_call_time",
    confidence: 1,
  });

  assert.deepEqual(resolveCallTime({ driveCreatedTime: "2026-05-16T10:00:00Z", driveModifiedTime: "2026-09-10T10:00:00Z" }), {
    startedAt: "2026-05-16T10:00:00.000Z",
    method: "drive_created_time",
    confidence: 0.55,
  });
});

test("keeps all IGD participants separate from the primary closer", () => {
  const people = [
    { personId: "closer", sellerCode: "V101", fullName: "Closer Exemplo" },
    { personId: "supervisor", sellerCode: "V202", fullName: "Supervisora Exemplo" },
  ];
  const evidence = [
    { method: "seller_code" as const, value: "V101" },
    { method: "transcript_participant" as const, value: "Supervisora Exemplo" },
  ];

  assert.deepEqual(resolveCallParticipants(people, evidence), ["closer", "supervisor"]);
  assert.equal(resolvePrimaryCloser(people, evidence).personId, "closer");
  assert.equal(resolvePrimaryCloser(people, [{ method: "transcript_participant", value: "Supervisora Exemplo" }]).status, "unresolved");
});

test("resolves primary closer by deterministic evidence and quarantines ambiguity", () => {
  const people = [
    { personId: "person-a", sellerCode: "V308", fullName: "Luciana Arrais", email: "luciana@example.invalid", aliases: ["Luciana Lucas", "Lu Arrais", "Luciana"] },
    { personId: "person-b", sellerCode: "V400", fullName: "Luciana Souza", email: "souza@example.invalid", aliases: ["Luciana"] },
  ];

  assert.equal(resolvePrimaryCloser(people, [{ method: "seller_code", value: "V308" }]).personId, "person-a");
  assert.equal(resolvePrimaryCloser(people, [{ method: "email", value: "LUCIANA@example.invalid" }]).personId, "person-a");
  assert.equal(resolvePrimaryCloser(people, [{ method: "alias", value: "Luciana Lucas" }]).personId, "person-a");

  const ambiguous = resolvePrimaryCloser(people, [{ method: "alias", value: "Luciana" }]);
  assert.equal(ambiguous.status, "needs_review");
  assert.deepEqual(ambiguous.candidatePersonIds, ["person-a", "person-b"]);

  const strong = resolvePrimaryCloser(people, [
    { method: "seller_code", value: "V308" },
    { method: "ai_inference", value: "person-b" },
  ]);
  assert.deepEqual({ personId: strong.personId, method: strong.method }, { personId: "person-a", method: "seller_code" });
});
