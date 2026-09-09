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
  summary: { analyzedCalls: number; transcriptCalls: number; sellerCount: number; averageScore: number; topOpportunityLabel: string } | null;
  sellers: Array<{ sellerCode: string | null; sellerName: string; score: number; calls: number }>;
  dimensions: Array<{ key: string; label: string; score: number; calls: number }>;
};

const previewData: DashboardData = { source: "preview", call: null, summary: null, sellers: [], dimensions: [] };

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
    const [rows, summaries, sellers, dimensions] = await Promise.all([sql<
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
        coalesce(ar.final_model, ar.model) as model,
        coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      join transcripts t on t.id = ar.transcript_id
      where ar.status = 'completed' and ar.is_current = true
      order by coalesce(ar.finished_at, ar.created_at) desc
      limit 1
    `, sql<Array<{ analyzed_calls: number; transcript_calls: number; seller_count: number; average_score: string | number; top_opportunity_label: string }>>`
      with official as (
        select ar.*, c.seller_id from analysis_runs ar join calls c on c.id = ar.call_id
        where ar.status = 'completed' and ar.is_current = true
      ), opportunity as (
        select result_json->>'opportunity_quality' quality, count(*) amount
        from official group by 1 order by amount desc, quality limit 1
      )
      select count(*)::integer analyzed_calls,
        (select count(distinct call_id)::integer from transcripts) transcript_calls,
        count(distinct seller_id)::integer seller_count,
        coalesce(round(avg(score)), 0) average_score,
        coalesce((select case quality
          when 'high' then 'Alta' when 'medium' then 'Média' when 'low' then 'Baixa'
          when 'unqualified' then 'Desqualificada' else 'Não identificada' end from opportunity), 'Não disponível') top_opportunity_label
      from official
    `, sql<Array<{ seller_code: string | null; seller_name: string; score: string | number; calls: number }>>`
      select s.seller_code, s.display_name seller_name, round(avg(ar.score)) score, count(*)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      where ar.status='completed' and ar.is_current=true
      group by s.id,s.seller_code,s.display_name order by avg(ar.score) desc,s.display_name
    `, sql<Array<{ key: string; label: string; score: string | number; calls: number }>>`
      select dimension->>'key' key, max(dimension->>'label') label,
        round(avg((dimension->>'score')::numeric)) score, count(*)::integer calls
      from analysis_runs ar cross join lateral jsonb_array_elements(ar.result_json->'dimensions') dimension
      where ar.status='completed' and ar.is_current=true
      group by dimension->>'key' order by avg((dimension->>'score')::numeric) desc
    `]);

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
      summary: {
        analyzedCalls: summaries[0].analyzed_calls,
        transcriptCalls: summaries[0].transcript_calls,
        sellerCount: summaries[0].seller_count,
        averageScore: Number(summaries[0].average_score),
        topOpportunityLabel: summaries[0].top_opportunity_label,
      },
      sellers: sellers.map((seller) => ({ sellerCode: seller.seller_code, sellerName: seller.seller_name, score: Number(seller.score), calls: seller.calls })),
      dimensions: dimensions.map((dimension) => ({ key: dimension.key, label: dimension.label, score: Number(dimension.score), calls: dimension.calls })),
    };
  } catch (error) {
    console.error("Dashboard database read failed", error instanceof Error ? error.message : error);
    return previewData;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
