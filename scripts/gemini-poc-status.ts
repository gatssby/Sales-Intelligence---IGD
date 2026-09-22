import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

async function main() {
  try {
    const stats = await sql`
      SELECT status, COUNT(*) as count
      FROM gemini_poc_jobs
      GROUP BY status
    `;

    console.log("=== Gemini POC Jobs Status ===");
    const counts = { queued: 0, claimed: 0, completed: 0, retry_wait: 0, failed_terminal: 0 };
    for (const row of stats) {
      counts[row.status as keyof typeof counts] = Number(row.count);
    }
    for (const [status, count] of Object.entries(counts)) {
      console.log(`${status.padEnd(15)} : ${count}`);
    }

    console.log("\n=== Active Workers ===");
    const activeWorkers = await sql`
      SELECT worker_id, status, jobs_completed, jobs_failed, last_seen_at
      FROM gemini_poc_workers
      WHERE last_seen_at > now() - interval '10 minutes'
    `;

    if (activeWorkers.length === 0) {
      console.log("No active workers in the last 10 minutes.");
    } else {
      for (const w of activeWorkers) {
        console.log(`- ${w.worker_id} (${w.status}) | completed: ${w.jobs_completed} | failed: ${w.jobs_failed} | last_seen: ${w.last_seen_at.toISOString()}`);
      }
    }

  } catch (error) {
    console.error("Failed to get status:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
