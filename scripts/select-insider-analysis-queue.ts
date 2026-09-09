import { chmod, writeFile } from "node:fs/promises";
import { selectFairRoundRobin } from "@igd/core";
import { PostgresIngestionRepository } from "@igd/db";
import { loadInsiderDataset } from "./lib/insider-dataset.js";

const databaseUrl = process.env.DATABASE_URL;
const inputFile = process.env.MANUAL_INGESTION_FILE;
const outputFile = process.env.ANALYSIS_QUEUE_FILE;
if (!databaseUrl || !inputFile || !outputFile) {
  throw new Error("DATABASE_URL, MANUAL_INGESTION_FILE and ANALYSIS_QUEUE_FILE are required");
}

const dataset = await loadInsiderDataset(inputFile);
const repository = new PostgresIngestionRepository(databaseUrl);
try {
  const activeRows = await repository.sql<{ seller_code: string }[]>`
    select seller_code from sellers
    where active = true and upper(product) = 'INSIDER' and seller_code is not null
  `;
  const active = new Set(activeRows.map((row) => row.seller_code));
  const officialRows = await repository.sql<{ transcript_file_id: string }[]>`
    select c.transcript_file_id
    from calls c join analysis_runs ar on ar.call_id = c.id
    where ar.status = 'completed' and ar.is_current = true and c.transcript_file_id is not null
  `;
  const official = new Set(officialRows.map((row) => row.transcript_file_id));
  const transcriptRows = await repository.sql<{ transcript_file_id: string }[]>`
    select distinct c.transcript_file_id
    from calls c join transcripts t on t.call_id = c.id
    where c.transcript_file_id is not null
  `;
  const transcriptPresent = new Set(transcriptRows.map((row) => row.transcript_file_id));

  const candidates = dataset.valid
    .filter((item) => active.has(item.raw.seller_code))
    .filter((item) => !item.sellerAssociationNeedsReview)
    .filter((item) => !official.has(item.transcriptFileId))
    .map((item) => ({
      transcriptFileId: item.transcriptFileId,
      transcriptUrl: item.raw.transcript_url,
      sellerCode: item.raw.seller_code,
      callDate: item.parsedDate?.date,
      sourceRow: Math.max(...item.sources.map((source) => source.row)),
      sourceKey: item.sources.map((source) => `${source.workbook}::${source.sheet}`).sort().join("|"),
      recencyMethod: item.parsedDate ? "call_date_desc" : "source_row_desc_verified",
      transcriptPresent: transcriptPresent.has(item.transcriptFileId),
    }));
  const queue = selectFairRoundRobin(candidates, candidates.length);
  const payload = queue.map((item, index) => ({ rank: index + 1, ...item }));
  await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputFile, 0o600);
  const firstBatch = payload.slice(0, 30);
  const sellerCounts = new Map<string, number>();
  for (const item of firstBatch) sellerCounts.set(item.sellerCode, (sellerCounts.get(item.sellerCode) ?? 0) + 1);
  console.log(JSON.stringify({
    outputFile,
    eligibleCalls: payload.length,
    eligibleSellers: new Set(payload.map((item) => item.sellerCode)).size,
    firstBatchSize: firstBatch.length,
    firstBatchSellerCount: sellerCounts.size,
    firstBatchBySeller: Object.fromEntries([...sellerCounts].sort()),
    firstBatchDateBased: firstBatch.filter((item) => item.recencyMethod === "call_date_desc").length,
    firstBatchRowFallback: firstBatch.filter((item) => item.recencyMethod === "source_row_desc_verified").length,
    skippedExistingOfficial: officialRows.length,
    reusableTranscriptsInQueue: payload.filter((item) => item.transcriptPresent).length,
  }));
} finally {
  await repository.close();
}
