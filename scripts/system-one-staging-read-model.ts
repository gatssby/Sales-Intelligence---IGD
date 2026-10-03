import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSystemOneStagingReadModel,
  type SystemOneStagingBuilderInput,
  type SystemOneStagingReadModel,
} from "@igd/core/system-one-staging-read-model";
import {
  SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS,
  adaptSystemOneStagingArtifacts,
  loadSystemOneStagingArtifacts,
  type SystemOneArtifactContract,
} from "./lib/system-one-staging-artifacts.js";

const SNAPSHOT_OUTPUT_NAME = "system-one-staging-read-model-v01.json" as const;
const SUMMARY_OUTPUT_NAME = "system-one-staging-read-model-v01-summary.json" as const;
const APPROVED_OUTPUT_NAMES = new Set<string>([SNAPSHOT_OUTPUT_NAME, SUMMARY_OUTPUT_NAME]);

export type SystemOneStagingRunnerOptions = {
  readonly privateRoot: string;
  readonly builtAt: string;
  readonly snapshotOutputName: typeof SNAPSHOT_OUTPUT_NAME;
  readonly summaryOutputName: typeof SUMMARY_OUTPUT_NAME;
};

export type SystemOneStagingRunnerResult = {
  readonly snapshotPath: string;
  readonly summaryPath: string;
  readonly snapshotHash: string;
  readonly candidatePairSetHash: string;
};

type PreparedOutput = {
  readonly targetPath: string;
  readonly tempPath: string;
};

function modeBits(mode: number): number {
  return mode & 0o777;
}

async function assertPrivateRoot(privateRoot: string): Promise<string> {
  if (!privateRoot || !isAbsolute(privateRoot)) throw new Error("private_root_must_be_absolute");
  const requestedRoot = resolve(privateRoot);
  const requestedStats = await lstat(requestedRoot);
  if (requestedStats.isSymbolicLink()) throw new Error("unsafe_private_root_symlink");
  if (!requestedStats.isDirectory()) throw new Error("unsafe_private_root_type");
  const root = await realpath(requestedRoot);
  const mode = modeBits(requestedStats.mode);
  if ((mode & 0o700) !== 0o700) throw new Error("unsafe_private_root_mode");
  if (mode !== 0o700) await chmod(root, 0o700);
  if (modeBits((await lstat(root)).mode) !== 0o700) throw new Error("unsafe_private_root_mode");
  return root;
}

function resolveApprovedOutput(root: string, name: string): string {
  if (!APPROVED_OUTPUT_NAMES.has(name)) throw new Error("unsafe_output_name");
  const outputPath = resolve(root, name);
  if (dirname(outputPath) !== root) throw new Error("unsafe_output_path");
  return outputPath;
}

async function assertSafeOutputTarget(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("unsafe_output_symlink");
    if (!stats.isFile()) throw new Error("unsafe_output_target");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function prepareAtomicOutput(targetPath: string, contents: string): Promise<PreparedOutput> {
  const tempPath = resolve(
    dirname(targetPath),
    `.${targetPath.split("/").at(-1)}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`,
  );
  if (dirname(tempPath) !== dirname(targetPath)) throw new Error("unsafe_temp_path");
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    if (modeBits((await lstat(tempPath)).mode) !== 0o600) throw new Error("unsafe_temp_mode");
    return { targetPath, tempPath };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(root: string): Promise<void> {
  const handle = await open(root, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function commitPreparedOutputs(root: string, prepared: readonly PreparedOutput[]): Promise<void> {
  try {
    for (const output of prepared) await rename(output.tempPath, output.targetPath);
    await syncDirectory(root);
    for (const output of prepared) {
      const stats = await lstat(output.targetPath);
      if (stats.isSymbolicLink() || !stats.isFile() || modeBits(stats.mode) !== 0o600) {
        throw new Error("unsafe_final_output");
      }
    }
  } finally {
    await Promise.all(prepared.map((output) => unlink(output.tempPath).catch(() => undefined)));
  }
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function buildSummary(
  input: SystemOneStagingBuilderInput,
  snapshot: SystemOneStagingReadModel,
): Record<string, unknown> {
  const exceptionCounts = countBy(snapshot.scopeExceptions.map((item) => item.exceptionType));
  const currentRowCounts = countBy(snapshot.currentRowResolutions.map((item) => item.state));
  const currentRowsTotal = snapshot.currentRowResolutions.length;
  return {
    schemaVersion: snapshot.metadata.schemaVersion,
    sourceArtifacts: snapshot.metadata.sourceArtifacts.map((artifact) => ({
      sourceKind: artifact.sourceKind,
      parserVersion: artifact.parserVersion,
      embeddedVersion: artifact.embeddedVersion,
      sha256: artifact.sha256,
    })),
    snapshotHash: snapshot.metadata.snapshotHash,
    candidatePairSetHash: snapshot.metadata.candidatePairSetHash,
    verifiedTranscriptAssetLowerBound: snapshot.metadata.verifiedTranscriptAssetLowerBound,
    verifiedTranscriptAssetUpperBound: snapshot.metadata.verifiedTranscriptAssetUpperBound,
    irreducibleTranscriptScopeGap: snapshot.metadata.irreducibleTranscriptScopeGap,
    status: snapshot.metadata.status,
    canonicalVerifiedTranscriptCount: snapshot.canonicalAssets.filter((asset) => (
      asset.assetClass === "verified_transcript_candidate"
      && asset.provenanceState === "verified"
      && asset.structuralValidationState === "passed"
      && asset.eligibilityState === "eligible"
    )).length,
    reconstructedMnnCandidateCount: snapshot.candidateAssociations.length,
    exceptionCounts,
    currentRowCounts,
    currentRowsTotal,
    currentRowsAmbiguousCandidateAudit: 0,
    invariants: {
      transcriptScopeGapMatchesBounds: snapshot.metadata.irreducibleTranscriptScopeGap
        === snapshot.metadata.verifiedTranscriptAssetUpperBound
          - snapshot.metadata.verifiedTranscriptAssetLowerBound,
      currentRowsFullyAccounted: Object.values(currentRowCounts).reduce((sum, count) => sum + count, 0)
        === currentRowsTotal,
      candidatePairSetHashMatchesStatus: snapshot.metadata.candidatePairSetHash
        === snapshot.metadata.status.candidatePairSetHash,
      expectedCurrentRowsTotal: input.assertions.expectedCurrentRowsTotal === currentRowsTotal,
    },
    safetyAssertions: {
      approvedInputAllowlistOnly: true,
      privateOutputRootOnly: true,
      atomicSameDirectoryWrites: true,
      restrictivePermissions: true,
      candidatePromotionAllowed: false,
      networkUsed: false,
      driveUsed: false,
      postgresUsed: false,
      providerUsed: false,
    },
  };
}

export async function runSystemOneStagingReadModel(
  options: SystemOneStagingRunnerOptions,
  contracts: readonly SystemOneArtifactContract[] = SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS,
): Promise<SystemOneStagingRunnerResult> {
  if (String(options.snapshotOutputName) === String(options.summaryOutputName)) throw new Error("unsafe_output_name");
  const root = await assertPrivateRoot(options.privateRoot);
  const snapshotPath = resolveApprovedOutput(root, options.snapshotOutputName);
  const summaryPath = resolveApprovedOutput(root, options.summaryOutputName);
  await assertSafeOutputTarget(snapshotPath);
  await assertSafeOutputTarget(summaryPath);

  const artifacts = await loadSystemOneStagingArtifacts(root, contracts);
  const input = adaptSystemOneStagingArtifacts(artifacts, options.builtAt, contracts);
  const snapshot = buildSystemOneStagingReadModel(input);
  const summary = buildSummary(input, snapshot);
  const prepared: PreparedOutput[] = [];
  try {
    prepared.push(await prepareAtomicOutput(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`));
    prepared.push(await prepareAtomicOutput(summaryPath, `${JSON.stringify(summary, null, 2)}\n`));
    await commitPreparedOutputs(root, prepared);
  } catch (error) {
    await Promise.all(prepared.map((output) => unlink(output.tempPath).catch(() => undefined)));
    throw error;
  }
  return {
    snapshotPath,
    summaryPath,
    snapshotHash: snapshot.metadata.snapshotHash,
    candidatePairSetHash: snapshot.metadata.candidatePairSetHash,
  };
}

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const privateRoot = resolve(scriptDirectory, "../private/system-one");
  const result = await runSystemOneStagingReadModel({
    privateRoot,
    builtAt: new Date().toISOString(),
    snapshotOutputName: SNAPSHOT_OUTPUT_NAME,
    summaryOutputName: SUMMARY_OUTPUT_NAME,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
