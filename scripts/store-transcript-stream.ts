import { createInterface } from "node:readline";
import { z } from "zod";
import { extractGoogleFileId } from "@igd/core";
import { PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const queueAnalysis = process.argv.includes("--queue-analysis");
const repository = new PostgresIngestionRepository(databaseUrl);
const messages = createInterface({ input: process.stdin, crlfDelay: Infinity });
const MessageSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("finish") }),
  z.object({ op: z.literal("start"), transcript_file_id: z.string() }),
  z.object({ op: z.literal("success"), transcript_file_id: z.string(), transcript_text: z.string().min(1) }),
  z.object({ op: z.literal("failure"), transcript_file_id: z.string(), error: z.enum(["transcript_access_denied", "transcript_not_found", "transcript_fetch_failed", "transcript_empty"]) }),
]);

const runRows = await repository.sql<{ id: string }[]>`
  insert into ingestion_runs (source_type, product, mode, metadata)
  values ('google_doc_batch_fetch', 'INSIDER', 'controlled', ${repository.sql.json({ queue_analysis: queueAnalysis })})
  returning id
`;
const runId = runRows[0].id;
process.stdout.write(`${JSON.stringify({ ready: true, runId })}\n`);
let attempted = 0;
let stored = 0;
let alreadyPresent = 0;
let failed = 0;
let queued = 0;
let skippedExisting = 0;

try {
  for await (const line of messages) {
    if (!line.trim()) continue;
    const message = MessageSchema.parse(JSON.parse(line));
    if (message.op === "finish") break;
    const transcriptFileId = extractGoogleFileId(message.transcript_file_id);
    if (!transcriptFileId || transcriptFileId !== message.transcript_file_id) throw new Error("invalid_transcript_file_id");
    const call = await repository.resolveCallByTranscriptFileId(transcriptFileId);
    if (!call) throw new Error("call_not_found");

    if (message.op === "start") {
      attempted += 1;
      await repository.sql`
        insert into ingestion_events (ingestion_run_id, event_type, source_type, transcript_file_id, call_id, message)
        values (${runId}, 'TRANSCRIPT_FETCH_STARTED', 'google_drive_doc', ${transcriptFileId}, ${call.id}, 'fetching_transcript')
      `;
      process.stdout.write(`${JSON.stringify({ ack: "start", transcriptFileId })}\n`);
      continue;
    }

    if (message.op === "failure") {
      failed += 1;
      const terminal = message.error === "transcript_not_found" || message.error === "transcript_empty";
      await repository.sql.begin(async (tx) => {
        await tx`
          insert into ingestion_events (ingestion_run_id, event_type, source_type, transcript_file_id, call_id, message)
          values (${runId}, 'FAILED_TRANSCRIPT_ACCESS', 'google_drive_doc', ${transcriptFileId}, ${call.id}, ${message.error})
        `;
        await tx`
          update calls set status = case when status = 'analyzed' then status else ${terminal ? "failed_permanent" : "failed_retryable"} end, updated_at = now()
          where id = ${call.id}
        `;
        await tx`
          update analysis_jobs set status=${terminal ? "failed_terminal" : "awaiting_transcript"}, stage='transcript',
            retry_at=${terminal ? null : new Date(Date.now() + 24 * 60 * 60 * 1_000)},
            last_error_code=${message.error}, worker_id=null, lease_expires_at=null, updated_at=now()
          where call_id=${call.id} and status in ('awaiting_transcript','ready','retry_wait','failed_terminal')
        `;
      });
      process.stdout.write(`${JSON.stringify({ ack: "failure", transcriptFileId })}\n`);
      continue;
    }

    const existing = await repository.sql`select 1 from transcripts where call_id = ${call.id} limit 1`;
    if (existing.length) {
      alreadyPresent += 1;
      await repository.sql`
        insert into ingestion_events (ingestion_run_id, event_type, source_type, transcript_file_id, call_id, message)
        values (${runId}, 'TRANSCRIPT_ALREADY_PRESENT', 'google_drive_doc', ${transcriptFileId}, ${call.id}, 'transcript_reused')
      `;
    } else {
      await repository.storeTranscript(call.id, transcriptFileId, message.transcript_text);
      stored += 1;
      await repository.sql`
        insert into ingestion_events (ingestion_run_id, event_type, source_type, transcript_file_id, call_id, message)
        values (${runId}, 'TRANSCRIPT_FETCHED', 'google_drive_doc', ${transcriptFileId}, ${call.id}, 'transcript_stored')
      `;
    }
    if (queueAnalysis) {
      const result = await repository.queueAnalysis(call.id);
      queued += Number(result.queued);
      skippedExisting += Number(result.reason === "official_analysis_exists");
    }
    process.stdout.write(`${JSON.stringify({ ack: "success", transcriptFileId })}\n`);
  }
} finally {
  await repository.sql`
    update ingestion_runs set
      finished_at = now(), status = ${failed ? "completed_with_errors" : "completed"},
      items_scanned = ${attempted}, transcripts_stored = ${stored}, analyses_queued = ${queued},
      analyses_skipped_existing = ${skippedExisting}, errors_count = ${failed}, updated_at = now()
    where id = ${runId}
  `;
  console.log(JSON.stringify({ runId, attempted, stored, alreadyPresent, failed, queued, skippedExisting }));
  await repository.close();
}
