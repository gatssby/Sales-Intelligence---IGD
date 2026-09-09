import postgres from "postgres";
import { AnalysisOutputSchema, type AnalysisOutput } from "@igd/ai";

export type DashboardCall = {
  id: string;
  customerName: string | null;
  sellerName: string;
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
  source: "postgres" | "preview";
  call: DashboardCall | null;
};

const previewData: DashboardData = { source: "preview", call: null };

export async function getDashboardData(): Promise<DashboardData> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return previewData;

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
  });

  try {
    const rows = await sql<
      Array<{
        id: string;
        customer_name: string | null;
        seller_name: string;
        product_key: string;
        started_at: Date | null;
        duration_seconds: number | null;
        normalized_text: string;
        score: string | number;
        result_json: unknown;
        rubric_version: string;
        prompt_version: string;
        model: string;
        analyzed_at: Date;
      }>
    >`
      select
        c.id,
        c.customer_name,
        s.display_name as seller_name,
        c.product_key,
        c.started_at,
        c.duration_seconds,
        t.normalized_text,
        ar.score,
        ar.result_json,
        ar.rubric_version,
        ar.prompt_version,
        ar.model,
        coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      join transcripts t on t.id = ar.transcript_id
      where ar.status = 'completed' and ar.is_current = true
      order by coalesce(ar.finished_at, ar.created_at) desc
      limit 1
    `;

    const row = rows[0];
    if (!row) return previewData;

    return {
      source: "postgres",
      call: {
        id: row.id,
        customerName: row.customer_name,
        sellerName: row.seller_name,
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
      },
    };
  } catch (error) {
    console.error("Dashboard database read failed", error instanceof Error ? error.message : error);
    return previewData;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
