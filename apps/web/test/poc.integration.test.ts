import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { claimPocJob, heartbeatPocJob, completePocJob, failPocJob } from "../lib/poc-db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration("POC database operations", async (t) => {
  const sql = postgres(databaseUrl!);

  // Setup mock data
  await sql`TRUNCATE calls, transcripts, analysis_jobs, gemini_poc_jobs, gemini_poc_workers, analysis_runs CASCADE`;
  
  const callId = '00000000-0000-0000-0000-000000000001';
  const transcriptId = '00000000-0000-0000-0000-000000000002';
  
  await sql`INSERT INTO calls (id, seller_id, status) VALUES (${callId}, '00000000-0000-0000-0000-000000000003', 'transcribed')`;
  await sql`INSERT INTO transcripts (id, call_id, version, normalized_text) VALUES (${transcriptId}, ${callId}, 1, 'Hello world')`;
  await sql`INSERT INTO analysis_jobs (call_id, status, stage) VALUES (${callId}, 'ready', 'queue')`;

  // Test idempotency of feeder
  const feed = async () => {
    return sql`
      INSERT INTO gemini_poc_jobs (call_id, transcript_id, status)
      VALUES (${callId}, ${transcriptId}, 'queued')
      ON CONFLICT (call_id, transcript_id) DO NOTHING
      RETURNING id
    `;
  };

  const res1 = await feed();
  assert.equal(res1.length, 1, "Should insert first time");
  const jobId = res1[0].id;

  const res2 = await feed();
  assert.equal(res2.length, 0, "Should be idempotent");

  // Test priority (would need multiple jobs, simplifying here)
  
  // Test claim
  const workerId = 'worker-1';
  const claimed = await claimPocJob(sql, workerId, 300);
  assert.ok(claimed, "Should claim job");
  assert.equal(claimed.job_id, jobId);

  // Test fail non-terminal
  await failPocJob(sql, workerId, jobId, 'timeout', true);
  const afterFail = await sql`SELECT status, retry_at FROM gemini_poc_jobs WHERE id = ${jobId}`;
  assert.equal(afterFail[0].status, 'retry_wait');
  assert.ok(afterFail[0].retry_at);

  // Claim again (simulate time pass by updating retry_at)
  await sql`UPDATE gemini_poc_jobs SET retry_at = now() - interval '1 minute'`;
  const claimed2 = await claimPocJob(sql, workerId, 300);
  assert.ok(claimed2, "Should claim job again");

  // Test completion syncs analysis_jobs
  const mockResult = {
    scoreability: 'scorable',
    confidence: 0.9,
    requires_human_review: false,
    overall_score: 85,
    unscorable_reason: null,
    metadata: {
      seller_identity: 'confirmed'
    }
  };

  await completePocJob(sql, workerId, jobId, mockResult, 'raw', 1000);
  
  const pocJob = await sql`SELECT status FROM gemini_poc_jobs WHERE id = ${jobId}`;
  assert.equal(pocJob[0].status, 'completed');

  const analysisJob = await sql`SELECT status, stage FROM analysis_jobs WHERE call_id = ${callId}`;
  assert.equal(analysisJob[0].status, 'completed');
  assert.equal(analysisJob[0].stage, 'completed');

  // Verify worker error cleared
  const worker = await sql`SELECT last_error_code FROM gemini_poc_workers WHERE worker_id = ${workerId}`;
  assert.equal(worker[0].last_error_code, null);

  await sql.end();
});
