import { StoredAnalysisOutputSchema, type AnalysisOutput } from "@igd/ai";
import type { AuthorizationContext } from "@igd/auth";
import { ScopedSalesRepository, type AiSpendSummary, type ScopedCallCatalogRow, type ScopedCallRow } from "@igd/db";
import { getSql } from "@/lib/database";

export type DashboardCall = {
  id: string;
  customerName: string | null;
  sellerName: string;
  teamName: string | null;
  product: string;
  startedAt: string | null;
  durationSeconds: number | null;
  score: number | null;
  analysis: AnalysisOutput;
  rubricVersion: string;
  promptVersion: string;
  model: string;
  analyzedAt: string;
};

export type DashboardData = {
  call: DashboardCall | null;
  recentCalls: Array<Pick<DashboardCall, "id" | "customerName" | "sellerName" | "teamName" | "product" | "score" | "startedAt">>;
  summary: { analyzedCalls: number; transcriptCalls: number; sellerCount: number; averageScore: number; topOpportunityLabel: string };
  sellers: Array<{ sellerCode: string | null; sellerName: string; score: number; calls: number }>;
  dimensions: Array<{ key: string; label: string; score: number; calls: number }>;
};

function mapCall(row: ScopedCallRow): DashboardCall {
  return {
    id: row.id,
    customerName: row.customer_name,
    sellerName: row.seller_name,
    teamName: row.team_name,
    product: row.product_key,
    startedAt: row.started_at?.toISOString() ?? null,
    durationSeconds: row.duration_seconds,
    score: row.score === null ? null : Number(row.score),
    analysis: StoredAnalysisOutputSchema.parse(row.result_json),
    rubricVersion: row.rubric_version,
    promptVersion: row.prompt_version,
    model: row.model,
    analyzedAt: row.analyzed_at.toISOString(),
  };
}

export async function getDashboardData(context: AuthorizationContext): Promise<DashboardData> {
  const repository = new ScopedSalesRepository(getSql());
  const [summary, rows, sellers, dimensions] = await Promise.all([
    repository.getDashboardSummary(context),
    repository.listCalls(context, 20),
    repository.listSellerMetrics(context),
    repository.listDimensionMetrics(context),
  ]);
  const calls = rows.map(mapCall);
  return {
    call: calls[0] ?? null,
    recentCalls: calls.map(({ id, customerName, sellerName, teamName, product, score, startedAt }) => ({
      id, customerName, sellerName, teamName, product, score, startedAt,
    })),
    summary: {
      analyzedCalls: summary.analyzed_calls,
      transcriptCalls: summary.transcript_calls,
      sellerCount: summary.seller_count,
      averageScore: Number(summary.average_score),
      topOpportunityLabel: summary.top_opportunity_label,
    },
    sellers: sellers.map((seller) => ({
      sellerCode: seller.seller_code,
      sellerName: seller.seller_name,
      score: Number(seller.score),
      calls: seller.calls,
    })),
    dimensions: dimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      score: Number(dimension.score),
      calls: dimension.calls,
    })),
  };
}

export async function getScopedCall(context: AuthorizationContext, callId: string): Promise<DashboardCall | null> {
  const row = await new ScopedSalesRepository(getSql()).getCallById(context, callId);
  return row ? mapCall(row) : null;
}

export type CallCatalogItem = {
  id: string; customerName: string | null; sellerName: string; sellerCode: string | null; teamName: string | null;
  product: string; startedAt: string | null; durationSeconds: number | null; origin: string | null;
  transcriptStatus: "available" | "awaiting" | "access_issue"; analysisStatus: string; score: number | null;
  analysisEligibility: "scoreable" | "unscorable" | null; finalModel: string | null; escalated: boolean;
  analyzedAt: string | null;
};

export type CallDetail = CallCatalogItem & {
  analysis: AnalysisOutput | null; escalationReasons: string[]; rubricVersion: string | null;
  promptVersion: string | null; schemaVersion: string | null; confidencePolicyVersion: string | null;
  latencyMs: number | null; costUsd: number | null; humanReviewRequested: boolean;
  unscorableReason: string | null;
  attempts: Array<{ role: string; attemptNumber: number; model: string; provider: string; status: string; costUsd: number | null; latencyMs: number | null; requestedAt: string; errorCode: string | null }>;
};

function mapCatalog(row: ScopedCallCatalogRow): CallCatalogItem {
  return {
    id: row.id, customerName: row.customer_name, sellerName: row.seller_name, sellerCode: row.seller_code,
    teamName: row.team_name, product: row.product_key, startedAt: row.started_at?.toISOString() ?? null,
    durationSeconds: row.duration_seconds, origin: row.origin, transcriptStatus: row.transcript_status,
    analysisStatus: row.analysis_status, score: row.score === null ? null : Number(row.score),
    analysisEligibility: row.analysis_eligibility, finalModel: row.final_model, escalated: row.escalated ?? false,
    analyzedAt: row.analyzed_at?.toISOString() ?? null,
  };
}

export async function getCallCatalogPage(context: AuthorizationContext, page: number, pageSize = 50) {
  const result = await new ScopedSalesRepository(getSql()).listCallCatalog(context, { page, pageSize });
  return { calls: result.rows.map(mapCatalog), total: result.total, page, pageSize, pages: Math.max(1, Math.ceil(result.total / pageSize)) };
}

export async function getCallDetail(context: AuthorizationContext, callId: string): Promise<CallDetail | null> {
  const repository = new ScopedSalesRepository(getSql());
  const [row, attempts] = await Promise.all([
    repository.getCatalogCallById(context, callId),
    repository.listAnalysisAttempts(context, callId),
  ]);
  if (!row) return null;
  return {
    ...mapCatalog(row),
    analysis: row.result_json ? StoredAnalysisOutputSchema.parse(row.result_json) : null,
    escalationReasons: row.escalation_reasons ?? [], rubricVersion: row.rubric_version,
    promptVersion: row.prompt_version, schemaVersion: row.schema_version,
    confidencePolicyVersion: row.confidence_policy_version, latencyMs: row.latency_ms,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    humanReviewRequested: row.human_review_requested ?? false, unscorableReason: row.unscorable_reason,
    attempts: attempts.map((attempt) => ({
      role: attempt.role, attemptNumber: attempt.attempt_number, model: attempt.model, provider: attempt.provider,
      status: attempt.status, costUsd: attempt.gateway_actual_cost_usd === null ? null : Number(attempt.gateway_actual_cost_usd),
      latencyMs: attempt.latency_ms, requestedAt: attempt.requested_at.toISOString(), errorCode: attempt.error_code,
    })),
  };
}

export async function getCallTranscript(context: AuthorizationContext, callId: string): Promise<string | null> {
  return new ScopedSalesRepository(getSql()).getCallTranscript(context, callId);
}

export async function getProgressData(context: AuthorizationContext) {
  const repository = new ScopedSalesRepository(getSql());
  const [progress, active] = await Promise.all([repository.getBacklogProgress(context), repository.listActiveAnalyses(context)]);
  return {
    progress: {
      total: progress.total, analyzed: progress.analyzed, processing: progress.processing, pending: progress.pending,
      awaitingTranscript: progress.awaiting_transcript, accessIssue: progress.access_issue,
      associationReview: progress.association_review, failed: progress.failed, quarantine: progress.quarantine,
      stages: {
        transcript: progress.stage_transcript, queue: progress.stage_queue, primary: progress.stage_primary,
        validation: progress.stage_validation, escalation: progress.stage_escalation,
        finalization: progress.stage_finalization, completed: progress.stage_completed,
      },
    },
    active: active.map((item) => ({ callId: item.call_id, sellerName: item.seller_name, stage: item.stage, model: item.model, startedAt: item.started_at?.toISOString() ?? null })),
  };
}

export async function getAiSpendData(context: AuthorizationContext): Promise<AiSpendSummary> {
  return new ScopedSalesRepository(getSql()).getAiSpendSummary(context, {
    accountId: process.env.AI_BUDGET_ACCOUNT_ID ?? "sales-intelligence-igd",
    strategyVersion: process.env.AI_ANALYSIS_STRATEGY_VERSION ?? "insider-cost-quality-v1",
    confidencePolicyVersion: "insider-confidence-v2",
  });
}
