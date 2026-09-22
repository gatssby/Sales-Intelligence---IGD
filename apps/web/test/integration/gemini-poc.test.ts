import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Sql } from "postgres";

import { claimPocJob, completePocJob, failPocJob } from "../../lib/poc-db";
import { getGeminiPocMonitorData } from "../../lib/gemini-poc-monitor";
import { getGeminiPocEvents } from "../../lib/gemini-poc-events";
import { withIsolatedPostgresTest } from "../support/postgres";
import { feedGeminiPocQueue } from "../../../../scripts/lib/gemini-poc-feeder";

const validResult = {
  scoreability: "unscorable" as const,
  unscorable_reason: "Synthetic integration fixture",
  overall_score: null,
  opportunity_quality: "unknown" as const,
  opportunity_quality_label: "Unknown",
  call_outcome: "unknown" as const,
  call_outcome_label: "Unknown",
  confidence: 0.9,
  executive_summary: "Synthetic summary",
  strengths: [],
  critical_failures: [],
  objections: [],
  coaching_actions: [],
  dimensions: [],
  evidence: [],
  requires_human_review: false,
};

async function createSeller(sql: Sql): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into sellers (id, display_name, active, created_at, updated_at)
    values (${id}, 'Synthetic Seller', true, now(), now())
  `;
  return id;
}

async function createCallWithTranscript(input: {
  sql: Sql;
  sellerId: string;
  externalKey: string;
  startedAt?: Date | null;
  metadata?: Record<string, unknown>;
  jobStatus?: "awaiting_transcript" | "ready" | "claimed" | "completed";
  pocStatus?: "queued" | "claimed" | "completed" | "retry_wait" | "failed_terminal";
}): Promise<{ callId: string; transcriptId: string; analysisJobId: string; pocJobId: string | null }> {
  const callId = randomUUID();
  const transcriptId = randomUUID();
  const rows = await input.sql<{ id: string }[]>`
    insert into calls (
      id, seller_id, external_key, customer_name, product_key, started_at, status, metadata, created_at, updated_at
    ) values (
      ${callId}, ${input.sellerId}, ${input.externalKey}, 'Synthetic Customer', 'test',
      ${input.startedAt ?? null}, 'transcript_ready',
      ${input.sql.json(JSON.parse(JSON.stringify(input.metadata ?? {})))}, now(), now()
    ) returning id
  `;
  assert.equal(rows[0].id, callId);
  await input.sql`
    insert into transcripts (
      id, call_id, version, language, raw_text, normalized_text, content_sha256, source, created_at
    ) values (
      ${transcriptId}, ${callId}, 1, 'pt-BR', 'synthetic raw', 'synthetic normalized',
      ${randomUUID().replaceAll("-", "").padEnd(64, "0")}, 'synthetic_test', now()
    )
  `;
  const analysisJobs = await input.sql<{ id: string }[]>`
    insert into analysis_jobs (call_id, status, stage)
    values (
      ${callId},
      ${input.jobStatus ?? "ready"},
      ${input.jobStatus === "completed" ? "completed" : input.jobStatus === "awaiting_transcript" ? "transcript" : "queue"}
    )
    returning id
  `;
  let pocJobId: string | null = null;
  if (input.pocStatus) {
    const pocJobs = await input.sql<{ id: string }[]>`
      insert into gemini_poc_jobs (call_id, transcript_id, status)
      values (${callId}, ${transcriptId}, ${input.pocStatus})
      returning id
    `;
    pocJobId = pocJobs[0].id;
  }
  return { callId, transcriptId, analysisJobId: analysisJobs[0].id, pocJobId };
}

test("Gemini POC PostgreSQL lifecycle", async (t) => {
  await withIsolatedPostgresTest(async ({ sql, reset }) => {
    await t.test("claims dated calls newest-first, then verified source rows descending", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      const datedOld = await createCallWithTranscript({
        sql, sellerId, externalKey: "dated-old", startedAt: new Date("2026-09-20T00:00:00Z"), pocStatus: "queued",
      });
      const fallbackLow = await createCallWithTranscript({
        sql, sellerId, externalKey: "fallback-low", metadata: { recency_method: "source_row_desc_verified", source_row: "100" }, pocStatus: "queued",
      });
      const datedNew = await createCallWithTranscript({
        sql, sellerId, externalKey: "dated-new", startedAt: new Date("2026-09-21T00:00:00Z"), pocStatus: "queued",
      });
      const fallbackHigh = await createCallWithTranscript({
        sql, sellerId, externalKey: "fallback-high", metadata: { recency_method: "source_row_desc_verified", source_row: "200" }, pocStatus: "queued",
      });

      const claims = [];
      for (const workerId of ["ordering-1", "ordering-2", "ordering-3", "ordering-4"]) {
        const claimed = await claimPocJob(sql, workerId);
        assert.ok(claimed);
        claims.push(claimed.call_id);
      }

      assert.deepEqual(claims, [datedNew.callId, datedOld.callId, fallbackHigh.callId, fallbackLow.callId]);
    });

    await t.test("successful completion synchronizes official state and clears worker error", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      const fixture = await createCallWithTranscript({
        sql, sellerId, externalKey: "completion", startedAt: new Date(), pocStatus: "queued",
      });
      const claimed = await claimPocJob(sql, "completion-worker");
      assert.ok(claimed);
      await failPocJob(sql, "completion-worker", claimed.job_id, "historical_timeout", true);
      await sql`update gemini_poc_jobs set retry_at=now()-interval '1 second' where id=${claimed.job_id}`;
      const reclaimed = await claimPocJob(sql, "completion-worker");
      assert.ok(reclaimed);

      const outcome = await completePocJob(sql, "completion-worker", reclaimed.job_id, validResult, "synthetic raw", 25);
      assert.equal(outcome.success, true);

      const [state] = await sql<{
        poc_status: string;
        job_status: string;
        stage: string;
        worker_id: string | null;
        lease_expires_at: Date | null;
        retry_at: Date | null;
        last_error_code: string | null;
        call_status: string;
        run_status: string;
        is_current: boolean;
        provider: string;
        model: string;
      }[]>`
        select g.status poc_status, j.status job_status, j.stage, j.worker_id, j.lease_expires_at,
          j.retry_at, j.last_error_code, c.status call_status, ar.status run_status, ar.is_current,
          ar.provider, ar.model
        from gemini_poc_jobs g
        join analysis_jobs j on j.call_id=g.call_id
        join calls c on c.id=g.call_id
        join analysis_runs ar on ar.call_id=g.call_id and ar.provider='gemini-web-poc'
        where g.id=${fixture.pocJobId}
      `;
      assert.deepEqual(state, {
        poc_status: "completed",
        job_status: "completed",
        stage: "completed",
        worker_id: null,
        lease_expires_at: null,
        retry_at: null,
        last_error_code: null,
        call_status: "analyzed",
        run_status: "completed",
        is_current: true,
        provider: "gemini-web-poc",
        model: "gemini-workspace-agent",
      });

      const monitor = await getGeminiPocMonitorData(sql);
      assert.equal(monitor.workerList[0].status, "IDLE");
    });

    await t.test("late Gemini completion preserves a different current completed analysis", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      const fixture = await createCallWithTranscript({
        sql, sellerId, externalKey: "completion-race", startedAt: new Date(), pocStatus: "queued",
      });
      const claimed = await claimPocJob(sql, "race-worker");
      assert.ok(claimed);

      const officialRunId = randomUUID();
      await sql`
        insert into analysis_runs (
          id, call_id, transcript_id, provider, model, rubric_version, prompt_version, schema_version,
          status, phase, strategy_version, confidence_policy_version, primary_model, escalation_model,
          confidence_threshold, started_at, finished_at, result_json, analysis_eligibility, is_current
        ) values (
          ${officialRunId}, ${fixture.callId}, ${fixture.transcriptId}, 'vercel-ai-gateway', 'official-newer',
          'insider-demo-v0', 'official-v1', 'v1', 'completed', 'completed', 'official-strategy',
          'official-confidence', 'official-newer', 'official-newer', 0.8, now(), now(), '{}'::jsonb,
          'unscorable', true
        )
      `;

      const outcome = await completePocJob(sql, "race-worker", claimed.job_id, validResult, "synthetic raw", 25);
      assert.equal(outcome.success, true);

      const currentRuns = await sql<{ id: string; provider: string; is_current: boolean }[]>`
        select id, provider, is_current from analysis_runs where call_id=${fixture.callId} order by created_at, id
      `;
      assert.equal(currentRuns.length, 2);
      assert.equal(currentRuns.find((run) => run.id === officialRunId)?.is_current, true);
      assert.equal(currentRuns.find((run) => run.provider === "gemini-web-poc")?.is_current, false);
    });

    await t.test("terminal Gemini jobs are not claimable", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      await createCallWithTranscript({
        sql, sellerId, externalKey: "terminal", startedAt: new Date(), pocStatus: "failed_terminal",
      });
      assert.equal(await claimPocJob(sql, "terminal-worker"), null);
    });

    await t.test("one terminal Gemini failure does not block the next queued call", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      const newest = await createCallWithTranscript({
        sql, sellerId, externalKey: "fails-first", startedAt: new Date("2026-09-22T00:00:00Z"), pocStatus: "queued",
      });
      const next = await createCallWithTranscript({
        sql, sellerId, externalKey: "continues-next", startedAt: new Date("2026-09-21T00:00:00Z"), pocStatus: "queued",
      });

      const first = await claimPocJob(sql, "failure-worker");
      assert.equal(first?.call_id, newest.callId);
      assert.equal(await failPocJob(sql, "failure-worker", first!.job_id, "model_json_parse_failed", false), true);

      const second = await claimPocJob(sql, "failure-worker");
      assert.equal(second?.call_id, next.callId);
    });

    await t.test("feeder uses only official ready jobs and never reopens terminal calls", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      const eligible = await createCallWithTranscript({
        sql, sellerId, externalKey: "eligible", startedAt: new Date("2026-09-21T00:00:00Z"),
      });
      const latestTranscriptId = randomUUID();
      await sql`
        insert into transcripts (
          id, call_id, version, language, raw_text, normalized_text, content_sha256, source, created_at
        ) values (
          ${latestTranscriptId}, ${eligible.callId}, 2, 'pt-BR', 'synthetic raw v2', 'synthetic normalized v2',
          ${"a".repeat(64)}, 'synthetic_test', now()
        )
      `;

      await createCallWithTranscript({
        sql, sellerId, externalKey: "awaiting", startedAt: new Date("2026-09-22T00:00:00Z"), jobStatus: "awaiting_transcript",
      });

      const terminal = await createCallWithTranscript({
        sql, sellerId, externalKey: "terminal-history", startedAt: new Date("2026-09-20T00:00:00Z"), pocStatus: "failed_terminal",
      });
      await sql`
        insert into transcripts (
          id, call_id, version, language, raw_text, normalized_text, content_sha256, source, created_at
        ) values (
          ${randomUUID()}, ${terminal.callId}, 2, 'pt-BR', 'terminal raw v2', 'terminal normalized v2',
          ${"b".repeat(64)}, 'synthetic_test', now()
        )
      `;

      const first = await feedGeminiPocQueue(sql, 50);
      const second = await feedGeminiPocQueue(sql, 50);
      assert.equal(first.enqueued, 1);
      assert.equal(second.enqueued, 0);

      const jobs = await sql<{ call_id: string; transcript_id: string; status: string }[]>`
        select call_id, transcript_id, status from gemini_poc_jobs order by call_id, transcript_id
      `;
      assert.equal(jobs.filter((job) => job.call_id === eligible.callId).length, 1);
      assert.equal(jobs.find((job) => job.call_id === eligible.callId)?.transcript_id, latestTranscriptId);
      assert.equal(jobs.filter((job) => job.call_id === terminal.callId).length, 1);
      assert.equal(jobs.find((job) => job.call_id === terminal.callId)?.status, "failed_terminal");
    });

    await t.test("claim, failure, retry, and completion emit ordered Gemini events", async () => {
      await reset();
      const sellerId = await createSeller(sql);
      await createCallWithTranscript({
        sql, sellerId, externalKey: "ordered-events", startedAt: new Date(), pocStatus: "queued",
      });

      const firstClaim = await claimPocJob(sql, "event-worker");
      assert.ok(firstClaim);
      assert.equal(await failPocJob(sql, "event-worker", firstClaim.job_id, "timeout", true), true);
      await sql`update gemini_poc_jobs set retry_at=now()-interval '1 second' where id=${firstClaim.job_id}`;
      const secondClaim = await claimPocJob(sql, "event-worker");
      assert.ok(secondClaim);
      assert.equal((await completePocJob(sql, "event-worker", secondClaim.job_id, validResult, "raw", 25)).success, true);

      const events = await sql<{ event_type: string }[]>`
        select event_type
        from gemini_poc_job_events
        where job_id=${firstClaim.job_id}
        order by event_id
      `;
      assert.deepEqual(events.map((event) => event.event_type), [
        "claimed",
        "failed_retryable",
        "claimed",
        "completed",
      ]);

      const page = await getGeminiPocEvents(sql, Number((await sql`select min(event_id) event_id from gemini_poc_job_events`)[0].event_id), 10);
      assert.deepEqual(page.events.map((event) => event.eventType), ["failed_retryable", "claimed", "completed"]);
      assert.equal(page.hasMore, false);
      assert.equal(page.nextCursor, Number((await sql`select max(event_id) event_id from gemini_poc_job_events`)[0].event_id));
    });
  });
});
