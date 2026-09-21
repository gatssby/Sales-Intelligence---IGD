import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { AnalysisOutputSchema } from "@igd/ai";

const databaseUrl = process.env.DATABASE_URL;
const seedFile = process.env.DEMO_SEED_FILE;
if (!databaseUrl || !seedFile) throw new Error("DATABASE_URL and DEMO_SEED_FILE are required.");

const payload = JSON.parse(await readFile(seedFile, "utf8"));
const analysis = AnalysisOutputSchema.parse(payload.analysis);
const transcriptHash = createHash("sha256").update(payload.transcript).digest("hex");
const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });

try {
  await sql.begin(async (tx) => {
    const [seller] = await tx`
      insert into sellers (display_name, external_reference)
      values (${payload.seller.name}, ${payload.seller.external_reference})
      on conflict (external_reference) do update set
        display_name = excluded.display_name,
        updated_at = now()
      returning id
    `;
    const [source] = await tx`
      insert into source_locations (seller_id, provider, external_folder_id, last_synced_at)
      values (${seller.id}, 'google_drive', ${payload.source.external_folder_id}, now())
      on conflict (provider, external_folder_id) do update set last_synced_at = excluded.last_synced_at
      returning id
    `;
    const [call] = await tx`
      insert into calls (seller_id, source_location_id, external_key, customer_name, product_key, started_at, duration_seconds, status)
      values (${seller.id}, ${source.id}, ${payload.call.external_key}, ${payload.call.customer_name}, ${payload.call.product_key}, ${payload.call.started_at}, ${payload.call.duration_seconds}, 'transcript_ready')
      on conflict (external_key) do update set status = 'transcript_ready'
      returning id
    `;
    const [artifact] = await tx`
      insert into call_artifacts (call_id, provider, external_file_id, artifact_type, name, mime_type, modified_at)
      values (${call.id}, 'google_drive', ${payload.artifact.external_file_id}, 'gemini_notes', ${payload.artifact.name}, ${payload.artifact.mime_type}, ${payload.artifact.modified_at})
      on conflict (provider, external_file_id) do update set modified_at = excluded.modified_at
      returning id
    `;
    const [transcript] = await tx`
      insert into transcripts (call_id, artifact_id, raw_text, normalized_text, content_sha256, source)
      values (${call.id}, ${artifact.id}, ${payload.transcript}, ${payload.transcript}, ${transcriptHash}, 'google_meet_gemini_notes')
      on conflict (call_id, content_sha256) do update set normalized_text = excluded.normalized_text
      returning id
    `;
    await tx`update analysis_runs set is_current = false where call_id = ${call.id}`;
    await tx`
      insert into analysis_runs (call_id, transcript_id, provider, model, rubric_version, prompt_version, schema_version, status, score, result_json, is_current, finished_at)
      values (${call.id}, ${transcript.id}, ${payload.run.provider}, ${payload.run.model}, ${payload.run.rubric_version}, ${payload.run.prompt_version}, ${payload.run.schema_version}, 'completed', ${analysis.overall_score}, ${tx.json(analysis)}, true, now())
      on conflict (call_id, transcript_id, rubric_version, prompt_version, model)
      do update set result_json = excluded.result_json, score = excluded.score, status = 'completed', is_current = true, finished_at = now()
    `;
    await tx`update calls set status = 'analyzed', updated_at = now() where id = ${call.id}`;
  });
  console.log("Demo call seeded without writing transcript or PII to the repository.");
} finally {
  await sql.end();
}
