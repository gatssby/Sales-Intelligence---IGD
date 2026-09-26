import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySystemOneSource,
  reconstructSystemOneLogicalCalls,
  type SystemOneSourceAsset,
} from "../src/system-one-provenance.js";

const transcriptText = [
  "0:00:00.000,0:00:04.000",
  "Closer: Olá, obrigado por reservar este tempo.",
  "0:00:04.000,0:00:08.000",
  "Lead: Obrigado, quero entender como funciona.",
  "0:00:08.000,0:00:12.000",
  "Closer: Primeiro quero entender o seu cenário atual.",
  "0:00:12.000,0:00:16.000",
  "Lead: Hoje o principal problema é a previsibilidade.",
].join("\n");

const asset = (overrides: Partial<SystemOneSourceAsset> = {}): SystemOneSourceAsset => ({
  assetId: "asset-a",
  sourceKind: "google_drive",
  name: "Reunião semanal 2026-09-25.sbv",
  mimeType: "text/plain",
  parentIds: ["folder-a"],
  ancestorIds: ["root-a", "folder-a"],
  createdTime: "2026-09-25T15:30:00.000Z",
  modifiedTime: "2026-09-25T15:31:00.000Z",
  fullFileExtension: "sbv",
  originalFilename: "Reunião semanal 2026-09-25.sbv",
  shortcutTargetId: null,
  description: null,
  propertyKeys: [],
  appPropertyKeys: [],
  contentText: transcriptText,
  ...overrides,
});

test("Gemini Notes are never eligible even when their exported text looks like a transcript", () => {
  const result = classifySystemOneSource(asset({
    name: "Reunião semanal 2026-09-25 - Anotações do Gemini",
    mimeType: "application/vnd.google-apps.document",
    fullFileExtension: null,
    originalFilename: null,
  }));
  assert.equal(result.assetClass, "ai_notes");
  assert.equal(result.structuralCheckStatus, "not_applicable");
  assert.equal(result.eligibleForAnalysis, false);
});

test("Gemini Notes signal in original filename is never eligible", () => {
  const result = classifySystemOneSource(asset({
    name: "documento-sem-rotulo",
    originalFilename: "Reunião semanal - Anotações do Gemini",
    mimeType: "application/vnd.google-apps.document",
    fullFileExtension: null,
  }));
  assert.equal(result.assetClass, "ai_notes");
  assert.equal(result.eligibleForAnalysis, false);
});

test("a Google Meet SBV caption asset with valid conversation structure is eligible", () => {
  const result = classifySystemOneSource(asset());
  assert.equal(result.assetClass, "verified_transcript_candidate");
  assert.equal(result.transcriptProvenance, "google_meet_caption_file");
  assert.equal(result.structuralCheckStatus, "passed");
  assert.equal(result.eligibleForAnalysis, true);
});

test("a WebVTT voice-cue transcript with valid conversation structure is eligible", () => {
  const result = classifySystemOneSource(asset({
    name: "Reunião semanal 2026-09-25.vtt",
    mimeType: "text/vtt",
    fullFileExtension: "vtt",
    originalFilename: "Reunião semanal 2026-09-25.vtt",
    contentText: [
      "00:00:00.000 --> 00:00:04.000",
      "<v Closer>Olá, obrigado por reservar este tempo.",
      "00:00:04.000 --> 00:00:08.000",
      "<v Lead>Obrigado, quero entender como funciona.",
    ].join("\n"),
  }));
  assert.equal(result.structuralCheckStatus, "passed");
  assert.equal(result.eligibleForAnalysis, true);
});

test("an explicitly named transcript document can be eligible after structural validation", () => {
  const result = classifySystemOneSource(asset({
    name: "Reunião semanal 2026-09-25 - Transcript",
    mimeType: "application/vnd.google-apps.document",
    fullFileExtension: null,
    originalFilename: null,
  }));
  assert.equal(result.assetClass, "verified_transcript_candidate");
  assert.equal(result.transcriptProvenance, "explicit_transcript_name");
  assert.equal(result.eligibleForAnalysis, true);
});

test("an explicitly named dense multi-speaker transcript can pass without timestamp cues", () => {
  const result = classifySystemOneSource(asset({
    name: "Reunião semanal 2026-09-25 - Transcript",
    mimeType: "application/vnd.google-apps.document",
    fullFileExtension: null,
    originalFilename: null,
    contentText: Array.from({ length: 20 }, (_, index) => index % 2 === 0
      ? `Closer: Turno ${index + 1}, quero compreender em detalhe o cenário, o impacto operacional e os critérios usados para decidir.`
      : `Lead: Turno ${index + 1}, o problema reduz a previsibilidade, atrasa decisões e exige muito trabalho manual da equipe.`).join("\n"),
  }));
  assert.equal(result.structuralCheckStatus, "passed");
  assert.equal(result.eligibleForAnalysis, true);
});

test("transcript plus notes plus recording reconstructs one logical call and selects only the transcript", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([
    asset(),
    asset({
      assetId: "notes",
      name: "Reunião semanal 2026-09-25 - Anotações do Gemini",
      mimeType: "application/vnd.google-apps.document",
      fullFileExtension: null,
      originalFilename: null,
    }),
    asset({
      assetId: "recording",
      name: "Reunião semanal 2026-09-25 - Recording.mp4",
      mimeType: "video/mp4",
      fullFileExtension: "mp4",
      originalFilename: "Reunião semanal 2026-09-25 - Recording.mp4",
      contentText: null,
    }),
  ]);
  assert.equal(reconstructed.logicalCalls.length, 1);
  assert.equal(reconstructed.logicalCalls[0].eligibleForAnalysis, true);
  assert.equal(reconstructed.logicalCalls[0].selectedAssetId, "asset-a");
  assert.deepEqual(reconstructed.logicalCalls[0].assetIds, ["asset-a", "notes", "recording"]);
});

test("recording-only logical calls are ineligible", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([asset({
    assetId: "recording",
    name: "Reunião semanal 2026-09-25 - Recording.mp4",
    mimeType: "video/mp4",
    fullFileExtension: "mp4",
    originalFilename: "Reunião semanal 2026-09-25 - Recording.mp4",
    contentText: null,
  })]);
  assert.equal(reconstructed.logicalCalls[0].eligibleForAnalysis, false);
  assert.equal(reconstructed.logicalCalls[0].exclusionReason, "recording_only");
});

test("unknown assets are ineligible and conversation structure alone cannot promote them", () => {
  const result = classifySystemOneSource(asset({
    name: "Documento sem provenance",
    mimeType: "application/vnd.google-apps.document",
    fullFileExtension: null,
    originalFilename: null,
  }));
  assert.equal(result.assetClass, "unknown");
  assert.equal(result.structuralCheckStatus, "not_checked");
  assert.equal(result.eligibleForAnalysis, false);
});

test("invalid transcript structure fails closed", () => {
  const result = classifySystemOneSource(asset({ contentText: "Closer: olá" }));
  assert.equal(result.assetClass, "verified_transcript_candidate");
  assert.equal(result.structuralCheckStatus, "failed");
  assert.equal(result.eligibleForAnalysis, false);
  assert.equal(result.exclusionReason, "transcript_structure_invalid");
});

test("logical dedupe is deterministic across input order and repeated execution", () => {
  const assets = [
    asset({ assetId: "transcript-b" }),
    asset({
      assetId: "notes",
      name: "Reunião semanal 2026-09-25 - Anotações do Gemini",
      mimeType: "application/vnd.google-apps.document",
      fullFileExtension: null,
      originalFilename: null,
    }),
  ];
  const first = reconstructSystemOneLogicalCalls(assets);
  const second = reconstructSystemOneLogicalCalls([...assets].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first, reconstructSystemOneLogicalCalls(assets));
});

test("multiple valid transcript assets for one logical call fail closed as ambiguous", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([
    asset({ assetId: "transcript-a" }),
    asset({ assetId: "transcript-b" }),
  ]);
  assert.equal(reconstructed.logicalCalls.length, 1);
  assert.equal(reconstructed.logicalCalls[0].eligibleForAnalysis, false);
  assert.equal(reconstructed.logicalCalls[0].selectedAssetId, null);
  assert.equal(reconstructed.logicalCalls[0].exclusionReason, "ambiguous_logical_call");
});

test("an unknown asset sharing a heuristic logical key with a valid transcript fails closed", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([
    asset({ assetId: "transcript-a" }),
    asset({
      assetId: "unknown-a",
      name: "Reunião semanal 2026-09-25",
      mimeType: "application/vnd.google-apps.document",
      fullFileExtension: null,
      originalFilename: null,
    }),
  ]);
  assert.equal(reconstructed.logicalCalls.length, 1);
  assert.equal(reconstructed.logicalCalls[0].eligibleForAnalysis, false);
  assert.equal(reconstructed.logicalCalls[0].selectedAssetId, null);
  assert.equal(reconstructed.logicalCalls[0].exclusionReason, "ambiguous_logical_call");
});

test("same-named assets in one parent but different creation instants are not merged", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([
    asset({ assetId: "first-call" }),
    asset({
      assetId: "second-call",
      createdTime: "2026-09-25T15:40:00.000Z",
      modifiedTime: "2026-09-25T15:41:00.000Z",
    }),
  ]);
  assert.equal(reconstructed.logicalCalls.length, 2);
  assert.equal(reconstructed.logicalCalls.filter((call) => call.eligibleForAnalysis).length, 2);
});

test("same-named assets without a valid creation instant are not merged", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([
    asset({ assetId: "first-call", createdTime: null }),
    asset({ assetId: "second-call", createdTime: "not-a-drive-timestamp" }),
  ]);
  assert.equal(reconstructed.logicalCalls.length, 2);
});

test("assets without one exact parent identity are not merged", () => {
  const reconstructed = reconstructSystemOneLogicalCalls([
    asset({ assetId: "first-call", parentIds: ["folder-a", "folder-b"] }),
    asset({ assetId: "second-call", parentIds: ["folder-a", "folder-c"] }),
  ]);
  assert.equal(reconstructed.logicalCalls.length, 2);
});