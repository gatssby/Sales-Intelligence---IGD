import { parseArgs } from "util";
import postgres from "postgres";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "call-id": { type: "string" },
  },
});

const callId = values["call-id"] as string;
if (!callId) {
  console.error("Usage: npm run gemini:poc:enqueue -- --call-id=<uuid>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

async function main() {
  try {
    const calls = await sql`SELECT id FROM calls WHERE id = ${callId}`;
    if (calls.length === 0) {
      console.error(`Call ${callId} not found`);
      process.exit(1);
    }

    const transcripts = await sql`
      SELECT id FROM transcripts WHERE call_id = ${callId} ORDER BY version DESC LIMIT 1
    `;
    if (transcripts.length === 0) {
      console.error(`No transcript found for call ${callId}`);
      process.exit(1);
    }
    const transcriptId = transcripts[0].id;

    const result = await sql`
      INSERT INTO gemini_poc_jobs (call_id, transcript_id, status)
      VALUES (${callId}, ${transcriptId}, 'queued')
      ON CONFLICT (call_id, transcript_id) DO NOTHING
      RETURNING id
    `;

    if (result.length === 0) {
      console.log(`Call ${callId} is already in the Gemini POC queue`);
    } else {
      console.log(`Call ${callId} enqueued for Gemini POC successfully`);
    }
  } catch (error) {
    console.error("Failed to enqueue:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
