import { resolve } from "node:path";
import postgres from "postgres";
import {
  classifySystemOneSource,
  reconstructSystemOneLogicalCalls,
  type SystemOneSourceAsset,
} from "@igd/core";
import {
  GoogleDriveDiscoveryClient,
  GoogleDriveTranscriptFetcher,
  GoogleOAuthRefreshTokenProvider,
  type GoogleDriveFile,
} from "@igd/google";
import {
  assertCompleteDriveTraversal,
  assertEnabledRootFolder,
  assertReadOnlyDriveScopes,
  assertReadOnlyInventorySql,
  classifyCurrentReferenceComparison,
  isCurrentRowSelectedVerifiedTranscript,
  opaqueInventoryId,
  selectInventoryDirectSharedFiles,
  writeDriveInventoryArtifacts,
  type DriveInventoryArtifactInput,
  type DriveInventoryRow,
  type DriveInventorySummary,
} from "./lib/system-one-drive-inventory.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

const CURRENT_CALLS_SQL = `
  select c.id::text call_id,
    c.transcript_file_id::text file_id,
    coalesce(artifact.artifact_type, 'none')::text artifact_type
  from public.calls c
  left join lateral (
    select ca.artifact_type
    from public.call_artifacts ca
    where ca.call_id=c.id and ca.external_file_id=c.transcript_file_id
    order by ca.created_at,ca.id
    limit 1
  ) artifact on true
  where c.transcript_file_id is not null
  order by c.id
`;

const ENABLED_ROOTS_SQL = `
  select external_folder_id::text file_id,
    nullif(metadata->>'resource_key','')::text resource_key
  from public.source_locations
  where provider='google_drive'
    and source_type='folder'
    and active=true
    and registration_status='enabled'
  order by external_folder_id
`;

const DATABASE_SAFETY_SQL = `
  select current_user::text current_user,
    current_setting('transaction_read_only')::text transaction_read_only
`;

for (const statement of [CURRENT_CALLS_SQL, ENABLED_ROOTS_SQL, DATABASE_SAFETY_SQL]) assertReadOnlyInventorySql(statement);

function argument(name: string, fallback?: string): string | undefined {
  return process.argv.slice(2).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`invalid_${name.replace(/^--/, "").replaceAll("-", "_")}`);
  return value;
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round(numerator / denominator * 10_000) / 100;
}

function safeYear(value: string | null): number | null {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function safeCode(error: unknown): string {
  return (error instanceof Error ? error.message : "inventory_failed")
    .replace(/[^a-z0-9:_-]/gi, "_")
    .slice(0, 100);
}

async function mapLimit<T, U>(values: T[], concurrency: number, operation: (value: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(values.length, 1)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index], index);
    }
  }));
  return results;
}

async function retryRead<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = safeCode(error);
      const retryable = code.includes("rate_limited") || code.includes("provider_unavailable") || code.includes("fetch_failed");
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * 2 ** attempt));
    }
  }
  throw new Error("inventory_retry_exhausted");
}

type CurrentCallReference = { call_id: string; file_id: string; artifact_type: string };
type EnabledRoot = { file_id: string; resource_key: string | null };
type FolderTask = { file: GoogleDriveFile; ancestorIds: string[]; sourceKind: string };
type CollectedAsset = { asset: SystemOneSourceAsset; resourceKey: string | null };

function asSourceAsset(file: GoogleDriveFile, input: {
  ancestorIds: string[];
  sourceKind: string;
  shortcutTargetId?: string | null;
}): SystemOneSourceAsset {
  return {
    assetId: file.id,
    sourceKind: input.sourceKind,
    name: file.name,
    mimeType: file.mimeType,
    parentIds: [...file.parents].sort(),
    ancestorIds: [...new Set(input.ancestorIds)].sort(),
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    fullFileExtension: file.fullFileExtension,
    originalFilename: file.originalFilename,
    shortcutTargetId: input.shortcutTargetId ?? null,
    description: file.description,
    propertyKeys: Object.keys(file.properties).sort(),
    appPropertyKeys: Object.keys(file.appProperties).sort(),
    contentText: null,
  };
}

async function canonicalizeFile(drive: GoogleDriveDiscoveryClient, file: GoogleDriveFile): Promise<{
  file: GoogleDriveFile;
  shortcutTargetId: string | null;
}> {
  if (file.mimeType !== SHORTCUT_MIME_TYPE || !file.shortcutDetails) return { file, shortcutTargetId: null };
  return {
    file: await retryRead(() => drive.getFile(file.shortcutDetails!.targetId, file.shortcutDetails!.targetResourceKey)),
    shortcutTargetId: file.shortcutDetails.targetId,
  };
}

async function collectDriveUniverse(input: {
  drive: GoogleDriveDiscoveryClient;
  shared: GoogleDriveFile[];
  enabledRoots: EnabledRoot[];
  concurrency: number;
}): Promise<{
  assets: CollectedAsset[];
  foldersScanned: number;
  traversalErrors: number;
  rootIds: string[];
}> {
  const assets: CollectedAsset[] = [];
  const rootTasks: FolderTask[] = [];
  const rootIds = new Set<string>();
  let traversalErrors = 0;

  const sharedSelection = selectInventoryDirectSharedFiles(input.shared);
  const sharedCanonical = await mapLimit(sharedSelection.directFiles, input.concurrency, async (item) => {
    try {
      return await canonicalizeFile(input.drive, item);
    } catch {
      traversalErrors += 1;
      return null;
    }
  });
  for (const canonical of sharedCanonical) {
    if (!canonical || canonical.file.trashed) continue;
    assets.push({
      asset: asSourceAsset(canonical.file, {
        ancestorIds: [],
        sourceKind: "shared_with_me",
        shortcutTargetId: canonical.shortcutTargetId,
      }),
      resourceKey: canonical.file.resourceKey,
    });
  }

  const enabledCanonical = await mapLimit(input.enabledRoots, input.concurrency, async (root) => {
    try {
      return await retryRead(() => input.drive.getFile(root.file_id, root.resource_key));
    } catch {
      traversalErrors += 1;
      return null;
    }
  });
  for (const file of enabledCanonical) {
    if (!file) continue;
    try {
      assertEnabledRootFolder(file.mimeType);
    } catch {
      traversalErrors += 1;
      continue;
    }
    rootTasks.push({ file, ancestorIds: [file.id], sourceKind: "enabled_root" });
    rootIds.add(file.id);
  }

  const visited = new Set<string>();
  let frontier = rootTasks;
  while (frontier.length) {
    const level = frontier.filter((task) => {
      if (visited.has(task.file.id)) return false;
      visited.add(task.file.id);
      return true;
    });
    const pages = await mapLimit(level, input.concurrency, async (task) => {
      try {
        return { task, children: await retryRead(() => input.drive.listChildren(task.file.id, task.file.resourceKey)) };
      } catch {
        traversalErrors += 1;
        return { task, children: [] as GoogleDriveFile[] };
      }
    });
    const next: FolderTask[] = [];
    for (const page of pages) {
      const canonicalChildren = await mapLimit(page.children, input.concurrency, async (child) => {
        try {
          return await canonicalizeFile(input.drive, child);
        } catch {
          traversalErrors += 1;
          return null;
        }
      });
      for (const canonical of canonicalChildren) {
        if (!canonical || canonical.file.trashed) continue;
        if (canonical.file.mimeType === FOLDER_MIME_TYPE) {
          next.push({
            file: canonical.file,
            ancestorIds: [...page.task.ancestorIds, canonical.file.id],
            sourceKind: page.task.sourceKind,
          });
        } else {
          assets.push({
            asset: asSourceAsset(canonical.file, {
              ancestorIds: page.task.ancestorIds,
              sourceKind: page.task.sourceKind,
              shortcutTargetId: canonical.shortcutTargetId,
            }),
            resourceKey: canonical.file.resourceKey,
          });
        }
      }
    }
    frontier = next;
  }
  return { assets, foldersScanned: visited.size, traversalErrors, rootIds: [...rootIds].sort() };
}

function sourceAssetFromClassification(asset: ReturnType<typeof classifySystemOneSource>, contentText: string | null): SystemOneSourceAsset {
  return {
    assetId: asset.assetId,
    sourceKind: asset.sourceKind,
    name: asset.name,
    mimeType: asset.mimeType,
    parentIds: asset.parentIds,
    ancestorIds: asset.ancestorIds,
    createdTime: asset.createdTime,
    modifiedTime: asset.modifiedTime,
    fullFileExtension: asset.fullFileExtension,
    originalFilename: asset.originalFilename,
    shortcutTargetId: asset.shortcutTargetId,
    description: asset.description,
    propertyKeys: asset.propertyKeys,
    appPropertyKeys: asset.appPropertyKeys,
    contentText,
  };
}

async function main(): Promise<void> {
  if (process.argv.some((value) => value === "--apply" || value === "--write-db" || value === "--execute-provider")) {
    throw new Error("inventory_read_only_mode_only");
  }
  const privateOutputDirectory = resolve("private/system-one");
  const outputDirectory = resolve(argument("--output-dir", "private/system-one")!);
  if (outputDirectory !== privateOutputDirectory) throw new Error("inventory_output_must_be_private_system_one");
  const metadataConcurrency = positiveInteger("--metadata-concurrency", 12, 32);
  const contentConcurrency = positiveInteger("--content-concurrency", 4, 8);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
  if (!databaseUrl) throw new Error("database_url_required_for_inventory_comparison");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("google_oauth_configuration_incomplete");

  const oauth = new GoogleOAuthRefreshTokenProvider({ clientId, clientSecret, refreshToken });
  const accessToken = await oauth.getAccessToken();
  const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!tokenInfoResponse.ok) throw new Error("google_oauth_scope_validation_failed");
  const tokenInfo = await tokenInfoResponse.json() as { scope?: unknown };
  const scopes = String(tokenInfo.scope ?? "").split(/\s+/).filter(Boolean).sort();
  assertReadOnlyDriveScopes(scopes);

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  let currentCalls: CurrentCallReference[];
  let enabledRoots: EnabledRoot[];
  let databaseUser: string;
  try {
    const database = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction read only");
      const safety = await tx.unsafe<Array<{ current_user: string; transaction_read_only: string }>>(DATABASE_SAFETY_SQL);
      if (safety[0]?.transaction_read_only !== "on") throw new Error("inventory_database_transaction_not_read_only");
      return {
        safety: safety[0],
        calls: await tx.unsafe<CurrentCallReference[]>(CURRENT_CALLS_SQL),
        roots: await tx.unsafe<EnabledRoot[]>(ENABLED_ROOTS_SQL),
      };
    });
    currentCalls = database.calls;
    enabledRoots = database.roots;
    databaseUser = database.safety.current_user;
  } finally {
    await sql.end();
  }

  const drive = new GoogleDriveDiscoveryClient(oauth);
  const transcriptFetcher = new GoogleDriveTranscriptFetcher(oauth);
  const shared = await retryRead(() => drive.listSharedWithMe());
  console.log(JSON.stringify({ event: "inventory_metadata_scan_started", sharedItems: shared.length, currentCalls: currentCalls.length }));
  const universe = await collectDriveUniverse({ drive, shared, enabledRoots, concurrency: metadataConcurrency });
  assertCompleteDriveTraversal(universe.traversalErrors);

  const currentReferenceResults = await mapLimit(currentCalls, metadataConcurrency, async (reference, index) => {
    try {
      const file = await retryRead(() => drive.getFile(reference.file_id));
      if ((index + 1) % 500 === 0) console.log(JSON.stringify({ event: "inventory_current_references_progress", processed: index + 1, total: currentCalls.length }));
      return {
        reference,
        collected: {
          asset: asSourceAsset(file, { ancestorIds: file.parents, sourceKind: "current_database_reference" }),
          resourceKey: file.resourceKey,
        } satisfies CollectedAsset,
        error: null,
      };
    } catch (error) {
      return { reference, collected: null, error: safeCode(error) };
    }
  });
  const inaccessibleReferences = currentReferenceResults.filter((result) => result.error !== null);
  const inaccessibleCurrentReferenceFileIds = new Set(inaccessibleReferences.map((result) => result.reference.file_id));

  const allCollected = [
    ...universe.assets,
    ...currentReferenceResults.flatMap((result) => result.collected ? [result.collected] : []),
  ];
  const resourceKeys = new Map<string, string | null>();
  for (const item of allCollected) if (!resourceKeys.has(item.asset.assetId) || item.resourceKey) resourceKeys.set(item.asset.assetId, item.resourceKey);

  const metadataReconstruction = reconstructSystemOneLogicalCalls(allCollected.map((item) => item.asset));
  const transcriptCandidates = metadataReconstruction.assets.filter((asset) => asset.assetClass === "verified_transcript_candidate");
  let contentReadErrors = 0;
  const contentByAsset = new Map<string, string>();
  await mapLimit(transcriptCandidates, contentConcurrency, async (candidate) => {
    try {
      const text = await retryRead(() => transcriptFetcher.fetchByMimeType(candidate.assetId, candidate.mimeType, resourceKeys.get(candidate.assetId)));
      contentByAsset.set(candidate.assetId, text);
    } catch {
      contentReadErrors += 1;
    }
  });

  const finalReconstruction = reconstructSystemOneLogicalCalls(metadataReconstruction.assets.map((asset) =>
    sourceAssetFromClassification(asset, contentByAsset.get(asset.assetId) ?? null)));
  const logicalByKey = new Map(finalReconstruction.logicalCalls.map((call) => [call.logicalCallKey, call]));
  const logicalByAsset = new Map<string, typeof finalReconstruction.logicalCalls[number]>();
  for (const call of finalReconstruction.logicalCalls) for (const assetId of call.assetIds) logicalByAsset.set(assetId, call);
  const classificationByAsset = new Map(finalReconstruction.assets.map((asset) => [asset.assetId, asset]));

  const currentByAsset = new Map<string, CurrentCallReference[]>();
  for (const current of currentCalls) {
    const matches = currentByAsset.get(current.file_id) ?? [];
    matches.push(current);
    currentByAsset.set(current.file_id, matches);
  }

  const opaqueCurrent = (callId: string) => opaqueInventoryId("current-call", callId);
  const inventory: DriveInventoryRow[] = finalReconstruction.assets.map((asset) => {
    const logicalCall = logicalByKey.get(asset.logicalCallKey);
    return {
      opaque_asset_id: opaqueInventoryId("asset", asset.assetId),
      opaque_logical_call_id: opaqueInventoryId("logical-call", logicalCall?.logicalCallKey ?? `non-call:${asset.logicalCallKey}`),
      asset_class: asset.assetClass,
      eligible_for_analysis: asset.eligibleForAnalysis,
      selected_for_analysis: logicalCall?.selectedAssetId === asset.assetId,
      mime_type: asset.mimeType,
      source_kind: asset.transcriptProvenance ?? (asset.assetClass === "ai_notes" ? "google_drive_ai_notes" : asset.assetClass === "recording" ? "google_drive_recording" : asset.sourceKind),
      structural_check_status: asset.structuralCheckStatus,
      exclusion_reason: asset.exclusionReason,
      created_year: safeYear(asset.createdTime),
      metadata: {
        ancestor_depth: asset.ancestorIds.length,
        parent_count: asset.parentIds.length,
        parent_ids: asset.parentIds.map((id) => opaqueInventoryId("root", id)).sort(),
        shortcut: asset.shortcutTargetId !== null,
        full_file_extension: asset.fullFileExtension,
        property_key_hashes: asset.propertyKeys.map((key) => opaqueInventoryId("metadata-key", key)).sort(),
        app_property_key_hashes: asset.appPropertyKeys.map((key) => opaqueInventoryId("metadata-key", key)).sort(),
        modified_year: safeYear(asset.modifiedTime),
        structural_metrics: asset.structuralMetrics,
        current_call_ids: (currentByAsset.get(asset.assetId) ?? []).map((call) => opaqueCurrent(call.call_id)).sort(),
      },
    };
  });

  let currentRowsMatchedEligible = 0;
  let currentRowsAiNotes = 0;
  let currentRowsWithoutValidTranscript = 0;
  const currentLogicalGroups = new Map<string, CurrentCallReference[]>();
  const currentRowsWithoutDriveMatch: string[] = [];
  for (const current of currentCalls) {
    if (inaccessibleCurrentReferenceFileIds.has(current.file_id)) {
      const comparison = classifyCurrentReferenceComparison({
        referenceAccessible: false,
        selectedVerifiedTranscript: false,
      });
      if (comparison.eligibleForAnalysis) throw new Error("inventory_inaccessible_current_reference_became_eligible");
      currentRowsWithoutValidTranscript += 1;
      currentRowsWithoutDriveMatch.push(opaqueCurrent(current.call_id));
      continue;
    }
    const asset = classificationByAsset.get(current.file_id);
    const logicalCall = logicalByAsset.get(current.file_id);
    if (!asset || !logicalCall) {
      currentRowsWithoutValidTranscript += 1;
      currentRowsWithoutDriveMatch.push(opaqueCurrent(current.call_id));
      continue;
    }
    if (asset.assetClass === "ai_notes") currentRowsAiNotes += 1;
    const comparison = classifyCurrentReferenceComparison({
      referenceAccessible: true,
      selectedVerifiedTranscript: isCurrentRowSelectedVerifiedTranscript({
        referencedAssetId: current.file_id,
        selectedAssetId: logicalCall.selectedAssetId,
        assetEligibleForAnalysis: asset.eligibleForAnalysis,
        logicalCallEligibleForAnalysis: logicalCall.eligibleForAnalysis,
      }),
    });
    if (comparison.eligibleForAnalysis) currentRowsMatchedEligible += 1;
    else currentRowsWithoutValidTranscript += 1;
    const rows = currentLogicalGroups.get(logicalCall.logicalCallKey) ?? [];
    rows.push(current);
    currentLogicalGroups.set(logicalCall.logicalCallKey, rows);
  }

  const duplicateGroups = [...currentLogicalGroups.entries()].filter(([, rows]) => rows.length > 1);
  const currentPossibleDuplicateRows = duplicateGroups.reduce((total, [, rows]) => total + rows.length - 1, 0);
  const currentRepresentedLogicalKeys = new Set(currentLogicalGroups.keys());
  const driveLogicalCallsMissingCurrent = finalReconstruction.logicalCalls.filter((call) => !currentRepresentedLogicalKeys.has(call.logicalCallKey));
  const currentRowsRecommendedToExclude = currentCalls.length - currentRowsMatchedEligible;

  const logicalCallsWithVerifiedTranscript = finalReconstruction.logicalCalls.filter((call) =>
    call.assetIds.some((assetId) => classificationByAsset.get(assetId)?.eligibleForAnalysis)).length;
  const eligibleLogicalCalls = finalReconstruction.logicalCalls.filter((call) => call.eligibleForAnalysis).length;
  const absoluteDifference = Math.abs(currentCalls.length - eligibleLogicalCalls);
  const classCount = (value: typeof finalReconstruction.assets[number]["assetClass"]) =>
    finalReconstruction.assets.filter((asset) => asset.assetClass === value).length;
  const summary: DriveInventorySummary = {
    drive_assets_total: finalReconstruction.assets.length,
    logical_calls_total: finalReconstruction.logicalCalls.length,
    logical_calls_with_verified_transcript: logicalCallsWithVerifiedTranscript,
    ai_notes_assets: classCount("ai_notes"),
    recording_assets: classCount("recording"),
    recording_only_logical_calls: finalReconstruction.logicalCalls.filter((call) => call.exclusionReason === "recording_only").length,
    other_documents: classCount("other_document"),
    unknown_assets: classCount("unknown"),
    ambiguous_logical_calls: finalReconstruction.logicalCalls.filter((call) => call.ambiguous).length,
    eligible_logical_calls: eligibleLogicalCalls,
    ineligible_logical_calls: finalReconstruction.logicalCalls.length - eligibleLogicalCalls,
    eligible_percent: roundPercent(eligibleLogicalCalls, finalReconstruction.logicalCalls.length),
    current_admin_count: currentCalls.length,
    rebuilt_eligible_count: eligibleLogicalCalls,
    absolute_difference: absoluteDifference,
    percent_difference: roundPercent(absoluteDifference, currentCalls.length),
    current_rows_matched_to_eligible_logical_calls: currentRowsMatchedEligible,
    current_rows_recommended_to_remain_eligible: currentRowsMatchedEligible,
    current_rows_recommended_to_exclude_from_queue: currentRowsRecommendedToExclude,
    current_rows_whose_source_is_ai_notes: currentRowsAiNotes,
    current_rows_without_valid_transcript: currentRowsWithoutValidTranscript,
    current_possible_duplicate_rows: currentPossibleDuplicateRows,
    possible_historical_duplicate_logical_calls: duplicateGroups.length,
    drive_logical_calls_missing_from_current_db: driveLogicalCallsMissingCurrent.length,
    current_rows_without_drive_match: currentRowsWithoutDriveMatch.length,
    current_rows_ineligible_due_to_unresolvable_drive_reference: inaccessibleReferences.length,
    current_reference_comparison_complete: inaccessibleReferences.length === 0,
    current_reference_comparison_status: inaccessibleReferences.length === 0 ? "complete" : "partial_fail_closed",
    current_rows_without_drive_match_opaque_ids: currentRowsWithoutDriveMatch.sort(),
    possible_duplicate_logical_call_opaque_ids: duplicateGroups.map(([key]) => opaqueInventoryId("logical-call", key)).sort(),
    drive_missing_current_eligible_logical_call_opaque_ids: driveLogicalCallsMissingCurrent
      .filter((call) => call.eligibleForAnalysis)
      .map((call) => opaqueInventoryId("logical-call", call.logicalCallKey)).sort(),
    google_drive_auth: {
      refresh: "OK",
      scopes,
      required_scope: DRIVE_READONLY_SCOPE,
    },
    drive_discovery_scope: {
      shared_items: shared.length,
      shared_folder_roots: shared.filter((file) => file.mimeType === FOLDER_MIME_TYPE).length,
      enabled_roots: enabledRoots.length,
      opaque_root_ids: universe.rootIds.map((id) => opaqueInventoryId("root", id)),
      folders_scanned: universe.foldersScanned,
      traversal_errors: universe.traversalErrors,
      inaccessible_current_references: inaccessibleReferences.length,
    },
    real_asset_patterns_found: {
      google_docs_named_gemini_notes: finalReconstruction.assets.filter((asset) => asset.assetClass === "ai_notes" && asset.mimeType === "application/vnd.google-apps.document").length,
      meet_caption_sbv_or_vtt: finalReconstruction.assets.filter((asset) => asset.transcriptProvenance === "google_meet_caption_file").length,
      explicit_transcript_documents: finalReconstruction.assets.filter((asset) => asset.transcriptProvenance === "explicit_transcript_name").length,
      video_or_audio_recordings: classCount("recording"),
      metadata_property_key_hashes: [...new Set(finalReconstruction.assets.flatMap((asset) => asset.propertyKeys)
        .map((key) => opaqueInventoryId("metadata-key", key)))].sort(),
      metadata_app_property_key_hashes: [...new Set(finalReconstruction.assets.flatMap((asset) => asset.appPropertyKeys)
        .map((key) => opaqueInventoryId("metadata-key", key)))].sort(),
      content_read_errors: contentReadErrors,
    },
    zero_inference_verification: {
      provider_calls: 0,
      gpt_tokens: 0,
      gemini_tokens: 0,
      laya_calls: 0,
      jev_calls: 0,
      vercel_ai_calls: 0,
      drive_api_only: true,
      database_writes: 0,
      database_transaction_read_only: true,
      database_role: databaseUser,
    },
  };

  const artifactInput: DriveInventoryArtifactInput = { inventory, summary };
  await writeDriveInventoryArtifacts(outputDirectory, artifactInput);
  console.log(JSON.stringify({
    event: "inventory_completed",
    outputDirectory,
    driveAssetsTotal: summary.drive_assets_total,
    logicalCallsTotal: summary.logical_calls_total,
    eligibleLogicalCalls: summary.eligible_logical_calls,
    currentAdminCount: summary.current_admin_count,
    currentRowsRecommendedToRemainEligible: summary.current_rows_recommended_to_remain_eligible,
    currentRowsRecommendedToExclude: summary.current_rows_recommended_to_exclude_from_queue,
    writesToDrive: 0,
    writesToDatabase: 0,
    providerCalls: 0,
  }));
}

await main();
