import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2 });
let stopRequested = false;

process.on("SIGTERM", () => { stopRequested = true; });
process.on("SIGINT", () => { stopRequested = true; });

async function feed() {
  let enqueuedCount = 0;
  
  // Encontre calls que estão prontas mas não estão no POC (ou estão mas queremos garantir que entrem se faltar)
  const jobsToEnqueue = await sql`
    SELECT aj.call_id, aj.id as analysis_job_id,
           (SELECT t.id FROM transcripts t WHERE t.call_id = aj.call_id ORDER BY t.version DESC LIMIT 1) as transcript_id
    FROM analysis_jobs aj
    JOIN calls c ON c.id = aj.call_id
    WHERE aj.status = 'ready'
      AND NOT EXISTS (
        SELECT 1 FROM gemini_poc_jobs g 
        WHERE g.call_id = aj.call_id 
          AND g.status IN ('completed', 'queued', 'claimed', 'retry_wait')
      )
      AND NOT EXISTS (
        SELECT 1 FROM analysis_runs ar
        WHERE ar.call_id = aj.call_id
          AND ar.is_current = true
          AND ar.status = 'completed'
      )
    ORDER BY
      CASE
        WHEN c.started_at IS NOT NULL THEN 0
        WHEN c.metadata->>'recency_method' = 'source_row_desc_verified' THEN 1
        ELSE 2
      END ASC,
      c.started_at DESC NULLS LAST,
      CASE
        WHEN c.metadata->>'recency_method' = 'source_row_desc_verified' AND COALESCE(c.metadata->>'source_row', '') ~ '^[0-9]+$'
        THEN (c.metadata->>'source_row')::bigint
        ELSE NULL
      END DESC NULLS LAST,
      c.created_at DESC,
      aj.id ASC
    LIMIT 50
  `;

  for (const job of jobsToEnqueue) {
    if (!job.transcript_id) continue;
    
    // Idempotent insert
    const result = await sql`
      INSERT INTO gemini_poc_jobs (call_id, transcript_id, status)
      VALUES (${job.call_id}, ${job.transcript_id}, 'queued')
      ON CONFLICT (call_id, transcript_id) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) {
      enqueuedCount++;
    }
  }
  return enqueuedCount;
}

async function main() {
  console.log("Gemini POC Feeder started...");
  while (!stopRequested) {
    try {
      const enqueued = await feed();
      if (enqueued > 0) {
        console.log(`Enqueued ${enqueued} jobs for Gemini POC.`);
      }
    } catch (error) {
      console.error("Error feeding POC jobs:", error);
    }
    
    // Espera antes de próxima iteração
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().finally(() => sql.end());
