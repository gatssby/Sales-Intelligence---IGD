import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { PostgresBudgetLedger, PostgresIngestionRepository, PostgresOfficialAnalysisLifecycle } from "../src/index";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function assertIsolatedDatabase(url: string): void {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("integration_test_database_must_be_local");
  if (!parsed.pathname.endsWith("_test")) throw new Error("integration_test_database_name_must_end_in_test");
}

integration("global budget and official lifecycle remain safe across workers and restarts", async (t) => {
  assertIsolatedDatabase(databaseUrl!);
  const adminSql = postgres(databaseUrl!, { max: 1 });
  const schema = `lifecycle_${randomUUID().replaceAll("-", "")}`;
  await adminSql.unsafe(`create schema ${schema}`);
  await adminSql.unsafe(`set search_path to ${schema}, public`);
  const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await adminSql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
  const sql = postgres(scopedUrl.toString(), { max: 10 });

  try {
    await t.test("two workers cannot reserve beyond the shared ceiling", async () => {
      const ledger = new PostgresBudgetLedger(sql);
      await ledger.configureAccount({
        accountId: "sales-intelligence-igd",
        limitUsd: 15,
        safetyReserveUsd: 3,
        externalSpendBaselineUsd: 5.9,
      });
      const ownerA = randomUUID();
      const ownerB = randomUUID();
      const results = await Promise.all([
        ledger.reserve({ accountId: "sales-intelligence-igd", ownerType: "official", ownerId: ownerA, requestKey: "primary:1", role: "primary", model: "openai/gpt-5.6-luna", estimatedCostUsd: 4 }),
        ledger.reserve({ accountId: "sales-intelligence-igd", ownerType: "official", ownerId: ownerB, requestKey: "primary:1", role: "primary", model: "openai/gpt-5.6-luna", estimatedCostUsd: 4 }),
      ]);
      assert.equal(results.filter((result) => result.accepted).length, 1);
      assert.equal(results.filter((result) => !result.accepted && result.reason === "budget_ceiling").length, 1);
      assert.equal((await ledger.snapshot("sales-intelligence-igd")).projectedSpendUsd, 9.9);
    });

    await t.test("settlement releases unused reservation and stale requests stay conservative", async () => {
      const ledger = new PostgresBudgetLedger(sql);
      const accountId = "sales-intelligence-igd-settlement";
      await ledger.configureAccount({ accountId, limitUsd: 15, safetyReserveUsd: 3, externalSpendBaselineUsd: 5.9 });
      const held = await ledger.reserve({ accountId, ownerType: "official", ownerId: randomUUID(), requestKey: "primary:1", role: "primary", model: "openai/gpt-5.6-luna", estimatedCostUsd: 1 });
      assert.equal(held.accepted, true);
      await ledger.markRequestStarted(held.reservationId!);
      await ledger.settle(held.reservationId!, { actualCostUsd: 0.25, costSource: "gateway_actual" });
      assert.equal((await ledger.snapshot(accountId)).settledIncrementalUsd, 0.25);

      const unknown = await ledger.reserve({ accountId, ownerType: "official", ownerId: randomUUID(), requestKey: "primary:1", role: "primary", model: "openai/gpt-5.6-luna", estimatedCostUsd: 0.5 });
      await ledger.markRequestStarted(unknown.reservationId!);
      const recovery = await ledger.recoverStaleReservations(accountId, new Date(Date.now() + 60_000));
      assert.equal(recovery.outcomeUnknown, 1);
      assert.equal((await ledger.snapshot(accountId)).activeReservationsUsd >= 0.5, true);
    });

    await t.test("live spend reconciliation advances the global floor without double-counting receipts", async () => {
      const ledger = new PostgresBudgetLedger(sql);
      const accountId = "sales-intelligence-igd-live";
      await ledger.configureAccount({ accountId, limitUsd: 15, safetyReserveUsd: 3, externalSpendBaselineUsd: 5.9 });
      const reservation = await ledger.reserve({
        accountId, ownerType: "official", ownerId: randomUUID(), requestKey: "primary:live",
        role: "primary", model: "openai/gpt-5.6-luna", estimatedCostUsd: 0.5,
      });
      await ledger.markRequestStarted(reservation.reservationId!);
      await ledger.settle(reservation.reservationId!, { actualCostUsd: 0.25, costSource: "gateway_actual" });
      await ledger.reconcileLiveSpend(accountId, 6.5);
      assert.equal((await ledger.snapshot(accountId)).projectedSpendUsd, 6.5);
      await ledger.reconcileLiveSpend(accountId, 6.2);
      assert.equal((await ledger.snapshot(accountId)).projectedSpendUsd, 6.5);
    });

    await t.test("the ingestion queue writes only the durable analysis job", async () => {
      const sellers = await sql<{ id: string }[]>`
        insert into sellers (display_name, external_reference, seller_code, product, active)
        values ('Queue Seller Synthetic', 'SYN-QUEUE', 'V9899', 'INSIDER', true) returning id
      `;
      const calls = await sql<{ id: string }[]>`
        insert into calls (seller_id, external_key, customer_name, product_key, started_at, status, transcript_file_id)
        values (${sellers[0].id}, 'synthetic-queue', 'Synthetic Customer', 'insider', now(), 'transcript_ready', 'syntheticTranscript9899') returning id
      `;
      await sql`
        insert into transcripts (call_id, raw_text, normalized_text, content_sha256, source)
        values (${calls[0].id}, 'Synthetic queue transcript', 'Synthetic queue transcript', ${"7".repeat(64)}, 'synthetic_test')
      `;
      const repository = new PostgresIngestionRepository(scopedUrl.toString());
      try {
        assert.deepEqual(await repository.queueAnalysis(calls[0].id), { queued: true });
      } finally {
        await repository.close();
      }
      const rows = await sql<{ jobs: number; runs: number }[]>`
        select (select count(*)::integer from analysis_jobs where call_id=${calls[0].id}) jobs,
          (select count(*)::integer from analysis_runs where call_id=${calls[0].id}) runs
      `;
      assert.deepEqual(rows[0], { jobs: 1, runs: 0 });
      await sql`update analysis_jobs set status='quarantine' where call_id=${calls[0].id}`;
    });

    await t.test("a second worker cannot claim the same call", async () => {
      const sellers = await sql<{ id: string }[]>`
        insert into sellers (display_name, external_reference, seller_code, product, active)
        values ('Seller Synthetic', 'SYN-LIFE', 'V9900', 'INSIDER', true) returning id
      `;
      const calls = await sql<{ id: string }[]>`
        insert into calls (seller_id, external_key, product_key, status, transcript_file_id)
        values (${sellers[0].id}, 'synthetic-lifecycle', 'insider', 'transcript_ready', 'syntheticTranscript9900') returning id
      `;
      await sql`
        insert into transcripts (call_id, raw_text, normalized_text, content_sha256, source)
        values (${calls[0].id}, 'Synthetic transcript', 'Synthetic transcript', ${"9".repeat(64)}, 'synthetic_test')
      `;
      const lifecycle = new PostgresOfficialAnalysisLifecycle(sql);
      await lifecycle.syncCatalog();
      const strategy = {
        strategyVersion: "insider-cost-quality-v1",
        confidencePolicyVersion: "insider-confidence-v2",
        primaryModel: "openai/gpt-5.6-luna",
        escalationModel: "openai/gpt-5.6-sol",
        rubricVersion: "insider-production-v1",
        promptVersion: "call-analysis-v1",
        schemaVersion: "analysis-output-v1",
        confidenceThreshold: 0.5,
      };
      const claims = await Promise.all([
        lifecycle.claimNext({ workerId: "worker-a", leaseSeconds: 300, strategy }),
        lifecycle.claimNext({ workerId: "worker-b", leaseSeconds: 300, strategy }),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal(claims.find(Boolean)?.callId, calls[0].id);
      const claimed = claims.find(Boolean)!;
      assert.equal(await lifecycle.renewClaim({ jobId: claimed.jobId, workerId: claimed.workerId, leaseSeconds: 300 }), true);
      assert.deepEqual(await lifecycle.recoverExpiredClaims(new Date(Date.now() + 60_000)), { finalized: 0, resumed: 0, outcomeUnknown: 0 });
    });

    await t.test("transcript fetch is single-claim, restart-safe, and retry-bounded", async () => {
      const sellers = await sql<{ id: string }[]>`
        insert into sellers (display_name, external_reference, seller_code, product, active)
        values ('Transcript Seller Synthetic', 'SYN-TRANSCRIPT', 'V9901', 'INSIDER', true) returning id
      `;
      const calls = await sql<{ id: string }[]>`
        insert into calls (seller_id, external_key, product_key, status, transcript_file_id)
        values (${sellers[0].id}, 'synthetic-transcript-fetch', 'insider', 'metadata_ready', 'syntheticTranscript9901') returning id
      `;
      const lifecycle = new PostgresOfficialAnalysisLifecycle(sql);
      await lifecycle.syncCatalog();
      const claims = await Promise.all([
        lifecycle.claimNextTranscript({ workerId: "transcript-worker-a", leaseSeconds: 300 }),
        lifecycle.claimNextTranscript({ workerId: "transcript-worker-b", leaseSeconds: 300 }),
      ]);
      const claimed = claims.find(Boolean);
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal(claimed?.callId, calls[0].id);

      await sql`
        insert into transcripts (call_id, raw_text, normalized_text, content_sha256, source)
        values (${calls[0].id}, 'Synthetic fetched transcript', 'Synthetic fetched transcript', ${"8".repeat(64)}, 'synthetic_test')
      `;
      assert.deepEqual(
        await lifecycle.recoverExpiredTranscriptClaims(new Date(Date.now() + 10 * 60_000)),
        { ready: 1, resumed: 0 },
      );
      const recovered = await sql<{ status: string; stage: string }[]>`
        select status, stage from analysis_jobs where call_id=${calls[0].id}
      `;
      assert.deepEqual(recovered[0], { status: "ready", stage: "queue" });

      const terminalCalls = await sql<{ id: string }[]>`
        insert into calls (seller_id, external_key, product_key, status, transcript_file_id)
        values (${sellers[0].id}, 'synthetic-transcript-terminal', 'insider', 'metadata_ready', 'syntheticTranscript9902') returning id
      `;
      await lifecycle.syncCatalog();
      const terminalClaim = await lifecycle.claimNextTranscript({ workerId: "transcript-worker-c", leaseSeconds: 300 });
      assert.equal(terminalClaim?.callId, terminalCalls[0].id);
      assert.equal(await lifecycle.recordTranscriptFailure({
        jobId: terminalClaim!.jobId,
        callId: terminalClaim!.callId,
        errorCode: "transcript_access_denied",
        maxAttempts: 1,
        retryDelaySeconds: 60,
      }), "failed_terminal");
    });

    await t.test("restart finalizes a settled attempt without another provider request", async () => {
      const lifecycle = new PostgresOfficialAnalysisLifecycle(sql);
      const claimed = await lifecycle.getClaimedByWorker("worker-a") ?? await lifecycle.getClaimedByWorker("worker-b");
      assert.ok(claimed);
      const output = {
        overall_score: 78,
        scoreability: "scoreable" as const,
        unscorable_reason: null,
        opportunity_quality: "medium" as const,
        opportunity_quality_label: "Synthetic",
        call_outcome: "follow_up" as const,
        call_outcome_label: "Synthetic",
        confidence: 0.9,
        executive_summary: "Synthetic summary.",
        strengths: [], critical_failures: [], objections: [], coaching_actions: [], dimensions: [], evidence: [],
        requires_human_review: false,
      };
      const ledger = new PostgresBudgetLedger(sql);
      const accountId = "sales-intelligence-igd-lifecycle";
      await ledger.configureAccount({ accountId, limitUsd: 15, safetyReserveUsd: 3, externalSpendBaselineUsd: 5.9 });
      const reservation = await ledger.reserve({
        accountId, ownerType: "official", ownerId: claimed!.runId, requestKey: "primary:restart-test",
        role: "primary", model: "openai/gpt-5.6-luna", estimatedCostUsd: 0.25,
      });
      assert.equal(reservation.accepted, true);
      await ledger.markRequestStarted(reservation.reservationId!);
      await lifecycle.recordAttempt({
        jobId: claimed!.jobId,
        runId: claimed!.runId,
        budgetReservationId: reservation.reservationId!,
        attempt: {
          status: "completed", role: "primary", model: "openai/gpt-5.6-luna", provider: "openai",
          output, qualitySignals: { evidenceGroundingRate: 1, dimensionCoverageRate: 1, scoreDimensionDelta: 0 },
          inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, costUsd: 0.02,
          gatewayActualCostUsd: 0.02, estimatedCostUsd: 0.021, costSource: "gateway_actual",
          latencyMs: 120, requestedAt: new Date().toISOString(),
        },
        finalCandidate: true,
        confidencePolicyVersion: "insider-confidence-v2",
      });
      const recovery = await lifecycle.recoverExpiredClaims(new Date(Date.now() + 10 * 60_000));
      assert.deepEqual(recovery, { finalized: 1, resumed: 0, outcomeUnknown: 0 });
      const current = await sql<{ status: string; is_current: boolean; score: string | number | null }[]>`
        select status, is_current, score from analysis_runs where id=${claimed!.runId}
      `;
      assert.deepEqual({ status: current[0].status, current: current[0].is_current, score: Number(current[0].score) }, { status: "completed", current: true, score: 78 });
    });
  } finally {
    await sql.end();
    await adminSql.unsafe(`drop schema ${schema} cascade`);
    await adminSql.end();
  }
});
