import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { claimPocJob, heartbeatPocJob, completePocJob, failPocJob } from "../lib/poc-db";

const databaseUrl = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/sales_intelligence_test";

test("POC database operations (Integration)", async (t) => {
  const sql = postgres(databaseUrl);

  try {
    await sql`SELECT 1`; // Test connection
  } catch (err) {
    t.skip("Test database unavailable");
    return;
  }

  // Clear tables
  await sql`TRUNCATE calls, transcripts, analysis_jobs, gemini_poc_jobs, gemini_poc_workers, analysis_runs, sellers CASCADE`;
  
  const sellerId = '00000000-0000-0000-0000-000000000003';
  await sql`INSERT INTO sellers (id, active) VALUES (${sellerId}, true)`;

  const callId1 = '00000000-0000-0000-0000-000000000001';
  const transcriptId1 = '00000000-0000-0000-0000-000000000002';
  
  await sql`INSERT INTO calls (id, seller_id, status, started_at, created_at) VALUES (${callId1}, ${sellerId}, 'transcribed', now() - interval '1 hour', now() - interval '2 hours')`;
  await sql`INSERT INTO transcripts (id, call_id, version, normalized_text) VALUES (${transcriptId1}, ${callId1}, 1, 'Hello world')`;
  await sql`INSERT INTO analysis_jobs (call_id, status, stage) VALUES (${callId1}, 'ready', 'queue')`;

  // Feeder idempotent test
  const feed = async (cId: string, tId: string) => {
    return sql`
      INSERT INTO gemini_poc_jobs (call_id, transcript_id, status)
      VALUES (${cId}, ${tId}, 'queued')
      ON CONFLICT (call_id, transcript_id) DO NOTHING
      RETURNING id
    `;
  };

  const res1 = await feed(callId1, transcriptId1);
  assert.equal(res1.length, 1, "Should insert first time");
  const jobId1 = res1[0].id;

  const res2 = await feed(callId1, transcriptId1);
  assert.equal(res2.length, 0, "Should be idempotent");

  // Claim
  const workerId = 'worker-1';
  const claimed = await claimPocJob(sql, workerId, 300);
  assert.ok(claimed, "Should claim job");
  assert.equal(claimed.job_id, jobId1);

  // Heartbeat
  const heartbeatOk = await heartbeatPocJob(sql, workerId, jobId1, { cpu: 1 }, 300);
  assert.ok(heartbeatOk);

  // Fail non-terminal
  await failPocJob(sql, workerId, jobId1, 'timeout', true);
  const afterFail = await sql`SELECT status, retry_at FROM gemini_poc_jobs WHERE id = ${jobId1}`;
  assert.equal(afterFail[0].status, 'retry_wait');
  assert.ok(afterFail[0].retry_at);

  // Simulate retry wait done
  await sql`UPDATE gemini_poc_jobs SET retry_at = now() - interval '1 minute' WHERE id = ${jobId1}`;
  const claimed2 = await claimPocJob(sql, workerId, 300);
  assert.ok(claimed2, "Should claim job again");

  // Complete
  const mockResult = {
    scoreability: 'scorable',
    confidence: 0.9,
    requires_human_review: false,
    overall_score: 85,
    unscorable_reason: null,
    metadata: { seller_identity: 'confirmed' }
  };

  await completePocJob(sql, workerId, jobId1, mockResult, 'raw', 1000);
  
  // Verify DB state
  const pocJob = await sql`SELECT status FROM gemini_poc_jobs WHERE id = ${jobId1}`;
  assert.equal(pocJob[0].status, 'completed');

  const analysisJob = await sql`SELECT status, stage FROM analysis_jobs WHERE call_id = ${callId1}`;
  assert.equal(analysisJob[0].status, 'completed');
  assert.equal(analysisJob[0].stage, 'completed');

  const worker = await sql`SELECT last_error_code FROM gemini_poc_workers WHERE worker_id = ${workerId}`;
  assert.equal(worker[0].last_error_code, null);
  
  // Test ordering (recency)
  await sql`TRUNCATE calls, transcripts, analysis_jobs, gemini_poc_jobs CASCADE`;
  const tId2 = '00000000-0000-0000-0000-000000000010';
  const tId3 = '00000000-0000-0000-0000-000000000011';
  
  // call2 is very old
  await sql`INSERT INTO calls (id, seller_id, status, started_at) VALUES ('c2', ${sellerId}, 'transcribed', now() - interval '1 year')`;
  // call3 is recent
  await sql`INSERT INTO calls (id, seller_id, status, started_at) VALUES ('c3', ${sellerId}, 'transcribed', now() - interval '1 day')`;
  
  await sql`INSERT INTO transcripts (id, call_id, version, normalized_text) VALUES (${tId2}, 'c2', 1, 'text')`;
  await sql`INSERT INTO transcripts (id, call_id, version, normalized_text) VALUES (${tId3}, 'c3', 1, 'text')`;
  
  await feed('c2', tId2);
  await feed('c3', tId3);

  const claimRecent = await claimPocJob(sql, 'worker-2', 300);
  assert.equal(claimRecent?.call_id, 'c3', "Should claim the most recent call first");
  
  await sql.end();
});
