import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateIdentityRuleComparison,
  type IdentityValidationAsset,
} from "./lib/system-one-identity-rule-validation.js";

const asset = (overrides: Partial<IdentityValidationAsset> = {}): IdentityValidationAsset => ({
  opaque_asset_id: "asset",
  opaque_parent_ids: ["parent"],
  opaque_ancestor_ids: ["root", "parent"],
  normalized_basename_hash: "basename",
  opaque_shortcut_target_id: null,
  created_time_ms: 1_000,
  property_fingerprints: [],
  app_property_fingerprints: [],
  asset_class: "verified_transcript_candidate",
  eligible_for_analysis: true,
  ...overrides,
});

const transcript = (id: string, createdTime: number, overrides: Partial<IdentityValidationAsset> = {}): IdentityValidationAsset => asset({
  opaque_asset_id: id,
  created_time_ms: createdTime,
  ...overrides,
});

const recording = (id: string, createdTime: number, overrides: Partial<IdentityValidationAsset> = {}): IdentityValidationAsset => asset({
  opaque_asset_id: id,
  asset_class: "recording",
  eligible_for_analysis: false,
  created_time_ms: createdTime,
  ...overrides,
});

function cPairs(assets: IdentityValidationAsset[]): string[][] {
  return evaluateIdentityRuleComparison(assets).rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR.candidate_pairs
    .map((pair) => [pair.transcript_asset_id, pair.recording_asset_id]);
}

test("true MNN matches one transcript with one recording", () => {
  assert.deepEqual(cPairs([
    transcript("transcript", 1_000),
    recording("recording", 1_010),
  ]), [["transcript", "recording"]]);
});

test("true MNN chooses the unique nearest recording and leaves the other unmatched", () => {
  assert.deepEqual(cPairs([
    transcript("transcript", 1_000),
    recording("near", 1_010),
    recording("far", 2_000),
  ]), [["transcript", "near"]]);
});

test("true MNN chooses only the unique nearest transcript for one recording", () => {
  assert.deepEqual(cPairs([
    transcript("near", 1_000),
    transcript("far", 2_000),
    recording("recording", 1_010),
  ]), [["near", "recording"]]);
});

test("equal nearest distances are ambiguous and never promoted", () => {
  const result = evaluateIdentityRuleComparison([
    transcript("transcript", 1_000),
    recording("left", 900),
    recording("right", 1_100),
  ]).rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR;

  assert.deepEqual(result.candidate_pairs, []);
  assert.equal(result.AMBIGUOUS_GROUPS, 1);
});

test("a competitive group with two temporal clusters emits only within-cluster MNN pairs", () => {
  assert.deepEqual(cPairs([
    transcript("transcript-early", 1_000),
    recording("recording-early", 1_010),
    transcript("transcript-late", 172_800_000),
    recording("recording-late", 172_800_010),
  ]), [
    ["transcript-early", "recording-early"],
    ["transcript-late", "recording-late"],
  ]);
});

test("metadata conflict fails closed even when the pair is mutual nearest", () => {
  const result = evaluateIdentityRuleComparison([
    transcript("transcript", 1_000, { property_fingerprints: ["property-a"] }),
    recording("recording", 1_010, { property_fingerprints: ["property-b"] }),
  ]).rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR;

  assert.deepEqual(result.candidate_pairs, []);
  assert.equal(result.AMBIGUOUS_GROUPS, 1);
});

test("D requires independent metadata and cannot use same parent or ancestor overlap", () => {
  const result = evaluateIdentityRuleComparison([
    transcript("transcript", 1_000, { opaque_ancestor_ids: ["root", "parent"] }),
    recording("recording", 1_010, { opaque_ancestor_ids: ["root", "parent"] }),
  ]);

  assert.deepEqual(result.rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR.candidate_pairs.map((pair) => pair.transcript_asset_id), ["transcript"]);
  assert.deepEqual(result.rules.D_MNN_PLUS_INDEPENDENT_METADATA.candidate_pairs, []);
  assert.equal(result.rules.D_MNN_PLUS_INDEPENDENT_METADATA.CANDIDATE_GROUPS, 0);
});
