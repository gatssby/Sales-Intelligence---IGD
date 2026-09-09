import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ingestCall, resolveTranscriptIdentity } from "@igd/core";
import { PostgresAuthRepository, PostgresIngestionRepository } from "@igd/db";
import { GoogleDriveTranscriptFetcher } from "@igd/google";

const databaseUrl = process.env.DATABASE_URL;
const inputFile = process.env.MANUAL_INGESTION_FILE;
if (!databaseUrl || !inputFile) throw new Error("DATABASE_URL and MANUAL_INGESTION_FILE are required");

const apply = process.argv.includes("--apply");
const requestAnalysis = process.argv.includes("--request-analysis");
if (requestAnalysis && !apply) throw new Error("--request-analysis requires --apply");

const ItemSchema = z.object({
  transcript_url: z.string().url().optional(),
  transcript_file_id: z.string().optional(),
  transcript_text: z.string().min(1).optional(),
  seller_code: z.string().regex(/^V\d+$/),
  customer_name: z.string().min(1),
  customer_email: z.string().email().optional(),
  product: z.string().min(1).default("INSIDER"),
  call_date: z.string().datetime({ offset: true }),
  status: z.string().optional(),
  origin: z.string().optional(),
  source_type: z.string().regex(/^[a-z0-9_]+$/),
  source_external_id: z.string().min(1),
  source_uri: z.string().url().optional(),
  recording_url: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((item) => item.transcript_file_id || item.transcript_url, "transcript identity is required");

const items = z.array(ItemSchema).min(1).max(100).parse(JSON.parse(await readFile(inputFile, "utf8")));
const repository = new PostgresIngestionRepository(databaseUrl);
const transcriptFetcher = process.env.GOOGLE_ACCESS_TOKEN
  ? new GoogleDriveTranscriptFetcher(process.env.GOOGLE_ACCESS_TOKEN)
  : undefined;

try {
  if (!apply) {
    const existingIds = new Set<string>();
    let missingSellers = 0;
    const ids = new Set<string>();
    for (const item of items) {
      const id = resolveTranscriptIdentity({ transcriptFileId: item.transcript_file_id, transcriptUrl: item.transcript_url });
      if (!ids.has(id) && await repository.resolveCallByTranscriptFileId(id)) existingIds.add(id);
      ids.add(id);
      const sellers = await repository.sql`
        select 1 from sellers where seller_code = ${item.seller_code} limit 1
      `;
      if (!sellers.length) missingSellers += 1;
    }
    console.log(JSON.stringify({ mode: "dry_run", items: items.length, uniqueTranscriptFileIds: ids.size, duplicateTranscriptFileIdsInBatch: items.length - ids.size, existingCalls: existingIds.size, callsToCreate: ids.size - existingIds.size, missingSellers, analysisRequested: false }));
    process.exitCode = 0;
  } else {
    if (requestAnalysis) {
      await new PostgresAuthRepository(repository.sql).requireSpendActor(
        process.env.AUTH_ACTOR_EMAIL ?? "",
        "analysis.queue.cli",
      );
    }
    const runRows = await repository.sql<{ id: string }[]>`
      insert into ingestion_runs (source_type, product, mode, sources_scanned, items_scanned)
      values ('manual_programmatic_batch', ${new Set(items.map((item) => item.product)).size === 1 ? items[0].product : "MIXED"}, 'controlled', 1, ${items.length})
      returning id
    `;
    const runId = runRows[0].id;
    let created = 0;
    let matched = 0;
    let transcriptsStored = 0;
    let analysesQueued = 0;
    let analysesSkipped = 0;
    let errors = 0;
    for (const item of items) {
      try {
        const outcome = await ingestCall({
          transcriptUrl: item.transcript_url,
          transcriptFileId: item.transcript_file_id,
          transcriptText: item.transcript_text,
          sellerCode: item.seller_code,
          customerName: item.customer_name,
          customerEmail: item.customer_email,
          product: item.product,
          callDate: item.call_date,
          status: item.status,
          origin: item.origin,
          sourceType: item.source_type,
          sourceExternalId: item.source_external_id,
          sourceUri: item.source_uri,
          recordingUrl: item.recording_url,
          metadata: item.metadata,
        }, { repository, transcriptFetcher, requestAnalysis });
        created += Number(outcome.created);
        matched += Number(!outcome.created);
        transcriptsStored += Number(outcome.transcriptStored);
        analysesQueued += Number(outcome.analysisQueued);
        analysesSkipped += Number(outcome.analysisSkippedReason === "official_analysis_exists");
        await repository.sql`
          insert into ingestion_events (
            ingestion_run_id, event_type, source_type, source_external_id, seller_code,
            transcript_file_id, call_id, message
          ) values (
            ${runId}, ${outcome.created ? "DISCOVERED_NEW_CALL" : "MATCHED_EXISTING_TRANSCRIPT"},
            ${item.source_type}, ${item.source_external_id}, ${item.seller_code},
            ${outcome.transcriptFileId}, ${outcome.callId},
            ${outcome.analysisSkippedReason ?? (outcome.analysisQueued ? "analysis_queued" : "transcript_ready")}
          )
        `;
        if (outcome.transcriptFetchError) {
          errors += 1;
          await repository.sql`
            insert into ingestion_events (
              ingestion_run_id, event_type, source_type, source_external_id, seller_code,
              transcript_file_id, call_id, message
            ) values (
              ${runId}, 'FAILED_TRANSCRIPT_ACCESS', ${item.source_type}, ${item.source_external_id},
              ${item.seller_code}, ${outcome.transcriptFileId}, ${outcome.callId}, ${outcome.transcriptFetchError}
            )
          `;
        }
      } catch (error) {
        errors += 1;
        const errorCode = error instanceof Error && error.message.startsWith("seller_not_found")
          ? "seller_not_found"
          : error instanceof Error && [
              "invalid_transcript_file_id", "transcript_identity_mismatch", "source_identity_conflict",
              "transcript_access_denied", "transcript_not_found", "transcript_fetch_failed", "transcript_empty",
            ].includes(error.message)
            ? error.message
            : "item_import_failed";
        const eventType = ["transcript_access_denied", "transcript_not_found", "transcript_fetch_failed", "transcript_empty"]
          .includes(errorCode) ? "FAILED_TRANSCRIPT_ACCESS" : "FAILED_ITEM_IMPORT";
        await repository.sql`
          insert into ingestion_events (ingestion_run_id, event_type, source_type, source_external_id, seller_code, message)
          values (${runId}, ${eventType}, ${item.source_type}, ${item.source_external_id}, ${item.seller_code}, ${errorCode})
        `;
      }
    }
    await repository.sql`
      update ingestion_runs set
        finished_at = now(), status = ${errors ? "completed_with_errors" : "completed"},
        calls_discovered = ${items.length}, calls_created = ${created}, calls_matched_existing = ${matched},
        transcripts_stored = ${transcriptsStored}, analyses_queued = ${analysesQueued},
        analyses_skipped_existing = ${analysesSkipped}, errors_count = ${errors}, updated_at = now()
      where id = ${runId}
    `;
    console.log(JSON.stringify({ mode: "apply", runId, items: items.length, created, matched, transcriptsStored, analysesQueued, analysesSkippedExisting: analysesSkipped, errors }));
  }
} finally {
  await repository.close();
}
