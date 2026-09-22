import postgres from "postgres";
import { feedGeminiPocQueue } from "./lib/gemini-poc-feeder";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const batchSize = Number(process.env.GEMINI_POC_FEEDER_BATCH_SIZE ?? 50);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
  console.error("GEMINI_POC_FEEDER_BATCH_SIZE must be an integer between 1 and 50");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2 });
let stopRequested = false;

process.on("SIGTERM", () => { stopRequested = true; });
process.on("SIGINT", () => { stopRequested = true; });

async function main() {
  console.log("Gemini POC Feeder started...");
  while (!stopRequested) {
    try {
      const result = await feedGeminiPocQueue(sql, batchSize);
      if (result.enqueued > 0) {
        console.log(JSON.stringify({ event: "gemini_feed", ...result }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: "gemini_feed_error",
        errorCode: error instanceof Error ? error.message : "unknown_error",
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().finally(() => sql.end());
