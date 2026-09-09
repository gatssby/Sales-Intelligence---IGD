import type { AuthorizationContext, Capability } from "@igd/auth";
import { assertCapability } from "@igd/auth";
import type { PendingQuery, Sql } from "postgres";

export type ScopedCallRow = {
  id: string;
  customer_name: string | null;
  seller_name: string;
  team_id: string | null;
  team_name: string | null;
  product_key: string;
  started_at: Date | null;
  duration_seconds: number | null;
  score: string | number | null;
  result_json: unknown;
  rubric_version: string;
  prompt_version: string;
  model: string;
  analyzed_at: Date;
};

export type ScopedCallCatalogRow = {
  id: string; customer_name: string | null; seller_name: string; seller_code: string | null;
  team_name: string | null; product_key: string; started_at: Date | null; duration_seconds: number | null;
  origin: string | null; transcript_status: "available" | "awaiting" | "access_issue";
  analysis_status: string; score: string | number | null; analysis_eligibility: "scoreable" | "unscorable" | null;
  result_json: unknown | null; final_model: string | null; escalated: boolean | null; escalation_reasons: string[] | null;
  analyzed_at: Date | null; rubric_version: string | null; prompt_version: string | null; schema_version: string | null;
  confidence_policy_version: string | null; latency_ms: number | null; cost_usd: string | number | null;
  human_review_requested: boolean | null; unscorable_reason: string | null;
};

export type ScopedBacklogProgress = {
  total: number; analyzed: number; processing: number; pending: number; awaiting_transcript: number;
  access_issue: number; association_review: number; failed: number; quarantine: number;
  stage_transcript: number; stage_queue: number; stage_primary: number; stage_validation: number;
  stage_escalation: number; stage_finalization: number; stage_completed: number;
};

export type ScopedActiveAnalysis = {
  call_id: string; seller_name: string; stage: string; model: string | null; started_at: Date | null;
};

export type ScopedAnalysisAttempt = {
  role: string; attempt_number: number; model: string; provider: string; status: string;
  gateway_actual_cost_usd: string | number | null; latency_ms: number | null; requested_at: Date; error_code: string | null;
};

export type ScopedMetrics = {
  analyzed_calls: number;
  seller_count: number;
  team_count: number;
  product_count: number;
  average_score: string | number | null;
};

export type ScopedDashboardSummary = {
  analyzed_calls: number;
  transcript_calls: number;
  seller_count: number;
  average_score: string | number;
  top_opportunity_label: string;
};

export type ScopedSellerMetric = {
  seller_code: string | null;
  seller_name: string;
  score: string | number;
  calls: number;
};

export type ScopedDimensionMetric = {
  key: string;
  label: string;
  score: string | number;
  calls: number;
};

function scopePredicate(sql: Sql, context: AuthorizationContext): PendingQuery<never[]> {
  if (context.scope.kind === "GLOBAL") return sql`true`;
  if (context.scope.kind === "TEAMS") {
    if (context.scope.teamIds.length === 0) return sql`false`;
    return sql`s.team_id in ${sql(context.scope.teamIds)}`;
  }
  if (context.scope.productKeys.length === 0) return sql`false`;
  return sql`lower(c.product_key) in ${sql(context.scope.productKeys)}`;
}

export class ScopedSalesRepository {
  constructor(readonly sql: Sql) {}

  private require(context: AuthorizationContext, capability: Capability): void {
    assertCapability(context, capability);
  }

  async getMetrics(context: AuthorizationContext): Promise<ScopedMetrics> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const rows = await this.sql<ScopedMetrics[]>`
      select
        count(*)::integer as analyzed_calls,
        count(distinct c.seller_id)::integer as seller_count,
        count(distinct s.team_id)::integer as team_count,
        count(distinct lower(c.product_key))::integer as product_count,
        round(avg(ar.score), 2) as average_score
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      where ar.status = 'completed' and ar.is_current = true and ${predicate}
    `;
    return rows[0];
  }

  async getDashboardSummary(context: AuthorizationContext): Promise<ScopedDashboardSummary> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const rows = await this.sql<ScopedDashboardSummary[]>`
      with scoped_calls as (
        select c.id, c.seller_id
        from calls c join sellers s on s.id = c.seller_id
        where ${predicate}
      ), official as (
        select ar.*, scoped_calls.seller_id
        from analysis_runs ar join scoped_calls on scoped_calls.id = ar.call_id
        where ar.status = 'completed' and ar.is_current = true
      ), opportunity as (
        select result_json->>'opportunity_quality' quality, count(*) amount
        from official group by 1 order by amount desc, quality limit 1
      )
      select count(*)::integer analyzed_calls,
        (select count(distinct t.call_id)::integer from transcripts t join scoped_calls on scoped_calls.id = t.call_id) transcript_calls,
        count(distinct seller_id)::integer seller_count,
        coalesce(round(avg(score)), 0) average_score,
        coalesce((select case quality
          when 'high' then 'Alta' when 'medium' then 'Média' when 'low' then 'Baixa'
          when 'unqualified' then 'Desqualificada' else 'Não identificada' end from opportunity), 'Não disponível') top_opportunity_label
      from official
    `;
    return rows[0];
  }

  async listSellerMetrics(context: AuthorizationContext): Promise<ScopedSellerMetric[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    return this.sql<ScopedSellerMetric[]>`
      select s.seller_code, s.display_name seller_name, round(avg(ar.score)) score, count(ar.score)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      where ar.status='completed' and ar.is_current=true and ${predicate}
      group by s.id,s.seller_code,s.display_name order by avg(ar.score) desc,s.display_name
    `;
  }

  async listDimensionMetrics(context: AuthorizationContext): Promise<ScopedDimensionMetric[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    return this.sql<ScopedDimensionMetric[]>`
      select dimension->>'key' key, max(dimension->>'label') label,
        round(avg((dimension->>'score')::numeric)) score, count(*)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      cross join lateral jsonb_array_elements(ar.result_json->'dimensions') dimension
      where ar.status='completed' and ar.is_current=true and ar.score is not null and ${predicate}
      group by dimension->>'key' order by avg((dimension->>'score')::numeric) desc
    `;
  }

  async listCalls(context: AuthorizationContext, limit = 50): Promise<ScopedCallRow[]> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    return this.sql<ScopedCallRow[]>`
      select
        c.id, c.customer_name, s.display_name as seller_name, s.team_id,
        tteam.display_name as team_name, c.product_key, c.started_at, c.duration_seconds,
        ar.score, ar.result_json, ar.rubric_version,
        ar.prompt_version, ar.model, coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      left join teams tteam on tteam.id = s.team_id
      where ar.status = 'completed' and ar.is_current = true and ar.score is not null and ${predicate}
      order by coalesce(ar.finished_at, ar.created_at) desc
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  async getCallById(context: AuthorizationContext, callId: string): Promise<ScopedCallRow | null> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const rows = await this.sql<ScopedCallRow[]>`
      select
        c.id, c.customer_name, s.display_name as seller_name, s.team_id,
        tteam.display_name as team_name, c.product_key, c.started_at, c.duration_seconds,
        ar.score, ar.result_json, ar.rubric_version,
        ar.prompt_version, ar.model, coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      left join teams tteam on tteam.id = s.team_id
      where c.id = ${callId}
        and ar.status = 'completed' and ar.is_current = true and ${predicate}
      limit 1
    `;
    return rows[0] ?? null;
  }

  async listCallCatalog(context: AuthorizationContext, options: { page: number; pageSize: number }): Promise<{ rows: ScopedCallCatalogRow[]; total: number }> {
    this.require(context, "calls:read");
    const page = Math.max(1, Math.trunc(options.page));
    const pageSize = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = (page - 1) * pageSize;
    const predicate = scopePredicate(this.sql, context);
    const [rows, totals] = await Promise.all([
      this.sql<ScopedCallCatalogRow[]>`
        select c.id, c.customer_name, s.display_name seller_name, s.seller_code,
          coalesce(t.display_name,s.team_name) team_name, c.product_key, c.started_at, c.duration_seconds, c.origin,
          case when c.status in ('failed_retryable','failed_permanent') then 'access_issue'
            when exists(select 1 from transcripts tr where tr.call_id=c.id) then 'available' else 'awaiting' end transcript_status,
          case when ar.id is not null then 'completed' else coalesce(j.status,'awaiting_transcript') end analysis_status,
          ar.score, ar.analysis_eligibility, ar.result_json, coalesce(ar.final_model,ar.model) final_model,
          ar.escalated, ar.escalation_reasons, coalesce(ar.finished_at,ar.created_at) analyzed_at,
          ar.rubric_version, ar.prompt_version, ar.schema_version, ar.confidence_policy_version,
          ar.latency_ms, ar.cost_usd, ar.human_review_requested, ar.unscorable_reason
        from calls c join sellers s on s.id=c.seller_id
        left join teams t on t.id=s.team_id
        left join analysis_jobs j on j.call_id=c.id
        left join analysis_runs ar on ar.call_id=c.id and ar.status='completed' and ar.is_current=true
        where ${predicate}
        order by coalesce(c.started_at,c.created_at) desc,c.id desc
        limit ${pageSize} offset ${offset}
      `,
      this.sql<{ total: number }[]>`
        select count(*)::integer total from calls c join sellers s on s.id=c.seller_id where ${predicate}
      `,
    ]);
    return { rows, total: totals[0].total };
  }

  async getCatalogCallById(context: AuthorizationContext, callId: string): Promise<ScopedCallCatalogRow | null> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const rows = await this.sql<ScopedCallCatalogRow[]>`
      select c.id, c.customer_name, s.display_name seller_name, s.seller_code,
        coalesce(t.display_name,s.team_name) team_name, c.product_key, c.started_at, c.duration_seconds, c.origin,
        case when c.status in ('failed_retryable','failed_permanent') then 'access_issue'
          when exists(select 1 from transcripts tr where tr.call_id=c.id) then 'available' else 'awaiting' end transcript_status,
        case when ar.id is not null then 'completed' else coalesce(j.status,'awaiting_transcript') end analysis_status,
        ar.score, ar.analysis_eligibility, ar.result_json, coalesce(ar.final_model,ar.model) final_model,
        ar.escalated, ar.escalation_reasons, coalesce(ar.finished_at,ar.created_at) analyzed_at,
        ar.rubric_version, ar.prompt_version, ar.schema_version, ar.confidence_policy_version,
        ar.latency_ms, ar.cost_usd, ar.human_review_requested, ar.unscorable_reason
      from calls c join sellers s on s.id=c.seller_id
      left join teams t on t.id=s.team_id
      left join analysis_jobs j on j.call_id=c.id
      left join analysis_runs ar on ar.call_id=c.id and ar.status='completed' and ar.is_current=true
      where c.id=${callId} and ${predicate} limit 1
    `;
    return rows[0] ?? null;
  }

  async getCallTranscript(context: AuthorizationContext, callId: string): Promise<string | null> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const rows = await this.sql<{ normalized_text: string }[]>`
      select tr.normalized_text from calls c join sellers s on s.id=c.seller_id
      join lateral (select normalized_text from transcripts where call_id=c.id order by version desc limit 1) tr on true
      where c.id=${callId} and ${predicate}
    `;
    return rows[0]?.normalized_text ?? null;
  }

  async getBacklogProgress(context: AuthorizationContext): Promise<ScopedBacklogProgress> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const globalQuarantine = context.scope.kind === "GLOBAL";
    const rows = await this.sql<ScopedBacklogProgress[]>`
      with scoped as (
        select c.id from calls c join sellers s on s.id=c.seller_id where ${predicate}
      ), state as (
        select scoped.id, j.status, j.stage, j.last_error_code, ar.id official_id
        from scoped left join analysis_jobs j on j.call_id=scoped.id
        left join analysis_runs ar on ar.call_id=scoped.id and ar.status='completed' and ar.is_current=true
      )
      select count(*)::integer total,
        count(*) filter(where official_id is not null)::integer analyzed,
        count(*) filter(where status='claimed')::integer processing,
        count(*) filter(where status in ('ready','retry_wait','paused_budget'))::integer pending,
        count(*) filter(where status='awaiting_transcript' and (last_error_code is null or last_error_code='google_authentication_required'))::integer awaiting_transcript,
        count(*) filter(where status='awaiting_transcript' and last_error_code like 'transcript_access%')::integer access_issue,
        count(*) filter(where status='quarantine')::integer association_review,
        count(*) filter(where status in ('failed_terminal','reconciliation_required'))::integer failed,
        ${globalQuarantine ? this.sql`(select count(*)::integer from ingestion_events where event_type='FAILED_ROW_PARSE')` : this.sql`0::integer`} quarantine,
        count(*) filter(where stage='transcript')::integer stage_transcript,
        count(*) filter(where stage='queue')::integer stage_queue,
        count(*) filter(where stage='primary')::integer stage_primary,
        count(*) filter(where stage='validation')::integer stage_validation,
        count(*) filter(where stage='escalation')::integer stage_escalation,
        count(*) filter(where stage='finalization')::integer stage_finalization,
        count(*) filter(where stage='completed')::integer stage_completed
      from state
    `;
    return rows[0];
  }

  async listActiveAnalyses(context: AuthorizationContext): Promise<ScopedActiveAnalysis[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    return this.sql<ScopedActiveAnalysis[]>`
      select c.id call_id, s.display_name seller_name, j.stage,
        case when j.stage='escalation' then ar.escalation_model else ar.primary_model end model,
        ar.started_at
      from analysis_jobs j join calls c on c.id=j.call_id join sellers s on s.id=c.seller_id
      join analysis_runs ar on ar.id=j.analysis_run_id
      where j.status='claimed' and ${predicate}
      order by ar.started_at limit 20
    `;
  }

  async listAnalysisAttempts(context: AuthorizationContext, callId: string): Promise<ScopedAnalysisAttempt[]> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    return this.sql<ScopedAnalysisAttempt[]>`
      select aa.role,aa.attempt_number,aa.model,aa.provider,aa.status,aa.gateway_actual_cost_usd,
        aa.latency_ms,aa.requested_at,aa.error_code
      from calls c join sellers s on s.id=c.seller_id
      join analysis_runs ar on ar.call_id=c.id and ar.status='completed' and ar.is_current=true
      join analysis_attempts aa on aa.analysis_run_id=ar.id
      where c.id=${callId} and ${predicate} order by aa.attempt_number
    `;
  }
}
