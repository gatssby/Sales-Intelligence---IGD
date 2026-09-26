import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySystemOneSource,
  selectEligibleSystemOneCalls,
  type SystemOneSourceAsset,
} from "../src/system-one-provenance.js";

const asset = (overrides: Partial<SystemOneSourceAsset> = {}): SystemOneSourceAsset => ({
  assetId: "asset-a",
  logicalCallId: "call-a",
  sourceKind: "google_drive_document",
  title: null,
  sourceType: null,
  transcriptProvenance: null,
  recordingAssociation: false,
  structuralCheckStatus: "not_checked",
  ...overrides,
});

test("Gemini Notes are never eligible even when structurally transcript-like", () => {
  const result = classifySystemOneSource(asset({
    title: "Anotações do Gemini",
    transcriptProvenance: "explicit_transcript_asset",
    structuralCheckStatus: "conversation_like",
  }));
  assert.equal(result.provenanceClass, "ai_notes");
  assert.equal(result.eligibleForSystemOne, false);
});

test("an explicit transcript with preserved conversation structure is eligible", () => {
  const result = classifySystemOneSource(asset({
    title: "Meeting transcript",
    sourceType: "transcript",
    transcriptProvenance: "explicit_transcript_asset",
    structuralCheckStatus: "conversation_like",
  }));
  assert.equal(result.provenanceClass, "verified_transcript");
  assert.equal(result.eligibleForSystemOne, true);
});

test("unknown provenance and recording-only assets fail closed", () => {
  assert.equal(classifySystemOneSource(asset()).provenanceClass, "unknown");
  assert.equal(classifySystemOneSource(asset()).eligibleForSystemOne, false);
  const recording = classifySystemOneSource(asset({ sourceType: "recording", recordingAssociation: true }));
  assert.equal(recording.provenanceClass, "recording_only");
  assert.equal(recording.eligibleForSystemOne, false);
});

test("a logical call with transcript and Gemini notes selects only the transcript", () => {
  const selected = selectEligibleSystemOneCalls([
    asset({ assetId: "notes", title: "Gemini Notes", structuralCheckStatus: "conversation_like" }),
    asset({ assetId: "transcript", title: "Transcrição", sourceType: "transcript", transcriptProvenance: "explicit_transcript_asset", structuralCheckStatus: "conversation_like" }),
    asset({ assetId: "recording", sourceType: "recording", recordingAssociation: true }),
  ]);
  assert.deepEqual(selected.map((item) => item.selectedAssetId), ["transcript"]);
});

test("selector never returns non-verified assets or assets without provenance", () => {
  const selected = selectEligibleSystemOneCalls([
    asset({ assetId: "notes", title: "AI Notes" }),
    asset({ assetId: "unknown", logicalCallId: "call-b" }),
    asset({ assetId: "recording", logicalCallId: "call-c", sourceType: "recording", recordingAssociation: true }),
  ]);
  assert.deepEqual(selected, []);
});

test("structural evidence cannot promote AI notes or provenance-free text", () => {
  assert.equal(classifySystemOneSource(asset({ title: "Resumo automático", structuralCheckStatus: "conversation_like" })).provenanceClass, "ai_notes");
  assert.equal(classifySystemOneSource(asset({ structuralCheckStatus: "conversation_like" })).provenanceClass, "unknown");
  assert.equal(classifySystemOneSource(asset({ title: "Transcrição", sourceType: "transcript", structuralCheckStatus: "conversation_like" })).provenanceClass, "unknown");
});
