import { hostname } from "node:os";
import {
  PostgresDriveDiscoveryRepository,
  PostgresIngestionRepository,
  type DriveSource,
} from "@igd/db";
import {
  discoverGoogleDriveTree,
  GoogleDriveDiscoveryClient,
  GoogleDriveTranscriptFetcher,
  GoogleOAuthRefreshTokenProvider,
  type GoogleDriveTreeEntry,
} from "@igd/google";
import { catalogDriveTree, resolveDriveTranscript, type DriveCatalogSummary } from "./lib/drive-discovery.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

function positiveInteger(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`invalid_${name.toLowerCase()}`);
  return value;
}

function environmentBoolean(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`invalid_${name.toLowerCase()}`);
}

function googleOAuthProvider(): GoogleOAuthRefreshTokenProvider {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() ?? "";
  if (!clientId || !clientSecret || !refreshToken) throw new Error("google_oauth_configuration_incomplete");
  return new GoogleOAuthRefreshTokenProvider({ clientId, clientSecret, refreshToken });
}

type ScanTotals = DriveCatalogSummary & {
  sourcesScanned: number;
  sourceCandidates: number;
  linkedExistingCalls: number;
  newCalls: number;
  closerResolved: number;
  closerUnresolved: number;
  needsReview: number;
};

function emptyTotals(): ScanTotals {
  return {
    discovered: 0, created: 0, existing: 0, candidates: 0, ignored: 0, inaccessible: 0, errors: 0,
    newCandidates: 0,
    sourcesScanned: 0, sourceCandidates: 0, linkedExistingCalls: 0, newCalls: 0,
    closerResolved: 0, closerUnresolved: 0, needsReview: 0,
  };
}

function mergeTotals(target: ScanTotals, source: DriveCatalogSummary): void {
  target.discovered += source.discovered;
  target.created += source.created;
  target.existing += source.existing;
  target.candidates += source.candidates;
  target.newCandidates += source.newCandidates;
  target.ignored += source.ignored;
  target.inaccessible += source.inaccessible;
  target.errors += source.errors;
}

const apply = process.argv.includes("--apply");
const daemon = process.argv.includes("--daemon");
const validateRead = process.argv.includes("--validate-read");
const forceFullScan = process.argv.includes("--full-scan");
const intervalMs = positiveInteger("DRIVE_DISCOVERY_INTERVAL_MS", 300_000, 60_000);
const fullScanIntervalMs = positiveInteger("DRIVE_DISCOVERY_FULL_SCAN_INTERVAL_MS", 86_400_000, 3_600_000);
const leaseSeconds = positiveInteger("DRIVE_DISCOVERY_LEASE_SECONDS", 1_800, 30);
const configuredContentLimit = positiveInteger("DRIVE_DISCOVERY_CONTENT_READ_LIMIT", 0, 0);
const contentReadLimit = validateRead ? Math.max(1, configuredContentLimit) : configuredContentLimit;
const autoQueue = environmentBoolean("DRIVE_DISCOVERY_AUTO_QUEUE", false);
const persistTranscripts = environmentBoolean("DRIVE_DISCOVERY_PERSIST_TRANSCRIPTS", false);
if (autoQueue && !apply) throw new Error("drive_auto_queue_requires_apply");

const workerNamespace = `drive-${hostname().replace(/[^a-z0-9_-]/gi, "_")}`;
const workerId = daemon ? workerNamespace : `${workerNamespace}-${process.pid}`;
const ingestion = new PostgresIngestionRepository(databaseUrl);
const repository = new PostgresDriveDiscoveryRepository(ingestion.sql);
const oauth = googleOAuthProvider();
const drive = new GoogleDriveDiscoveryClient(oauth);
const transcriptFetcher = new GoogleDriveTranscriptFetcher(oauth);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function dryRun(): Promise<void> {
  const shared = await drive.listSharedWithMe();
  const sources = await repository.listEnabledSources();
  console.log(JSON.stringify({
    mode: "dry_run",
    oauthRefresh: "OK",
    sharedWithMeDiscovery: "OK",
    sharedItems: shared.length,
    sharedFolders: shared.filter((file) => file.mimeType === "application/vnd.google-apps.folder").length,
    sharedDocuments: shared.filter((file) => file.mimeType !== "application/vnd.google-apps.folder").length,
    enabledSources: sources.length,
    writes: false,
    transcriptReads: 0,
    analysesQueued: 0,
  }));
}

async function runCycle(): Promise<ScanTotals | null> {
  const startedAt = Date.now();
  const state = await repository.claimDiscoveryState({ workerId, leaseSeconds });
  if (!state) return null;
  const renewalIntervalMs = Math.min(60_000, Math.max(10_000, Math.floor(leaseSeconds * 1_000 / 3)));
  let discoveryLeaseLost = false;
  const discoveryRenewal = setInterval(() => {
    void Promise.all([
      repository.renewDiscoveryLease({ workerId, leaseSeconds }),
      repository.heartbeat({ workerId, releaseSha: process.env.RELEASE_SHA ?? null, status: "running" }),
    ])
      .then(([renewed]) => { if (!renewed) discoveryLeaseLost = true; })
      .catch(() => { discoveryLeaseLost = true; });
  }, renewalIntervalMs);
  await repository.heartbeat({ workerId, releaseSha: process.env.RELEASE_SHA ?? null, status: "running" });
  console.log(JSON.stringify({ event: "Drive scan started", mode: state.changesPageToken ? "incremental" : "initial" }));
  const totals = emptyTotals();
  let nextChangesToken: string | null | undefined;
  let bootstrapCompleted = false;
  let changesScanned = false;
  let success = false;
  let ingestionRunId: string | null = null;
  let contentReads = 0;

  const people = await repository.getPeopleDirectory();
  const catalogEntries = async (source: { sourceId: string; sellerId: string | null }, entries: GoogleDriveTreeEntry[], errors: Array<{ fileId: string; errorCode: string }>) => {
    const summary = await catalogDriveTree({
      sourceId: source.sourceId,
      entries,
      errors,
      revisitLinkedDocuments: autoQueue,
    }, repository, async (item) => {
      if (!item.candidate && !item.needsContentReview) return;
      const canRead = contentReads < contentReadLimit;
      if (item.needsContentReview && !canRead) return;
      const resolved = await resolveDriveTranscript({
        documentId: item.documentId,
        sourceSellerId: source.sellerId,
        entry: item.entry,
        people,
        readTranscript: canRead ? async (fileId) => {
          contentReads += 1;
          return transcriptFetcher.fetchByMimeType(fileId, item.entry.file.mimeType, item.entry.file.resourceKey);
        } : undefined,
        persistTranscript: persistTranscripts
          ? async (callId, fileId, text) => { await ingestion.storeTranscript(callId, fileId, text); }
          : undefined,
        requestAnalysis: autoQueue,
      }, repository);
      totals.newCalls += Number(resolved.createdCall);
      totals.linkedExistingCalls += Number(resolved.matchedExistingCall);
      totals.closerResolved += Number(resolved.closerResolved);
      totals.closerUnresolved += Number(!resolved.closerResolved && resolved.status !== "inaccessible");
      totals.needsReview += Number(resolved.status === "needs_review");
    });
    mergeTotals(totals, summary);
    if (summary.errors > 0) throw new Error("drive_catalog_persistence_incomplete");
  };

  const scanSource = async (source: DriveSource, fullScan: boolean): Promise<boolean> => {
    const claimed = await repository.claimSourceById({ sourceId: source.sourceId, workerId, leaseSeconds });
    if (!claimed) return true;
    let sourceLeaseLost = false;
    const sourceRenewal = setInterval(() => {
      void repository.renewSourceLease({ sourceId: claimed.sourceId, workerId, leaseSeconds })
        .then((renewed) => { if (!renewed) sourceLeaseLost = true; })
        .catch(() => { sourceLeaseLost = true; });
    }, renewalIntervalMs);
    const sourceScanStartedAt = new Date().toISOString();
    try {
      const root = await drive.getFile(claimed.googleFileId, claimed.resourceKey);
      if (root.mimeType !== "application/vnd.google-apps.folder") throw new Error("drive_source_not_folder");
      const tree = await discoverGoogleDriveTree(drive, { id: root.id, name: root.name, resourceKey: root.resourceKey });
      await catalogEntries(claimed, tree.entries, tree.errors);
      if (sourceLeaseLost || discoveryLeaseLost) throw new Error("drive_source_lease_lost");
      if (tree.errors.length === 0) {
        await repository.deactivateSourceDocumentsNotSeenSince({ sourceId: claimed.sourceId, scanStartedAt: sourceScanStartedAt });
      }
      totals.sourcesScanned += 1;
      await repository.completeSourceScan({ sourceId: claimed.sourceId, workerId, fullScan, success: true });
      return true;
    } catch {
      totals.errors += 1;
      await repository.completeSourceScan({ sourceId: claimed.sourceId, workerId, fullScan, success: false });
      return false;
    } finally {
      clearInterval(sourceRenewal);
    }
  };

  try {
    const run = await repository.sql<{ id: string }[]>`
      insert into ingestion_runs(source_type,product,mode,metadata)
      values ('google_drive_discovery','MIXED','controlled',${repository.sql.json({
        auto_queue: autoQueue, persist_transcripts: persistTranscripts, content_read_limit: contentReadLimit,
      })}) returning id
    `;
    ingestionRunId = run[0].id;

    const shared = await drive.listSharedWithMe();
    const inboxSourceId = await repository.getSharedInboxSourceId();
    const directEntries: GoogleDriveTreeEntry[] = [];
    const directErrors: Array<{
      fileId: string; errorCode: string; shortcutId?: string; name?: string; mimeType?: string | null;
      ancestorIds?: string[]; ancestorNames?: string[];
    }> = [];
    for (const file of shared) {
      let canonical = file;
      let shortcutId: string | null = null;
      if (file.mimeType === "application/vnd.google-apps.shortcut" && file.shortcutDetails) {
        shortcutId = file.id;
        try {
          canonical = await drive.getFile(file.shortcutDetails.targetId, file.shortcutDetails.targetResourceKey);
        } catch (error) {
          directErrors.push({
            fileId: file.shortcutDetails.targetId,
            shortcutId: file.id,
            name: file.name,
            mimeType: file.shortcutDetails.targetMimeType,
            ancestorIds: [],
            ancestorNames: ["Shared with me"],
            errorCode: error instanceof Error ? error.message : "drive_shortcut_target_failed",
          });
          continue;
        }
      }
      if (canonical.mimeType === "application/vnd.google-apps.folder") {
        const source = await repository.upsertSourceCandidate({
          googleFileId: canonical.id, name: canonical.name, mimeType: canonical.mimeType,
          resourceKey: canonical.resourceKey ?? file.shortcutDetails?.targetResourceKey ?? null,
          driveId: canonical.driveId,
        });
        totals.sourceCandidates += Number(source.created);
      } else if (!canonical.trashed) {
        directEntries.push({ file: canonical, ancestorIds: [], ancestorNames: ["Shared with me"], shortcutId });
      }
    }
    if (directEntries.length || directErrors.length) {
      await catalogEntries({ sourceId: inboxSourceId, sellerId: null }, directEntries, directErrors);
    }

    const sources = await repository.listEnabledSources();
    const affectedSourceIds = new Set<string>();
    if (!state.changesPageToken) {
      nextChangesToken = await drive.getStartPageToken();
      for (const source of sources) affectedSourceIds.add(source.sourceId);
      bootstrapCompleted = true;
    } else {
      const changes = await drive.listChanges(state.changesPageToken);
      nextChangesToken = changes.newStartPageToken;
      changesScanned = true;
      for (const change of changes.changes) {
        const sourceIds = await repository.findSourceIdsForChange(change.fileId, change.file?.parents ?? []);
        if (change.removed) await repository.markDocumentInaccessible(change.fileId, "drive_removed");
        else if (change.file?.trashed) await repository.markDocumentInaccessible(change.fileId, "drive_trashed");
        if (sourceIds.includes(inboxSourceId) && change.file && !change.file.trashed) {
          await catalogEntries({ sourceId: inboxSourceId, sellerId: null }, [{
            file: change.file, ancestorIds: [], ancestorNames: ["Shared with me"], shortcutId: null,
          }], []);
        }
        for (const sourceId of sourceIds) if (sourceId !== inboxSourceId) affectedSourceIds.add(sourceId);
      }
      const fullScanBefore = Date.now() - fullScanIntervalMs;
      for (const source of sources) {
        if (!source.lastFullScanAt || new Date(source.lastFullScanAt).getTime() < fullScanBefore) affectedSourceIds.add(source.sourceId);
      }
    }
    if (forceFullScan) for (const source of sources) affectedSourceIds.add(source.sourceId);
    if (autoQueue) {
      for (const sourceId of await repository.listSourceIdsWithIneligibleCalls()) affectedSourceIds.add(sourceId);
    }
    let allSourceScansSucceeded = true;
    for (const sourceId of affectedSourceIds) {
      const source = sources.find((candidate) => candidate.sourceId === sourceId);
      if (source) allSourceScansSucceeded = await scanSource(source, true) && allSourceScansSucceeded;
    }
    if (!allSourceScansSucceeded) throw new Error("drive_source_scan_incomplete");
    if (discoveryLeaseLost) throw new Error("drive_discovery_lease_lost");
    success = true;
    return totals;
  } finally {
    clearInterval(discoveryRenewal);
    if (ingestionRunId) {
      await repository.sql`
        update ingestion_runs set finished_at=now(),status=${success ? totals.errors ? "completed_with_errors" : "completed" : "failed"},
          sources_scanned=${totals.sourcesScanned},items_scanned=${totals.discovered},calls_discovered=${totals.candidates},
          calls_created=${totals.newCalls},calls_matched_existing=${totals.linkedExistingCalls},ignored_count=${totals.ignored},
          errors_count=${totals.errors},metadata=metadata||${repository.sql.json({
            source_candidates: totals.sourceCandidates,
            existing_documents: totals.existing,
            inaccessible: totals.inaccessible,
            closer_resolved: totals.closerResolved,
            closer_unresolved: totals.closerUnresolved,
            needs_review: totals.needsReview,
            content_reads: contentReads,
            analyses_queued_enabled: autoQueue,
            duration_ms: Date.now() - startedAt,
          })},updated_at=now() where id=${ingestionRunId}
      `;
    }
    await repository.completeDiscoveryState({
      workerId,
      changesPageToken: nextChangesToken,
      bootstrapCompleted,
      sharedWithMeScanned: true,
      changesScanned,
      success,
    });
    await repository.heartbeat({
      workerId, releaseSha: process.env.RELEASE_SHA ?? null,
      status: success ? "idle" : "error", errorCode: success ? undefined : "drive_scan_failed",
    });
    console.log(JSON.stringify({
      event: "Drive scan completed",
      success,
      sourcesScanned: totals.sourcesScanned,
      documentsDiscovered: totals.discovered,
      newDocuments: totals.created,
      newCandidates: totals.newCandidates,
      existingDocuments: totals.existing,
      transcriptCandidates: totals.candidates,
      callsCreated: totals.newCalls,
      linkedExistingCalls: totals.linkedExistingCalls,
      needsReview: totals.needsReview,
      inaccessible: totals.inaccessible,
      errors: totals.errors,
      durationMs: Date.now() - startedAt,
    }));
  }
}

try {
  if (!apply) {
    await dryRun();
  } else if (daemon) {
    await repository.heartbeat({ workerId, releaseSha: process.env.RELEASE_SHA ?? null, status: "starting" });
    while (!stopping) {
      await runCycle();
      if (stopping) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    await repository.heartbeat({ workerId, releaseSha: process.env.RELEASE_SHA ?? null, status: "stopped" });
  } else {
    await runCycle();
  }
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) : "drive_discovery_failed";
  await repository.heartbeat({ workerId, releaseSha: process.env.RELEASE_SHA ?? null, status: "error", errorCode: code }).catch(() => undefined);
  throw new Error(code);
} finally {
  await ingestion.close();
}
