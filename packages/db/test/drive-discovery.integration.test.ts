import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { PostgresDriveDiscoveryRepository, PostgresIngestionRepository, PostgresOfficialAnalysisLifecycle } from "../src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function assertIsolatedDatabase(url: string): void {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("integration_test_database_must_be_local");
  if (!parsed.pathname.endsWith("_test")) throw new Error("integration_test_database_name_must_end_in_test");
}

integration("Drive discovery registry is canonical, recoverable and concurrency-safe", async () => {
  assertIsolatedDatabase(databaseUrl!);
  const adminSql = postgres(databaseUrl!, { max: 1 });
  const schema = `drive_${randomUUID().replaceAll("-", "")}`;
  await adminSql.unsafe(`create schema ${schema}`);
  await adminSql.unsafe(`set search_path to ${schema}, public`);
  const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await adminSql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  await adminSql.unsafe(await readFile(path.join(migrationsDir, "010_drive_discovery_foundation.sql"), "utf8"));
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
  const sql = postgres(scopedUrl.toString(), { max: 10 });
  const discovery = new PostgresDriveDiscoveryRepository(sql);
  const ingestion = new PostgresIngestionRepository(scopedUrl.toString());

  try {
    await sql`insert into products (key, display_name) values ('insider', 'INSIDER')`;
    const team = await sql<{ id: string }[]>`
      insert into teams (team_key, display_name, product_key) values ('insider:alpha', 'Alpha', 'insider') returning id
    `;
    await ingestion.upsertSeller({ sellerCode: "V9001", sellerName: "Pessoa Sintética", product: "INSIDER", teamName: "Alpha", active: true });
    const person = await sql<{ id: string }[]>`select p.id from people p where p.seller_code='V9001'`;
    await sql`
      insert into person_team_memberships (person_id, team_id, valid_from, valid_to, provenance)
      values (${person[0].id}, ${team[0].id}, '2026-01-01T00:00:00Z', null, 'synthetic_test')
    `;
    const source = await discovery.upsertSourceCandidate({
      googleFileId: "sourceFolder9001", name: "Synthetic Root", mimeType: "application/vnd.google-apps.folder",
    });
    await discovery.setSourceEnabled(source.sourceId, true);

    const original = await discovery.upsertDocument({
      sourceId: source.sourceId,
      googleFileId: "driveTranscript9001",
      name: "Call original",
      mimeType: "application/vnd.google-apps.document",
      parentIds: ["folder-a"],
      createdTime: "2026-05-15T12:00:00Z",
      modifiedTime: "2026-05-15T13:00:00Z",
      transcriptStatus: "candidate",
      documentType: "transcript",
      classificationMethod: "mime_name",
      classificationConfidence: 0.9,
    });
    const renamed = await discovery.upsertDocument({
      sourceId: source.sourceId,
      googleFileId: "driveTranscript9001",
      name: "Call renamed",
      mimeType: "application/vnd.google-apps.document",
      parentIds: ["folder-b"],
      createdTime: "2026-05-15T12:00:00Z",
      modifiedTime: "2026-05-16T13:00:00Z",
      transcriptStatus: "candidate",
      documentType: "transcript",
      classificationMethod: "mime_name",
      classificationConfidence: 0.9,
    });
    assert.equal(original.documentId, renamed.documentId);
    assert.equal(original.created, true);
    assert.equal(renamed.created, false);
    assert.equal(renamed.changed, true);
    const unchanged = await discovery.upsertDocument({
      sourceId: source.sourceId,
      googleFileId: "driveTranscript9001",
      name: "Call renamed",
      mimeType: "application/vnd.google-apps.document",
      parentIds: ["folder-b"],
      createdTime: "2026-05-15T12:00:00Z",
      modifiedTime: "2026-05-16T13:00:00Z",
      transcriptStatus: "candidate",
      documentType: "transcript",
      classificationMethod: "mime_name",
      classificationConfidence: 0.9,
    });
    assert.equal(unchanged.changed, false);
    assert.equal((await sql`select 1 from drive_documents where google_file_id='driveTranscript9001'`).length, 1);
    assert.equal(await discovery.deactivateSourceDocumentsNotSeenSince({
      sourceId: source.sourceId,
      scanStartedAt: new Date(Date.now() + 1_000).toISOString(),
    }), 1);
    assert.equal((await sql<{ active: boolean }[]>`
      select active from drive_document_sources where drive_document_id=${original.documentId} and source_location_id=${source.sourceId}
    `)[0].active, false);
    await discovery.upsertDocument({
      sourceId: source.sourceId,
      googleFileId: "driveTranscript9001",
      name: "Call renamed",
      mimeType: "application/vnd.google-apps.document",
      parentIds: ["folder-b"],
      createdTime: "2026-05-15T12:00:00Z",
      modifiedTime: "2026-05-16T13:00:00Z",
      transcriptStatus: "candidate",
      documentType: "transcript",
      classificationMethod: "mime_name",
      classificationConfidence: 0.9,
    });

    const linked = await discovery.reconcileDocumentToCall({
      documentId: original.documentId,
      sellerCode: "V9001",
      primaryCloserId: person[0].id,
      participantPersonIds: [person[0].id],
      productKey: "insider",
      teamId: team[0].id,
      membershipId: (await sql<{ id: string }[]>`select id from person_team_memberships limit 1`)[0].id,
      startedAt: "2026-05-15T12:00:00Z",
      callTimeMethod: "actual_call_time",
      callTimeConfidence: 1,
      attributionMethod: "seller_code",
      attributionConfidence: 1,
      attributionProvenance: [{ method: "seller_code", source: "synthetic_test" }],
      attributionCandidatePersonIds: [person[0].id],
      requestAnalysis: false,
    });
    assert.equal(linked.created, true);
    assert.equal((await sql`select 1 from analysis_jobs where call_id=${linked.callId}`).length, 0);
    await new PostgresOfficialAnalysisLifecycle(sql).syncCatalog();
    assert.equal((await sql`select 1 from analysis_jobs where call_id=${linked.callId}`).length, 0);
    assert.equal((await sql<{ analysis_eligible: boolean }[]>`select analysis_eligible from calls where id=${linked.callId}`)[0].analysis_eligible, false);

    const legacy = await ingestion.upsertCallSource({
      transcriptFileId: "legacyDriveTranscript9001", sellerCode: "V9001", product: "INSIDER",
      callDate: "2026-04-01T12:00:00Z", sourceType: "manual_crm_import", sourceExternalId: "legacy-row-1",
    });
    const legacyDocument = await discovery.upsertDocument({
      sourceId: source.sourceId, googleFileId: "legacyDriveTranscript9001", name: "Legacy transcript",
      mimeType: "application/vnd.google-apps.document", parentIds: ["folder-a"],
      createdTime: "2026-04-01T12:00:00Z", modifiedTime: "2026-04-02T12:00:00Z",
      transcriptStatus: "identified", documentType: "transcript", classificationMethod: "content_structure", classificationConfidence: 0.9,
    });
    const reconciledLegacy = await discovery.linkDocumentToExistingCall(legacyDocument.documentId);
    assert.ok(reconciledLegacy);
    assert.equal(reconciledLegacy.callId, legacy.callId);
    assert.equal((await sql`select 1 from calls where transcript_file_id='legacyDriveTranscript9001'`).length, 1);
    assert.equal((await sql`select 1 from call_sources where call_id=${legacy.callId}`).length, 2);
    assert.equal((await sql`select 1 from call_participants where call_id=${legacy.callId} and participant_role='primary_closer'`).length, 1);

    await ingestion.upsertSeller({ sellerCode: "V9002", sellerName: "Pessoa Recente Sintética", product: "INSIDER", teamName: "Alpha", active: true });
    const sellerIds = await sql<{ id: string; seller_code: string }[]>`select id,seller_code from sellers where seller_code in ('V9001','V9002')`;
    const sellerId = (code: string) => sellerIds.find((seller) => seller.seller_code === code)!.id;
    const queuedCalls = await sql<{ id: string; external_key: string }[]>`
      insert into calls(seller_id,external_key,product_key,started_at,status,transcript_file_id)
      values
        (${sellerId("V9001")},'old-priority-call','insider','2026-01-01T12:00:00Z','transcript_ready','oldPriorityTranscript9001'),
        (${sellerId("V9002")},'new-priority-call','insider','2026-09-10T12:00:00Z','transcript_ready','newPriorityTranscript9002')
      returning id,external_key
    `;
    for (const [index, call] of queuedCalls.entries()) {
      await sql`
        insert into transcripts(call_id,raw_text,normalized_text,content_sha256,source)
        values (${call.id},${`Synthetic ${index}`},${`Synthetic ${index}`},${String(index + 3).repeat(64)},'synthetic_test')
      `;
      await sql`insert into analysis_jobs(call_id,status,stage,last_claimed_at) values (${call.id},'ready','queue',${call.external_key === "new-priority-call" ? new Date() : null})`;
    }
    const newestClaim = await new PostgresOfficialAnalysisLifecycle(sql).claimNext({
      workerId: "priority-worker", leaseSeconds: 300,
      strategy: {
        strategyVersion: "synthetic-v1", confidencePolicyVersion: "synthetic-confidence-v1",
        primaryModel: "synthetic-primary", escalationModel: "synthetic-escalation",
        rubricVersion: "synthetic-rubric", promptVersion: "synthetic-prompt", schemaVersion: "synthetic-schema",
        confidenceThreshold: 0.5,
      },
    });
    assert.equal(newestClaim?.callId, queuedCalls.find((call) => call.external_key === "new-priority-call")!.id);

    const claims = await Promise.all([
      discovery.claimNextSource({ workerId: "scanner-a", leaseSeconds: 300 }),
      discovery.claimNextSource({ workerId: "scanner-b", leaseSeconds: 300 }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const sourceOwner = claims[0] ? "scanner-a" : "scanner-b";
    assert.equal(await discovery.renewSourceLease({ sourceId: source.sourceId, workerId: sourceOwner, leaseSeconds: 300 }), true);
    assert.equal(await discovery.renewSourceLease({ sourceId: source.sourceId, workerId: "scanner-other", leaseSeconds: 300 }), false);

    const discoveryState = await discovery.claimDiscoveryState({ workerId: "scanner-global", leaseSeconds: 300 });
    assert.ok(discoveryState);
    assert.equal(await discovery.renewDiscoveryLease({ workerId: "scanner-global", leaseSeconds: 300 }), true);
    assert.equal(await discovery.renewDiscoveryLease({ workerId: "scanner-other", leaseSeconds: 300 }), false);
  } finally {
    await ingestion.close();
    await sql.end();
    await adminSql.unsafe(`drop schema ${schema} cascade`);
    await adminSql.end();
  }
});
