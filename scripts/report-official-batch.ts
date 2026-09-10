import { chmod, writeFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const outputFile = process.env.OFFICIAL_BATCH_REPORT_FILE;
const strategyVersion = process.env.AI_ANALYSIS_STRATEGY_VERSION ?? "insider-cost-quality-v1";
const confidencePolicyVersion = process.env.CONFIDENCE_POLICY_VERSION ?? "insider-confidence-v2";
const pilotStartedAt = process.env.PILOT_STARTED_AT ? new Date(process.env.PILOT_STARTED_AT) : new Date(0);
const pilotLimit = Math.min(20, Math.max(1, Number(process.env.PILOT_LIMIT ?? "20")));
if (!databaseUrl || !outputFile) throw new Error("DATABASE_URL and OFFICIAL_BATCH_REPORT_FILE are required");
const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });

try {
  const calls = await sql<Array<{
    seller_code: string | null; seller_name: string; transcript_file_id: string; score: string | number | null;
    result_json: Record<string, unknown> | null; status: string; final_model: string | null; input_tokens: number;
    output_tokens: number; cost_usd: string | number | null; latency_ms: number; escalated: boolean; escalation_reasons: string[];
    analysis_eligibility: "scoreable" | "unscorable" | null; schema_failure: boolean;
    primary_cost_usd: string | number; escalation_cost_usd: string | number;
    transcript_characters: number;
  }>>`
    select s.seller_code, s.display_name seller_name, c.transcript_file_id, ar.score,
      ar.result_json, ar.status, coalesce(ar.final_model,ar.model) final_model,
      ar.input_tokens, ar.output_tokens, ar.cost_usd, ar.latency_ms, ar.escalated, ar.escalation_reasons,
      ar.analysis_eligibility,
      exists(select 1 from analysis_attempts aa where aa.analysis_run_id=ar.id and aa.error_code='schema_invalid') schema_failure,
      coalesce((select sum(aa.gateway_actual_cost_usd) from analysis_attempts aa where aa.analysis_run_id=ar.id and aa.role='primary'),0) primary_cost_usd,
      coalesce((select sum(aa.gateway_actual_cost_usd) from analysis_attempts aa where aa.analysis_run_id=ar.id and aa.role='escalation'),0) escalation_cost_usd,
      length(t.normalized_text)::integer transcript_characters
    from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
    join transcripts t on t.id=ar.transcript_id
    where ar.strategy_version=${strategyVersion} and ar.confidence_policy_version=${confidencePolicyVersion}
      and ar.created_at >= ${pilotStartedAt}
    order by ar.created_at
    limit ${pilotLimit}
  `;
  const sellers = await sql`
    select s.seller_code,s.display_name seller_name,count(*)::integer n,round(avg(ar.score)::numeric,2) average_score
    from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
    where ar.strategy_version=${strategyVersion} and ar.status='completed'
    group by s.id,s.seller_code,s.display_name order by s.seller_code
  `;
  const backlog = await sql<{ pending: number }[]>`
    select (count(*)-count(*) filter(where exists(
      select 1 from analysis_runs ar where ar.call_id=c.id and ar.status='completed' and ar.is_current=true
    )))::integer pending from calls c
  `;
  const escalatedCount = calls.filter((row) => row.escalated).length;
  const actualCostUsd = calls.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  const averagePrimaryCostUsd = calls.length ? calls.reduce((sum, row) => sum + Number(row.primary_cost_usd), 0) / calls.length : 0;
  const averageEscalationCostUsd = escalatedCount ? calls.reduce((sum, row) => sum + Number(row.escalation_cost_usd), 0) / escalatedCount : 0;
  const escalationRate = calls.length ? escalatedCount / calls.length : 0;
  const transcriptCharacters = calls.map((row) => row.transcript_characters).sort((a,b) => a-b);
  const payload = {
    generatedAt: new Date().toISOString(),
    strategyVersion,
    confidencePolicyVersion,
    pilotStartedAt: pilotStartedAt.toISOString(),
    pilot: {
      n: calls.length,
      lunaOnly: calls.filter((row) => !row.escalated && row.final_model === "openai/gpt-5.6-luna").length,
      escalated: escalatedCount,
      escalationRate,
      actualCostUsd,
      averageCostPerCallUsd: calls.length ? actualCostUsd / calls.length : 0,
      averagePrimaryCostUsd,
      averageEscalationCostUsd,
      pendingBacklog: backlog[0].pending,
      projectedBacklogCostUsd: backlog[0].pending * (averagePrimaryCostUsd + escalationRate * averageEscalationCostUsd),
      averageTranscriptCharacters: calls.length ? transcriptCharacters.reduce((sum,value) => sum + value,0) / calls.length : 0,
      medianTranscriptCharacters: calls.length ? transcriptCharacters[Math.floor((calls.length-1)/2)] : 0,
      schemaFailures: calls.filter((row) => row.schema_failure).length,
      groundingFailures: calls.filter((row) => row.escalation_reasons.includes("insufficient_grounding")).length,
      unscorable: calls.filter((row) => row.analysis_eligibility === "unscorable").length,
      zeroScores: calls.filter((row) => row.score !== null && Number(row.score) === 0 && row.analysis_eligibility !== "unscorable").length,
      errors: calls.filter((row) => row.status !== "completed").length,
    },
    calls: calls.map((row) => {
      const result = (row.result_json ?? {}) as {
        dimensions?: unknown; strengths?: unknown; critical_failures?: unknown; coaching_actions?: unknown;
      };
      return {
        seller_code: row.seller_code,
        seller_name: row.seller_name,
        transcript_file_id: row.transcript_file_id,
        score: row.score === null ? null : Number(row.score),
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
  console.log(JSON.stringify({ outputFile, calls: calls.length, sellers: sellers.length, pilot: payload.pilot }));
} finally {
  await sql.end();
}
