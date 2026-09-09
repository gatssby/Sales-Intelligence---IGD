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
  metrics: {
    analyzedCalls: number;
    sellerCount: number;
    teamCount: number;
    productCount: number;
    averageScore: number | null;
  };
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
  const [metrics, rows] = await Promise.all([repository.getMetrics(context), repository.listCalls(context, 20)]);
  const calls = rows.map(mapCall);
  return {
    call: calls[0] ?? null,
    recentCalls: calls.map(({ id, customerName, sellerName, teamName, product, score, startedAt }) => ({
      id,
      customerName,
      sellerName,
      teamName,
      product,
      score,
      startedAt,
    })),
    metrics: {
      analyzedCalls: metrics.analyzed_calls,
      sellerCount: metrics.seller_count,
      teamCount: metrics.team_count,
      productCount: metrics.product_count,
      averageScore: metrics.average_score === null ? null : Number(metrics.average_score),
    },
  };
}

export async function getScopedCall(context: AuthorizationContext, callId: string): Promise<DashboardCall | null> {
  const row = await new ScopedSalesRepository(getSql()).getCallById(context, callId);
  return row ? mapCall(row) : null;
}
