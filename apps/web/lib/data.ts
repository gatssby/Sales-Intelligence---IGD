import { AnalysisOutputSchema, type AnalysisOutput } from "@igd/ai";
import type { AuthorizationContext } from "@igd/auth";
import { ScopedSalesRepository, type ScopedCallRow } from "@igd/db";
import { getSql } from "@/lib/database";

export type DashboardCall = {
  id: string;
  customerName: string | null;
  sellerName: string;
  teamName: string | null;
  product: string;
  startedAt: string | null;
  durationSeconds: number | null;
  transcript: string;
  score: number;
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
    transcript: row.normalized_text,
    score: Number(row.score),
    analysis: AnalysisOutputSchema.parse(row.result_json),
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
