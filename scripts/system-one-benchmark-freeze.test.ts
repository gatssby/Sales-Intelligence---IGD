import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS,
  BENCHMARK_DECISION_IDS,
  BENCHMARK_DECISIONS,
  BENCHMARK_INDETERMINACY_GAP,
  BENCHMARK_MAX_COHORT_SIZE,
  BENCHMARK_MIN_COHORT_SIZE,
  assertBenchmarkProtocolFreeze,
  benchmarkDecisionOrdinal,
  benchmarkDecisionValidValues,
  createBenchmarkGroundTruthTemplate,
  createBenchmarkProtocol,
  evaluateBenchmarkRun,
  validateBenchmarkGroundTruthEntry,
  type BenchmarkGroundTruthRecord,
  type BenchmarkPredictionRecord,
} from "@igd/decision-engine";
import {
  allocateRemainderSlots,
  benchmarkSelectionRank,
  selectBenchmarkCohort,
  type BenchmarkSnapshotInput,
} from "./lib/system-one-benchmark-cohort.js";
import { buildBenchmarkUniverse } from "./lib/system-one-benchmark-universe.js";
import { assertInventoryMatchesSnapshot, buildBenchmarkFreeze, sha256Hex } from "./lib/system-one-benchmark-freeze.js";
import { computeCandidatePairSetHash } from "@igd/core/system-one-staging-read-model";

const SNAPSHOT_HASH = "a".repeat(64);
const CANDIDATE_HASH = "b".repeat(64);
const RULE_ID = "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const;
const RULE_VERSION = "identity-rule-validation-v04:C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const;

function opaque(seed: string): string {
  return createHash("sha256").update(`fixture:${seed}`).digest("hex").slice(0, 24);
}

function candidatePair(left: string, right: string): { leftOpaqueAssetId: string; rightOpaqueAssetId: string; ruleId: typeof RULE_ID; ruleVersion: typeof RULE_VERSION } {
  return { leftOpaqueAssetId: opaque(left), rightOpaqueAssetId: opaque(right), ruleId: RULE_ID, ruleVersion: RULE_VERSION };
}

/** `computeCandidatePairSetHash` requires the branded opaque-id type; the fixture only carries the wire shape. */
function candidatePairSetHash(pairs: readonly { leftOpaqueAssetId: string; rightOpaqueAssetId: string }[]): string {
  return computeCandidatePairSetHash(pairs.map((pair) => ({
    leftOpaqueAssetId: pair.leftOpaqueAssetId as Parameters<typeof computeCandidatePairSetHash>[0][number]["leftOpaqueAssetId"],
    rightOpaqueAssetId: pair.rightOpaqueAssetId as Parameters<typeof computeCandidatePairSetHash>[0][number]["rightOpaqueAssetId"],
    ruleId: RULE_ID,
    ruleVersion: RULE_VERSION,
  })));
}

/** Shape of one decision section of the frozen metrics report, for assertions. */
type DecisionReport = {
  outputType: string;
  pendingReason?: string;
  adjudication: { unlabeled: number; labeled: number; needsReview: number; ambiguous: number; insufficientEvidence: number };
  operational: { costStatus: string; costUsd: number | null; abstentionRate: number | null };
  quality: Record<string, number | string | null>;
};

function decisionReport(report: unknown, decisionId: string): DecisionReport {
  const byDecision = (report as { byDecision: Record<string, DecisionReport> }).byDecision;
  const entry = byDecision[decisionId];
  if (!entry) throw new Error(`fixture_report_missing_decision:${decisionId}`);
  return entry;
}

/** Synthetic 24-call universe: two years, three length buckets, varied structure. */
function buildFixture() {
  const createdTimes = [2025, 2025, 2025, 2025, 2025, 2025, 2025, 2025, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2026, 2025, 2025, 2026, 2026];
  const characterCounts = [400, 900, 1500, 3200, 9000, 12000, 26000, 30000, 700, 1800, 4200, 9000, 15000, 25000, 31000, 800, 2600, 6100, 11000, 22000, 500, 5000, 13000, 27000];
  const uniqueSpeakerCounts = [2, 2, 3, 5, 2, 4, 6, 2, 2, 3, 5, 2, 4, 6, 2, 3, 2, 5, 4, 2, 2, 3, 6, 4];
  const speakerTurnCounts = [3, 8, 24, 60, 12, 30, 90, 4, 5, 18, 44, 9, 26, 70, 7, 16, 3, 33, 21, 6, 4, 12, 55, 28];
  const cueCounts = [0, 4, 12, 30, 6, 14, 40, 2, 0, 5, 18, 3, 11, 22, 1, 7, 0, 15, 9, 2, 1, 13, 26, 8];

  const canonicalAssets = createdTimes.map((_year, index) => ({
    canonicalLogicalCallKey: opaque(`call-${index}`),
    opaqueAssetId: opaque(`asset-${index}`),
    scopeState: "known_canonical",
    eligibilityState: "eligible",
    provenanceState: "verified",
    structuralValidationState: "passed",
    recordId: `canonical-asset:fixture:${opaque(`asset-${index}`)}`,
  }));
  const canonicalLogicalCalls = canonicalAssets.map((asset) => ({
    canonicalLogicalCallKey: asset.canonicalLogicalCallKey,
    canonicalAssetRecordIds: [asset.recordId],
    selectedVerifiedTranscriptRecordId: asset.recordId,
  }));

  // Two calls are implicated in a transcript/recording candidate association.
  const pairs = [candidatePair("asset-3", "recording-3"), candidatePair("asset-19", "recording-19")];
  const snapshot = {
    metadata: {
      snapshotHash: SNAPSHOT_HASH,
      candidatePairSetHash: candidatePairSetHash(pairs),
      verifiedTranscriptAssetLowerBound: canonicalAssets.length,
      verifiedTranscriptAssetUpperBound: canonicalAssets.length + 2,
      irreducibleTranscriptScopeGap: 2,
      status: { transcriptScopeExactlyValidated: false, transcriptScopeBounded: true, globalScopeValidated: false },
    },
    canonicalAssets,
    canonicalLogicalCalls,
    currentRowResolutions: [],
    candidateAssociations: pairs,
    scopeExceptions: [{ exceptionType: "transcript_scope_unknown", resolutionState: "unresolved" }],
  } satisfies BenchmarkSnapshotInput;

  const inventoryRows = createdTimes.map((year, index) => ({
    opaque_asset_id: opaque(`asset-${index}`),
    created_year: year,
    source_kind: index % 3 === 0 ? "explicit_transcript_name" : "google_meet_caption_file",
    structural_check_status: "passed",
    metadata: {
      structural_metrics: {
        characterCount: characterCounts[index]!,
        nonemptyLineCount: 10 + index,
        speakerTurnCount: speakerTurnCounts[index]!,
        timestampCueCount: cueCounts[index]!,
        uniqueSpeakerCount: uniqueSpeakerCounts[index]!,
      },
    },
  }));

  return {
    snapshot,
    inventoryRows,
    inventorySha256: sha256Hex(JSON.stringify(inventoryRows)),
    sourceArtifacts: [
      { artifactName: "system-one-staging-read-model-v01.json", sha256: SNAPSHOT_HASH },
      { artifactName: "drive-source-inventory-expanded-v02.jsonl", sha256: sha256Hex(JSON.stringify(inventoryRows)) },
    ],
  };
}

function freezeFixture() {
  const fixture = buildFixture();
  return buildBenchmarkFreeze({
    snapshot: { ...fixture.snapshot, sourceArtifacts: fixture.sourceArtifacts },
    inventoryRows: fixture.inventoryRows,
    inventorySha256: fixture.inventorySha256,
  });
}

test("cohort selection is deterministic, metadata-only and independent of input ordering", () => {
  const fixture = buildFixture();
  const universe = buildBenchmarkUniverse({
    snapshotCanonicalAssets: fixture.snapshot.canonicalAssets,
    canonicalLogicalCalls: fixture.snapshot.canonicalLogicalCalls,
    inventoryRows: fixture.inventoryRows,
  });
  const first = selectBenchmarkCohort({ snapshot: fixture.snapshot, universe, cohortSize: 12 });
  const shuffled = selectBenchmarkCohort({
    snapshot: fixture.snapshot,
    universe: [...universe].reverse(),
    cohortSize: 12,
  });
  assert.equal(first.cohortSize, 12);
  assert.equal(first.cohortHash, shuffled.cohortHash);
  assert.deepEqual(first.entries.map((entry) => entry.canonicalLogicalCallKey), shuffled.entries.map((entry) => entry.canonicalLogicalCallKey));
  assert.ok(first.cohortSize >= BENCHMARK_MIN_COHORT_SIZE && first.cohortSize <= BENCHMARK_MAX_COHORT_SIZE);
  assert.ok(first.diversitySummary.distinctRecordingYear >= 2);
  assert.equal(first.diversitySummary.distinctCharacterBucket, 3);
  assert.deepEqual(first.forbiddenStateCheck, {
    candidateAssociationPromoted: 0, unresolvedPromoted: 0, transcriptScopeUnknownPromoted: 0, upperBoundOnlyAssetPromoted: 0, inferredCanonicalityPromoted: 0,
  });
  // The two candidate-implicated calls are never promoted.
  const implicated = new Set(fixture.snapshot.candidateAssociations.flatMap((pair) => [pair.leftOpaqueAssetId, pair.rightOpaqueAssetId]));
  assert.equal(first.entries.some((entry) => implicated.has(entry.opaqueAssetId)), false);
});

test("cohort selection refuses candidate associations, scope-unknown exceptions and a pool smaller than the cohort", () => {
  const fixture = buildFixture();
  const universe = buildBenchmarkUniverse({
    snapshotCanonicalAssets: fixture.snapshot.canonicalAssets,
    canonicalLogicalCalls: fixture.snapshot.canonicalLogicalCalls,
    inventoryRows: fixture.inventoryRows,
  });
  assert.throws(
    () => selectBenchmarkCohort({
      snapshot: { ...fixture.snapshot, scopeExceptions: [{ exceptionType: "transcript_scope_unknown", resolutionState: "fail_closed" }] },
      universe,
      cohortSize: 12,
    }),
    /benchmark_cohort_forbidden_state_present/,
  );
  assert.throws(
    () => selectBenchmarkCohort({
      snapshot: { ...fixture.snapshot, metadata: { ...fixture.snapshot.metadata, candidatePairSetHash: CANDIDATE_HASH } },
      universe,
      cohortSize: 12,
    }),
    /benchmark_candidate_pair_set_hash_mismatch/,
  );
  assert.throws(
    () => selectBenchmarkCohort({ snapshot: fixture.snapshot, universe: universe.slice(0, 5), cohortSize: 12 }),
    /benchmark_universe_size_mismatch/,
  );
});

test("selection rank is a hash of the ranking version plus the canonical key, never a position", () => {
  const key = opaque("call-7");
  assert.equal(benchmarkSelectionRank("v01", key), benchmarkSelectionRank("v01", key));
  assert.notEqual(benchmarkSelectionRank("v01", key), benchmarkSelectionRank("v02", key));
  assert.notEqual(benchmarkSelectionRank("v01", key), benchmarkSelectionRank("v01", opaque("call-8")));
  assert.match(benchmarkSelectionRank("v01", key), /^[0-9a-f]{64}$/);
});

test("largest-remainder allocation never exceeds a stratum pool and sums to the remaining slots", () => {
  const slots = allocateRemainderSlots([409, 390, 121, 39], 12 - 4);
  assert.equal(slots.reduce((sum, value) => sum + value, 0), 8);
  assert.deepEqual(allocateRemainderSlots([1, 1], 0), [0, 0]);
  assert.throws(() => allocateRemainderSlots([1, 1], -1), /benchmark_remainder_invalid/);
});

test("freeze artifact carries sanitized metadata only and a blank 12 x 10 ground-truth universe", () => {
  const artifacts = freezeFixture();
  assert.equal(artifacts.cohort.cohortSize, 12);
  assert.equal(artifacts.groundTruth.length, 12 * BENCHMARK_DECISION_IDS.length);
  assert.equal(artifacts.groundTruth.length, 120);
  assert.equal(artifacts.cohort.labelsFilled, 0);
  assert.ok(artifacts.groundTruth.every((entry) => entry.label === null));
  assert.ok(artifacts.groundTruth.every((entry) => entry.adjudicationStatus === "unlabeled"));
  assert.ok(artifacts.groundTruth.every((entry) => entry.annotatorConfidence === null && entry.rationale === null && entry.evidence.length === 0));
  assert.equal(artifacts.cohort.selectedCanonicalLogicalCallKeys.length, 12);
  assert.equal(new Set(artifacts.cohort.selectedCanonicalLogicalCallKeys).size, 12);
  assert.ok(artifacts.cohort.selectedCanonicalLogicalCallKeys.every((key) => /^[0-9a-f]{24}$/.test(key)));
  assert.equal(artifacts.cohort.canonicalTranscriptResolverStatus, "MISSING");
  // Nothing beyond the declared resolver-gap note may mention transcript content or raw identifiers.
  const { canonicalTranscriptResolverGap: _gap, privacy: _privacy, ...metadataOnly } = artifacts.cohort;
  const serialized = JSON.stringify(metadataOnly);
  assert.doesNotMatch(serialized, /transcript_body|transcript body|normalized_text|@|\.txt|drive\.google|\.sbv|\.vtt/i);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  // Every decision appears exactly once per call, in frozen ordinal order.
  const perCall = new Map<string, string[]>();
  for (const entry of artifacts.groundTruth) perCall.set(entry.canonicalLogicalCallKey, [...(perCall.get(entry.canonicalLogicalCallKey) ?? []), entry.decisionId]);
  for (const decisions of perCall.values()) assert.deepEqual(decisions, [...BENCHMARK_DECISION_IDS]);
});

test("ground-truth template rejects a version mismatch, a duplicate cohort and any pre-filled label", () => {
  assert.throws(() => createBenchmarkGroundTruthTemplate({
    freeze: { benchmarkVersion: "other", protocolVersion: "p", cohortVersion: "c", decisionSchemaVersion: "s", sourceSnapshotHash: SNAPSHOT_HASH },
    canonicalLogicalCallKeys: [opaque("call-1")],
  }), /benchmark_version_mismatch/);
  const template = createBenchmarkGroundTruthTemplate({
    freeze: { benchmarkVersion: "system-one-benchmark-v01", protocolVersion: "p", cohortVersion: "c", decisionSchemaVersion: "s", sourceSnapshotHash: SNAPSHOT_HASH },
    canonicalLogicalCallKeys: [opaque("call-1")],
  });
  const labeled = { ...template[0]!, label: true, adjudicationStatus: "labeled" as const };
  validateBenchmarkGroundTruthEntry(labeled);
  assert.throws(() => validateBenchmarkGroundTruthEntry({ ...labeled, label: "yes" }), /benchmark_ground_truth_label_invalid/);
  assert.throws(() => validateBenchmarkGroundTruthEntry({ ...template[0]!, adjudicationStatus: "unlabeled", label: "price" }), /benchmark_ground_truth_unlabeled_with_label/);
  assert.throws(() => validateBenchmarkGroundTruthEntry({ ...template[0]!, decisionOrdinal: 4 }), /benchmark_ground_truth_ordinal_mismatch/);
  assert.throws(() => validateBenchmarkGroundTruthEntry({ ...template[0]!, canonicalLogicalCallKey: "not-opaque" }), /benchmark_ground_truth_call_key_invalid/);
});

test("protocol freeze records the ten decisions, the resolver gap and a pending quality state", () => {
  const freeze = createBenchmarkProtocol({
    sourceSnapshotHash: SNAPSHOT_HASH,
    sourceCandidatePairSetHash: CANDIDATE_HASH,
    canonicalLogicalCallCount: 1014,
    cohortSize: 12,
  });
  assertBenchmarkProtocolFreeze(freeze);
  assert.equal(freeze.benchmarkVersion, "system-one-benchmark-v01");
  assert.equal(freeze.cohortSize, 12);
  assert.equal(freeze.canonicalLogicalCallCount, 1014);
  assert.equal(freeze.metricsStatusWithoutLabels, "pending");
  assert.equal(freeze.canonicalTranscriptResolverStatus, BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS);
  assert.equal(freeze.canonicalTranscriptResolverStatus, "MISSING");
  assert.match(freeze.canonicalTranscriptResolverGap, /public\.calls/);
  assert.deepEqual(freeze.providerInvocation.map((invocation) => invocation.engine), ["jev", "laya"]);
  assert.throws(
    () => createBenchmarkProtocol({ sourceSnapshotHash: SNAPSHOT_HASH, sourceCandidatePairSetHash: CANDIDATE_HASH, canonicalLogicalCallCount: 1014, cohortSize: 4 }),
    /benchmark_cohort_size_invalid/,
  );
  assert.throws(
    () => createBenchmarkProtocol({ sourceSnapshotHash: "nope", sourceCandidatePairSetHash: CANDIDATE_HASH, canonicalLogicalCallCount: 1014, cohortSize: 12 }),
    /benchmark_snapshot_hash_invalid/,
  );
});

test("decision contracts are complete, ordinally frozen and declare the production indeterminacy gap", () => {
  assert.equal(BENCHMARK_DECISIONS.length, 10);
  for (const [index, decision] of BENCHMARK_DECISIONS.entries()) {
    assert.equal(benchmarkDecisionOrdinal(decision.decisionId), index + 1);
    assert.ok(decision.operationalDefinition.trim().length > 0);
    assert.ok(decision.positiveCriteria.length > 0);
    assert.ok(decision.negativeCriteria.length > 0);
    assert.ok(decision.indeterminateRule.trim().length > 0);
    assert.ok(decision.minimumEvidence.trim().length > 0);
    assert.ok(decision.chunkAggregationRule.trim().length > 0);
    assert.deepEqual(BENCHMARK_DECISION_IDS[index], decision.decisionId);
  }
  assert.deepEqual(benchmarkDecisionValidValues(BENCHMARK_DECISIONS[3]!), ["none", "price", "timing", "authority", "trust", "fit", "other", "ambiguous"]);
  assert.deepEqual(benchmarkDecisionValidValues(BENCHMARK_DECISIONS[9]!), ["1", "2", "3", "4", "5"]);
  assert.equal(BENCHMARK_INDETERMINACY_GAP.productionDomainHasIndeterminate, false);
  assert.equal(BENCHMARK_INDETERMINACY_GAP.productionDomainChangedThisRound, false);
  assert.throws(() => benchmarkDecisionOrdinal("unknown_decision"), /benchmark_decision_ordinal_unknown/);
});

test("inventory hash must match the hash the snapshot declares", () => {
  const fixture = buildFixture();
  assertInventoryMatchesSnapshot({
    snapshot: { ...fixture.snapshot, sourceArtifacts: fixture.sourceArtifacts },
    inventorySha256: fixture.inventorySha256,
  });
  assert.throws(
    () => assertInventoryMatchesSnapshot({
      snapshot: { ...fixture.snapshot, sourceArtifacts: fixture.sourceArtifacts },
      inventorySha256: "c".repeat(64),
    }),
    /benchmark_inventory_hash_mismatch/,
  );
  assert.throws(
    () => assertInventoryMatchesSnapshot({ snapshot: { ...fixture.snapshot, sourceArtifacts: [] }, inventorySha256: fixture.inventorySha256 }),
    /benchmark_inventory_hash_undeclared/,
  );
});

test("the freeze runner and cohort selector have no provider, Drive, database, or network path", async () => {
  const source = (await Promise.all([
    readFile(new URL("./lib/system-one-benchmark-cohort.ts", import.meta.url), "utf8"),
    readFile(new URL("./lib/system-one-benchmark-universe.ts", import.meta.url), "utf8"),
    readFile(new URL("./lib/system-one-benchmark-freeze.ts", import.meta.url), "utf8"),
    readFile(new URL("./system-one-benchmark-freeze.ts", import.meta.url), "utf8"),
  ])).join("\n");
  for (const forbidden of [
    /from\s+["']openai["']/i,
    /@google\/generative-ai/i,
    /@ai-sdk\//i,
    /from\s+["']postgres["']/i,
    /from\s+["']googleapis["']/i,
    /JevDecisionEngine|LayaDecisionEngine|api\.openai\.com|generativelanguage\.googleapis\.com|ai-gateway\.vercel\.sh/i,
    /\bfetch\s*\(/i,
    /["'`]\s*(?:insert|update|delete|alter|drop|truncate|create\s+table)\s+/i,
    /files\.(?:create|update|delete)/i,
    /transcripts\.normalized_text|from\s+public\.calls|HUMAN_REVIEW_TRANSCRIPT_SQL/i,
  ]) assert.doesNotMatch(source, forbidden);
  // The selector must never consult a position or the pilot UUID path.
  assert.doesNotMatch(source, /pilot-30|UUID_PATTERN/);
});

test("metrics stay pending without labels and report cost as unavailable instead of inventing it", () => {
  const artifacts = freezeFixture();
  const keys = artifacts.cohort.selectedCanonicalLogicalCallKeys;
  const predictions: BenchmarkPredictionRecord[] = keys.flatMap((key) => BENCHMARK_DECISION_IDS.map((decisionId) => ({
    canonicalLogicalCallKey: key,
    decisionId,
    value: decisionId === "buyer_intent" ? 4 : decisionId === "objection_type" ? "none" : true,
    confidence: 0.9,
    outputParsed: true,
    retries: 0,
    errorCode: null,
    latencyMs: 1200,
    costUsd: null,
  })));
  const report = evaluateBenchmarkRun({
    engine: "laya",
    engineModel: "synthetic",
    engineModelVersion: "synthetic-1",
    predictions,
    groundTruth: artifacts.groundTruth.map((entry) => ({ canonicalLogicalCallKey: entry.canonicalLogicalCallKey, decisionId: entry.decisionId, label: entry.label, adjudicationStatus: entry.adjudicationStatus })),
    startedAtMs: 0,
    finishedAtMs: 60_000,
  });
  assert.equal(report.qualityStatus, "pending");
  assert.equal(report.pendingDecisions.length, 10);
  assert.equal(report.operational.costStatus, "unavailable");
  assert.equal(report.operational.costUsd, null);
  assert.equal(decisionReport(report, "pain_identified").pendingReason, "no_human_label_available");
  assert.equal(decisionReport(report, "pain_identified").adjudication.unlabeled, 12);
  assert.equal(report.winnerDeclared, false);
  assert.equal(report.confidenceCalibrated, false);

  // With synthetic labels the same report scores, and ambiguous/insufficient units stay out.
  const labeled: BenchmarkGroundTruthRecord[] = artifacts.groundTruth.map((entry, index) => {
    if (index % 13 === 0) return { canonicalLogicalCallKey: entry.canonicalLogicalCallKey, decisionId: entry.decisionId, label: null, adjudicationStatus: "insufficient_evidence" };
    return {
      canonicalLogicalCallKey: entry.canonicalLogicalCallKey,
      decisionId: entry.decisionId,
      label: entry.decisionId === "buyer_intent" ? 4 : entry.decisionId === "objection_type" ? "none" : true,
      adjudicationStatus: "labeled",
    };
  });
  const scored = evaluateBenchmarkRun({
    engine: "jev",
    engineModel: "synthetic",
    engineModelVersion: "synthetic-1",
    predictions,
    groundTruth: labeled,
    startedAtMs: 0,
    finishedAtMs: 30_000,
  });
  assert.equal(scored.qualityStatus, "scored");
  assert.notEqual(decisionReport(scored, "pain_identified").quality.accuracy, null);
  assert.notEqual(decisionReport(scored, "buyer_intent").quality.mae, null);
  assert.equal(decisionReport(scored, "cta_present").quality.falsePositives, 0);
  assert.notEqual(decisionReport(scored, "objection_type").quality.macroF1, null);
  assert.ok(decisionReport(scored, "pain_identified").adjudication.insufficientEvidence > 0);
});