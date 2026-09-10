import { loadInsiderDataset } from "./lib/insider-dataset.js";
import { PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
const inputFile = process.env.MANUAL_INGESTION_FILE;
if (!databaseUrl || !inputFile) throw new Error("DATABASE_URL and MANUAL_INGESTION_FILE are required");
const apply = process.argv.includes("--apply");
const dataset = await loadInsiderDataset(inputFile);
const repository = new PostgresIngestionRepository(databaseUrl);

try {
  const sellerCodes = [...new Set(dataset.valid.map((item) => item.raw.seller_code))];
  const sellerRows = await repository.sql<{ seller_code: string }[]>`
    select seller_code from sellers where seller_code = any(${sellerCodes})
  `;
  const registered = new Set(sellerRows.map((row) => row.seller_code));
  const missingSellers = sellerCodes.filter((code) => !registered.has(code));
  const sourceOccurrences = dataset.valid.reduce((sum, item) => sum + item.sources.length, 0);

  if (!apply) {
    const existingCalls = await repository.sql<{ count: number }[]>`
      select count(*)::integer as count from calls
      where transcript_file_id = any(${dataset.valid.map((item) => item.transcriptFileId)})
    `;
    console.log(JSON.stringify({
      mode: "dry_run",
      objects: dataset.totalLines,
      validCanonicalCalls: dataset.valid.length,
      quarantined: dataset.issues.length,
      sourceOccurrences,
      existingCalls: existingCalls[0].count,
      callsToCreate: dataset.valid.length - existingCalls[0].count,
      missingSellerCodes: missingSellers,
      sellerAssociationNeedsReview: dataset.valid.filter((item) => item.sellerAssociationNeedsReview).length,
      analysisRequested: false,
      transcriptFetchRequested: false,
    }));
    process.exitCode = missingSellers.length ? 2 : 0;
  } else {
    if (missingSellers.length) throw new Error(`seller_registry_incomplete:${missingSellers.join(",")}`);
    const summary = await repository.sql.begin(async (tx) => {
      const beforeCalls = await tx<{ count: number }[]>`select count(*)::integer as count from calls`;
      const beforeSources = await tx<{ count: number }[]>`select count(*)::integer as count from call_sources`;
      const runs = await tx<{ id: string }[]>`
        insert into ingestion_runs (
          source_type, product, mode, sources_scanned, items_scanned, calls_discovered,
          quarantined_count, errors_count, metadata
        ) values (
          'manual_crm_import', 'INSIDER', 'controlled', ${sourceOccurrences}, ${dataset.totalLines},
          ${dataset.valid.length}, ${dataset.issues.length}, ${dataset.issues.length},
          ${tx.json({ transcript_fetch_requested: false, analysis_requested: false, identity: "transcript_file_id" })}
        ) returning id
      `;
      const runId = runs[0].id;

      for (const issue of dataset.issues) {
        await tx`
          insert into ingestion_events (ingestion_run_id, event_type, source_type, message, metadata)
          values (${runId}, 'FAILED_ROW_PARSE', 'manual_crm_import', ${issue.code}, ${tx.json({ dataset_line: issue.line })})
        `;
      }

      for (const item of dataset.valid) {
        let callId = "";
        for (const source of item.sources) {
          const outcome = await repository.upsertCallSource({
            transcriptFileId: item.transcriptFileId,
            transcriptUrl: item.raw.transcript_url,
            sellerCode: item.raw.seller_code,
            customerName: item.raw.customer_name.trim() || undefined,
            customerEmail: item.raw.customer_email.trim() || undefined,
            product: "INSIDER",
            callDate: item.parsedDate?.startedAt,
            status: item.raw.status.trim() || undefined,
            origin: item.raw.origin.trim() || undefined,
            sourceType: item.raw.source_type,
            sourceExternalId: source.externalId,
            recordingUrl: item.raw.recording_url.trim() || undefined,
            metadata: {
              source_workbook: source.workbook,
              source_sheet: source.sheet,
              source_row: source.row,
              source_count: item.raw.source_count,
              dataset_line: item.line,
              date_raw: item.raw.date || null,
              normalized_call_date: item.parsedDate?.date ?? null,
              recency_method: item.parsedDate ? "call_date_desc" : "source_row_desc_verified",
              seller_association_needs_review: item.sellerAssociationNeedsReview,
              date_needs_review: item.dateNeedsReview,
            },
          }, tx);
          callId = outcome.callId;
        }
        if (item.sellerAssociationNeedsReview) {
          await tx`update calls set status = 'needs_review', updated_at = now() where id = ${callId} and status <> 'analyzed'`;
          await tx`
            insert into ingestion_events (
              ingestion_run_id, event_type, source_type, seller_code, transcript_file_id, call_id, message
            ) values (
              ${runId}, 'SELLER_ASSOCIATION_NEEDS_REVIEW', 'manual_crm_import', ${item.raw.seller_code},
              ${item.transcriptFileId}, ${callId}, 'multiple_or_mismatched_seller_codes_in_sources'
            )
          `;
        }
      }

      const afterCalls = await tx<{ count: number }[]>`select count(*)::integer as count from calls`;
      const afterSources = await tx<{ count: number }[]>`select count(*)::integer as count from call_sources`;
      const callsCreated = afterCalls[0].count - beforeCalls[0].count;
      const sourcesCreated = afterSources[0].count - beforeSources[0].count;
      await tx`
        update ingestion_runs set
          finished_at = now(), status = ${dataset.issues.length ? "completed_with_errors" : "completed"},
          calls_created = ${callsCreated}, calls_matched_existing = ${dataset.valid.length - callsCreated},
          call_sources_created = ${sourcesCreated}, call_sources_updated = ${sourceOccurrences - sourcesCreated},
          updated_at = now()
        where id = ${runId}
      `;
      return { runId, callsCreated, callsMatchedExisting: dataset.valid.length - callsCreated, sourcesCreated, sourcesUpdated: sourceOccurrences - sourcesCreated };
    });
    console.log(JSON.stringify({ mode: "apply", ...summary, quarantined: dataset.issues.length, sellerAssociationNeedsReview: dataset.valid.filter((item) => item.sellerAssociationNeedsReview).length }));
  }
} finally {
  await repository.close();
}
