/**
 * Freezes the first real benchmark v01 (Jev x Laya) cohort, universe, protocol
 * freeze and empty ground-truth template.
 *
 * Offline by construction: it reads two already-approved private artifacts and
 * writes three private artifacts. No PostgreSQL, no Drive, no provider call, no
 * transcript body. Run it with:
 *
 *   npm run system-one:benchmark:freeze
 *
 * Everything it emits is metadata-only and must never be committed.
 */

import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createBenchmarkProtocol, BENCHMARK_DECISION_IDS } from "@igd/decision-engine";
import {
  BENCHMARK_COHORT_ARTIFACT_NAME,
  BENCHMARK_COHORT_SIZE,
  BENCHMARK_GROUND_TRUTH_ARTIFACT_NAME,
  BENCHMARK_INVENTORY_ARTIFACT_NAME,
  BENCHMARK_SNAPSHOT_ARTIFACT_NAME,
  BENCHMARK_UNIVERSE_ARTIFACT_NAME,
  buildBenchmarkFreeze,
  assertInventoryMatchesSnapshot,
  sha256Hex,
} from "./lib/system-one-benchmark-freeze.js";
import type { BenchmarkSnapshotInput } from "./lib/system-one-benchmark-cohort.js";
import type { BenchmarkUniverseInput } from "./lib/system-one-benchmark-universe.js";

export const SYSTEM_ONE_BENCHMARK_APPROVED_INPUTS = [
  BENCHMARK_SNAPSHOT_ARTIFACT_NAME,
  BENCHMARK_INVENTORY_ARTIFACT_NAME,
] as const;

export const SYSTEM_ONE_BENCHMARK_OUTPUTS = [
  BENCHMARK_UNIVERSE_ARTIFACT_NAME,
  BENCHMARK_COHORT_ARTIFACT_NAME,
  BENCHMARK_GROUND_TRUTH_ARTIFACT_NAME,
] as const;

type JsonObject = Record<string, unknown>;

function jsonObject(value: unknown, errorCode: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as JsonObject;
}

async function assertPrivateRoot(privateRoot: string): Promise<string> {
  if (!privateRoot || !isAbsolute(privateRoot)) throw new Error("private_root_must_be_absolute");
  const requested = resolve(privateRoot);
  const stats = await lstat(requested);
  if (stats.isSymbolicLink()) throw new Error("unsafe_private_root_symlink");
  if (!stats.isDirectory()) throw new Error("unsafe_private_root_type");
  const root = await realpath(requested);
  if ((stats.mode & 0o777) !== 0o700) throw new Error("unsafe_private_root_mode");
  return root;
}

async function readApprovedFile(root: string, name: string): Promise<Buffer> {
  if (!(SYSTEM_ONE_BENCHMARK_APPROVED_INPUTS as readonly string[]).includes(name)) {
    throw new Error(`benchmark_input_not_approved:${name}`);
  }
  const target = join(root, name);
  const stats = await lstat(target);
  if (stats.isSymbolicLink()) throw new Error("benchmark_input_symlink");
  if (!stats.isFile()) throw new Error("benchmark_input_not_file");
  const resolved = await realpath(target);
  if (dirname(resolved) !== root) throw new Error("benchmark_input_outside_private_root");
  return readFile(resolved);
}

async function writePrivateFile(root: string, name: string, content: string): Promise<string> {
  if (!(SYSTEM_ONE_BENCHMARK_OUTPUTS as readonly string[]).includes(name)) {
    throw new Error(`benchmark_output_not_approved:${name}`);
  }
  const target = join(root, name);
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  await chmod(target, 0o600);
  return target;
}

function snapshotInput(value: unknown): BenchmarkSnapshotInput & { readonly sourceArtifacts: readonly { readonly artifactName?: string; readonly sha256?: string }[] } {
  const snapshot = jsonObject(value, "benchmark_snapshot_invalid_shape");
  const metadata = jsonObject(snapshot.metadata, "benchmark_snapshot_metadata_missing");
  const status = jsonObject(metadata.status, "benchmark_snapshot_status_missing");
  const bounds: Record<string, number> = {};
  for (const key of ["verifiedTranscriptAssetLowerBound", "verifiedTranscriptAssetUpperBound", "irreducibleTranscriptScopeGap"] as const) {
    const value = metadata[key];
    if (!Number.isSafeInteger(value)) throw new Error(`benchmark_snapshot_${key}_invalid`);
    bounds[key] = value as number;
  }
  if (!Array.isArray(snapshot.canonicalAssets) || !Array.isArray(snapshot.canonicalLogicalCalls)) {
    throw new Error("benchmark_snapshot_universe_missing");
  }
  if (!Array.isArray(snapshot.candidateAssociations)) throw new Error("benchmark_snapshot_candidates_missing");
  if (!Array.isArray(snapshot.scopeExceptions)) throw new Error("benchmark_snapshot_exceptions_missing");
  return {
    metadata: {
      snapshotHash: metadata.snapshotHash as string,
      candidatePairSetHash: metadata.candidatePairSetHash as string,
      verifiedTranscriptAssetLowerBound: bounds.verifiedTranscriptAssetLowerBound!,
      verifiedTranscriptAssetUpperBound: bounds.verifiedTranscriptAssetUpperBound!,
      irreducibleTranscriptScopeGap: bounds.irreducibleTranscriptScopeGap!,
      status: {
        transcriptScopeExactlyValidated: status.transcriptScopeExactlyValidated === true,
        transcriptScopeBounded: status.transcriptScopeBounded === true,
        globalScopeValidated: status.globalScopeValidated === true,
      },
    },
    canonicalAssets: snapshot.canonicalAssets as BenchmarkSnapshotInput["canonicalAssets"],
    canonicalLogicalCalls: snapshot.canonicalLogicalCalls as BenchmarkSnapshotInput["canonicalLogicalCalls"],
    currentRowResolutions: (snapshot.currentRowResolutions ?? []) as BenchmarkSnapshotInput["currentRowResolutions"],
    candidateAssociations: snapshot.candidateAssociations as BenchmarkSnapshotInput["candidateAssociations"],
    scopeExceptions: snapshot.scopeExceptions as BenchmarkSnapshotInput["scopeExceptions"],
    sourceArtifacts: (metadata.sourceArtifacts ?? []) as readonly { readonly artifactName?: string; readonly sha256?: string }[],
  };
}

function inventoryRows(bytes: Buffer): BenchmarkUniverseInput["inventoryRows"] {
  const text = bytes.toString("utf8");
  const rows: BenchmarkUniverseInput["inventoryRows"][number][] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = jsonObject(JSON.parse(line), "benchmark_inventory_row_invalid");
    const metadata = jsonObject(row.metadata, "benchmark_inventory_metadata_missing");
    rows.push({
      opaque_asset_id: row.opaque_asset_id as string,
      created_year: row.created_year as number,
      source_kind: row.source_kind as string,
      structural_check_status: row.structural_check_status as string,
      metadata: { structural_metrics: (metadata.structural_metrics ?? null) as Record<string, unknown> | null },
    });
  }
  if (!rows.length) throw new Error("benchmark_inventory_empty");
  return rows;
}

async function main(): Promise<void> {
  const privateRootArgument = process.argv.slice(2).find((item) => item.startsWith("--private-root="))?.split("=")[1];
  const root = await assertPrivateRoot(privateRootArgument ?? resolve("private/system-one"));

  const snapshotBytes = await readApprovedFile(root, BENCHMARK_SNAPSHOT_ARTIFACT_NAME);
  const inventoryBytes = await readApprovedFile(root, BENCHMARK_INVENTORY_ARTIFACT_NAME);
  const snapshot = snapshotInput(JSON.parse(snapshotBytes.toString("utf8")));
  const inventorySha256 = sha256Hex(inventoryBytes);
  assertInventoryMatchesSnapshot({ snapshot, inventorySha256 });

  const artifacts = buildBenchmarkFreeze({
    snapshot,
    inventoryRows: inventoryRows(inventoryBytes),
    inventorySha256,
    cohortSize: BENCHMARK_COHORT_SIZE,
  });

  const freeze = createBenchmarkProtocol({
    sourceSnapshotHash: artifacts.cohort.sourceSnapshotHash,
    sourceCandidatePairSetHash: artifacts.cohort.sourceCandidatePairSetHash,
    canonicalLogicalCallCount: artifacts.cohort.canonicalLogicalCallCount,
    cohortSize: artifacts.cohort.cohortSize,
  });

  const universePath = await writePrivateFile(root, BENCHMARK_UNIVERSE_ARTIFACT_NAME, artifacts.universeJson);
  const cohortPath = await writePrivateFile(root, BENCHMARK_COHORT_ARTIFACT_NAME, `${JSON.stringify(artifacts.cohort, null, 2)}\n`);
  const groundTruthPath = await writePrivateFile(root, BENCHMARK_GROUND_TRUTH_ARTIFACT_NAME, artifacts.groundTruthJsonl);

  const keys = artifacts.cohort.selectedCanonicalLogicalCallKeys;
  const expectedUnits = keys.length * BENCHMARK_DECISION_IDS.length;
  process.stdout.write(`${JSON.stringify({
    benchmarkVersion: artifacts.cohort.benchmarkVersion,
    cohortVersion: artifacts.cohort.cohortVersion,
    selectionRuleVersion: artifacts.cohort.selectionRuleVersion,
    sourceSnapshotHash: artifacts.cohort.sourceSnapshotHash,
    sourceInventorySha256: artifacts.cohort.sourceInventorySha256,
    canonicalLogicalCallCount: artifacts.cohort.canonicalLogicalCallCount,
    eligiblePoolSize: artifacts.cohort.eligiblePoolSize,
    cohortSize: artifacts.cohort.cohortSize,
    cohortHash: artifacts.cohort.cohortHash,
    groundTruthUnits: artifacts.groundTruth.length,
    expectedGroundTruthUnits: expectedUnits,
    labelsFilled: 0,
    canonicalTranscriptResolverStatus: artifacts.cohort.canonicalTranscriptResolverStatus,
    freeze,
    outputs: { universePath, cohortPath, groundTruthPath },
    firstKeyPrefix: keys[0]?.slice(0, 6) ?? null,
    diversitySummary: artifacts.cohort.diversitySummary,
    safety: { networkUsed: false, driveUsed: false, postgresUsed: false, providerUsed: false, transcriptBodyRead: false },
  }, null, 2)}\n`);
}

const invokedDirectly = process.argv[1]?.endsWith("system-one-benchmark-freeze.ts") ?? false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "benchmark_freeze_failed"}\n`);
    process.exitCode = 1;
  });
}