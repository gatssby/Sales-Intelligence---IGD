import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGoogleFileId,
  isNoShowStatus,
  ingestCall,
  normalizeHeader,
  normalizeStatus,
  parseHistoricalCallDate,
  resolveCallByTranscriptFileId,
  resolveTranscriptIdentity,
  selectFairRoundRobin,
  upsertCallSource,
} from "../src/index.js";

test("extractGoogleFileId accepts Docs URLs and canonical ids", () => {
  assert.equal(extractGoogleFileId("https://docs.google.com/document/d/1ABC_xyz-987/edit"), "1ABC_xyz-987");
  assert.equal(extractGoogleFileId("https://docs.google.com/open?id=1ABC_xyz-987"), "1ABC_xyz-987");
  assert.equal(extractGoogleFileId("1ABC_xyz-987"), "1ABC_xyz-987");
  assert.equal(extractGoogleFileId("not a docs link"), null);
});

test("normalizeHeader removes accents, case and punctuation differences", () => {
  assert.equal(normalizeHeader("LINK DA TRANSCRIÇãO"), "LINK DA TRANSCRICAO");
  assert.equal(normalizeHeader(" Link  da  Transcrição "), "LINK DA TRANSCRICAO");
});

test("normalizeStatus makes the no-show rule exact after normalization", () => {
  assert.equal(normalizeStatus("não compareceu"), "NAO COMPARECEU");
  assert.equal(isNoShowStatus(" NÃO COMPARECEU "), true);
  assert.equal(isNoShowStatus("NÃO FECHOU"), false);
  assert.equal(isNoShowStatus("EM NEGOCIAÇÃO"), false);
});

test("parseHistoricalCallDate accepts known formats and rejects implausible years", () => {
  assert.equal(parseHistoricalCallDate("2026-09-08")?.date, "2026-09-08");
  assert.equal(parseHistoricalCallDate("04//08/2026")?.date, "2026-08-04");
  assert.equal(parseHistoricalCallDate("01/07/0206"), null);
});

test("selectFairRoundRobin balances sellers while preserving per-seller recency", () => {
  const selected = selectFairRoundRobin([
    { transcriptFileId: "doc-a-old-001", sellerCode: "V100", callDate: "2026-01-01", sourceRow: 20 },
    { transcriptFileId: "doc-a-new-001", sellerCode: "V100", callDate: "2026-02-01", sourceRow: 30 },
    { transcriptFileId: "doc-b-old-001", sellerCode: "V200", sourceRow: 40 },
    { transcriptFileId: "doc-b-new-001", sellerCode: "V200", sourceRow: 80 },
  ], 4);
  assert.deepEqual(selected.map((item) => item.transcriptFileId), [
    "doc-a-new-001", "doc-b-new-001", "doc-a-old-001", "doc-b-old-001",
  ]);
});

test("resolveTranscriptIdentity rejects conflicting explicit and URL identities", () => {
  assert.throws(() => resolveTranscriptIdentity({
    transcriptFileId: "1ABC_xyz-987",
    transcriptUrl: "https://docs.google.com/document/d/1OTHER_xyz-987/edit",
  }), /transcript_identity_mismatch/);
});

test("resolveCallByTranscriptFileId uses the canonical id", async () => {
  let received = "";
  const resolved = await resolveCallByTranscriptFileId(
    { findByTranscriptFileId: async (id) => { received = id; return { id: "call-1" }; } },
    { transcriptFileId: "https://docs.google.com/document/d/1ABC_xyz-987/edit" },
  );
  assert.equal(received, "1ABC_xyz-987");
  assert.deepEqual(resolved, { id: "call-1" });
});

test("upsertCallSource normalizes identity before persistence", async () => {
  const result = await upsertCallSource(
    { upsert: async (input) => input },
    {
      callId: "call-1",
      sourceType: "manual_crm_import",
      sourceExternalId: "batch-1:item-1",
      transcriptFileId: "https://docs.google.com/document/d/1ABC_xyz-987/edit",
    },
  );
  assert.equal(result.transcriptFileId, "1ABC_xyz-987");
});

test("ingestCall reuses a call and never queues when official analysis exists", async () => {
  let fetches = 0;
  let queues = 0;
  const result = await ingestCall(
    {
      transcriptUrl: "https://docs.google.com/document/d/1ABC_xyz-987/edit",
      sellerCode: "V999",
      customerName: "Cliente Sintetico",
      callDate: "2026-01-02T12:00:00-03:00",
      sourceType: "manual_crm_import",
      sourceExternalId: "batch-1:item-1",
    },
    {
      repository: {
        upsertCallSource: async () => ({ callId: "call-1", created: false, transcriptPresent: true, officialAnalysisCompleted: true }),
        storeTranscript: async () => ({ transcriptId: "transcript-1" }),
        queueAnalysis: async () => { queues += 1; return { queued: true }; },
      },
      transcriptFetcher: { fetch: async () => { fetches += 1; return "unused"; } },
      requestAnalysis: true,
    },
  );
  assert.equal(result.analysisSkippedReason, "official_analysis_exists");
  assert.equal(fetches, 0);
  assert.equal(queues, 0);
});

test("ingestCall stores supplied transcript and queues exactly once", async () => {
  let stores = 0;
  let queues = 0;
  const result = await ingestCall(
    {
      transcriptFileId: "1ABC_xyz-987",
      transcriptText: "Conteudo sintetico da call.",
      sellerCode: "V999",
      customerName: "Cliente Sintetico",
      callDate: "2026-01-02T12:00:00-03:00",
      sourceType: "manual_crm_import",
      sourceExternalId: "batch-1:item-1",
    },
    {
      repository: {
        upsertCallSource: async () => ({ callId: "call-1", created: true, transcriptPresent: false, officialAnalysisCompleted: false }),
        storeTranscript: async () => { stores += 1; return { transcriptId: "transcript-1" }; },
        queueAnalysis: async () => { queues += 1; return { queued: true }; },
      },
      requestAnalysis: true,
    },
  );
  assert.equal(result.transcriptStored, true);
  assert.equal(result.analysisQueued, true);
  assert.equal(stores, 1);
  assert.equal(queues, 1);
});

test("ingestCall preserves the call when Google transcript access is retryable", async () => {
  const result = await ingestCall(
    {
      transcriptFileId: "1ABC_xyz-987",
      sellerCode: "V999",
      customerName: "Cliente Sintetico",
      callDate: "2026-01-02T12:00:00-03:00",
      sourceType: "manual_crm_import",
      sourceExternalId: "batch-1:item-1",
    },
    {
      repository: {
        upsertCallSource: async () => ({ callId: "call-1", created: true, transcriptPresent: false, officialAnalysisCompleted: false }),
        storeTranscript: async () => ({ transcriptId: "transcript-1" }),
        queueAnalysis: async () => ({ queued: true }),
      },
      transcriptFetcher: { fetch: async () => { throw new Error("transcript_access_denied"); } },
      requestAnalysis: true,
    },
  );
  assert.equal(result.created, true);
  assert.equal(result.transcriptFetchError, "transcript_access_denied");
  assert.equal(result.analysisSkippedReason, "transcript_unavailable");
});
