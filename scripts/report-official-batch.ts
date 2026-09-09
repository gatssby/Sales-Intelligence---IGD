import { chmod, writeFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const outputFile = process.env.OFFICIAL_BATCH_REPORT_FILE;
const strategyVersion = process.env.AI_ANALYSIS_STRATEGY_VERSION ?? "insider-cost-quality-v1";
if (!databaseUrl || !outputFile) throw new Error("DATABASE_URL and OFFICIAL_BATCH_REPORT_FILE are required");
const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });

try {
  const calls = await sql<Array<{
    seller_code: string | null; seller_name: string; transcript_file_id: string; score: string | number;
    result_json: Record<string, unknown>; status: string; final_model: string; input_tokens: number;
    output_tokens: number; cost_usd: string | number; latency_ms: number; escalated: boolean; escalation_reasons: string[];
  }>>`
    select s.seller_code, s.display_name seller_name, c.transcript_file_id, ar.score,
      ar.result_json, ar.status, coalesce(ar.final_model,ar.model) final_model,
      ar.input_tokens, ar.output_tokens, ar.cost_usd, ar.latency_ms, ar.escalated, ar.escalation_reasons
    from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
    where ar.strategy_version=${strategyVersion}
    order by ar.created_at
  `;
  const sellers = await sql`
    select s.seller_code,s.display_name seller_name,count(*)::integer n,round(avg(ar.score)::numeric,2) average_score
    from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
    where ar.strategy_version=${strategyVersion} and ar.status='completed'
    group by s.id,s.seller_code,s.display_name order by s.seller_code
  `;
  const payload = {
    generatedAt: new Date().toISOString(),
    strategyVersion,
    calls: calls.map((row) => {
      const result = row.result_json as {
        dimensions?: unknown; strengths?: unknown; critical_failures?: unknown; coaching_actions?: unknown;
      };
      return {
        seller_code: row.seller_code,
        seller_name: row.seller_name,
        transcript_file_id: row.transcript_file_id,
        score: Number(row.score),
        dimensions: result.dimensions,
        strengths: result.strengths,
        critical_failures: result.critical_failures,
        coaching_actions: result.coaching_actions,
        status: row.status,
        final_model: row.final_model,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cost_usd: Number(row.cost_usd),
        latency_ms: row.latency_ms,
        escalated: row.escalated,
        escalation_reasons: row.escalation_reasons,
      };
    }),
    sellers,
  };
  await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputFile, 0o600);
  console.log(JSON.stringify({ outputFile, calls: calls.length, sellers: sellers.length }));
} finally {
  await sql.end();
}
