import type { AuthorizationContext, Capability, SelectedOrganizationScope } from "@igd/auth";
import { assertCapability } from "@igd/auth";
import type { PendingQuery, Sql } from "postgres";
import { calculateAiSpendSummary, type AiSpendSummary, type OfficialCallCost } from "./ai-spend";

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

export type ScopedOrganizationMetric = {
  entity_id: string;
  score: string | number;
  calls: number;
};

export type CallPeriod = { from?: Date; through?: Date };

export type ScopedDimensionMetric = {
  key: string;
  label: string;
  score: string | number;
  calls: number;
};

function scopePredicate(sql: Sql, context: AuthorizationContext): PendingQuery<never[]> {
  const analyticalProduct = sql<never[]>`exists (
    select 1 from products analytical_product
    where analytical_product.key=lower(c.product_key) and analytical_product.active=true and analytical_product.analytics_enabled=true
  )`;
  if (context.scope.kind === "GLOBAL") return analyticalProduct;
  if (context.scope.kind === "TEAMS") {
    if (context.scope.teamIds.length === 0) return sql`false`;
    return sql`${analyticalProduct} and coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id) in ${sql(context.scope.teamIds)}`;
  }
  if (context.scope.kind === "PRODUCTS") {
    if (context.scope.productKeys.length === 0) return sql`false`;
    return sql`${analyticalProduct} and lower(c.product_key) in ${sql(context.scope.productKeys)}`;
  }
  const products = context.scope.productKeys.length
    ? sql`lower(c.product_key) in ${sql(context.scope.productKeys)}`
    : sql`false`;
  const teams = context.scope.teamIds.length
    ? sql`coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id) in ${sql(context.scope.teamIds)}`
    : sql`false`;
  const people = context.scope.personIds.length
    ? sql`coalesce(c.primary_closer_id,s.person_id) in ${sql(context.scope.personIds)}`
    : sql`false`;
  return sql`${analyticalProduct} and (${products} or ${teams} or ${people})`;
}

function selectedCallPredicate(sql: Sql, selected: SelectedOrganizationScope): PendingQuery<never[]> {
  const predicates: PendingQuery<never[]>[] = [];
  if (selected.productKey) predicates.push(sql`lower(c.product_key)=${selected.productKey.trim().toLowerCase()}`);
  if (selected.frontKey) predicates.push(sql`coalesce(c.front_key,(select team.front_key from teams team where team.id=coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)))=${selected.frontKey.trim().toLowerCase()}`);
  if (selected.teamId) predicates.push(sql`coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)=${selected.teamId}`);
  if (selected.personId) predicates.push(sql`coalesce(c.primary_closer_id,s.person_id)=${selected.personId}`);
  if (!predicates.length) return sql`true`;
  return sql`(${predicates.reduce((combined, predicate) => sql`${combined} and ${predicate}`)})`;
}

function callPeriodPredicate(sql: Sql, period: CallPeriod): PendingQuery<never[]> {
  if (period.from && period.through) return sql`c.started_at>=${period.from} and c.started_at<=${period.through}`;
  if (period.from) return sql`c.started_at>=${period.from}`;
  if (period.through) return sql`c.started_at<=${period.through}`;
  return sql`true`;
}

export class ScopedSalesRepository {
  constructor(readonly sql: Sql) {}

  private require(context: AuthorizationContext, capability: Capability): void {
    assertCapability(context, capability);
  }

  async getMetrics(context: AuthorizationContext, selected: SelectedOrganizationScope = {}): Promise<ScopedMetrics> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const rows = await this.sql<ScopedMetrics[]>`
      select
        count(*)::integer as analyzed_calls,
        count(distinct c.seller_id)::integer as seller_count,
        count(distinct coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id))::integer as team_count,
        count(distinct lower(c.product_key))::integer as product_count,
        round(avg(ar.score), 2) as average_score
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      where ar.status = 'completed' and ar.is_current = true and ${predicate} and ${selection}
    `;
    return rows[0];
  }

  async getDashboardSummary(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, period: CallPeriod = {}): Promise<ScopedDashboardSummary> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const dates = callPeriodPredicate(this.sql, period);
    const rows = await this.sql<ScopedDashboardSummary[]>`
      with scoped_calls as (
        select c.id, c.seller_id
        from calls c join sellers s on s.id = c.seller_id
        where ${predicate} and ${selection} and ${dates}
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

  async listSellerMetrics(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, period: CallPeriod = {}): Promise<ScopedSellerMetric[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const dates = callPeriodPredicate(this.sql, period);
    return this.sql<ScopedSellerMetric[]>`
      select s.seller_code, s.display_name seller_name, round(avg(ar.score)) score, count(ar.score)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      where ar.status='completed' and ar.is_current=true and ${predicate} and ${selection} and ${dates}
      group by s.id,s.seller_code,s.display_name order by avg(ar.score) desc,s.display_name
    `;
  }

  async listPersonMetrics(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, period: CallPeriod = {}): Promise<ScopedOrganizationMetric[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const dates = callPeriodPredicate(this.sql, period);
    return this.sql<ScopedOrganizationMetric[]>`
      select coalesce(c.primary_closer_id,s.person_id) entity_id,
        round(avg(ar.score)) score,count(ar.score)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      where ar.status='completed' and ar.is_current=true and ar.score is not null
        and coalesce(c.primary_closer_id,s.person_id) is not null and ${predicate} and ${selection} and ${dates}
      group by coalesce(c.primary_closer_id,s.person_id)
    `;
  }

  async listTeamMetrics(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, period: CallPeriod = {}): Promise<ScopedOrganizationMetric[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const dates = callPeriodPredicate(this.sql, period);
    return this.sql<ScopedOrganizationMetric[]>`
      select coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id) entity_id,
        round(avg(ar.score)) score,count(ar.score)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      where ar.status='completed' and ar.is_current=true and ar.score is not null
        and coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id) is not null and ${predicate} and ${selection} and ${dates}
      group by coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)
    `;
  }

  async listDimensionMetrics(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, period: CallPeriod = {}): Promise<ScopedDimensionMetric[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const dates = callPeriodPredicate(this.sql, period);
    return this.sql<ScopedDimensionMetric[]>`
      select dimension->>'key' key, max(dimension->>'label') label,
        round(avg((dimension->>'score')::numeric)) score, count(*)::integer calls
      from analysis_runs ar join calls c on c.id=ar.call_id join sellers s on s.id=c.seller_id
      cross join lateral jsonb_array_elements(ar.result_json->'dimensions') dimension
      where ar.status='completed' and ar.is_current=true and ar.score is not null and ${predicate} and ${selection} and ${dates}
      group by dimension->>'key' order by avg((dimension->>'score')::numeric) desc
    `;
  }

  async listCalls(context: AuthorizationContext, limit = 50, selected: SelectedOrganizationScope = {}, period: CallPeriod = {}): Promise<ScopedCallRow[]> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const dates = callPeriodPredicate(this.sql, period);
    return this.sql<ScopedCallRow[]>`
      select
        c.id, c.customer_name, s.display_name as seller_name, coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id) team_id,
        tteam.display_name as team_name, c.product_key, c.started_at, c.duration_seconds,
        ar.score, ar.result_json, ar.rubric_version,
        ar.prompt_version, ar.model, coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      left join teams tteam on tteam.id = coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)
      where ar.status = 'completed' and ar.is_current = true and ar.score is not null and ${predicate} and ${selection} and ${dates}
      order by c.started_at desc nulls last,c.id desc
      limit ${Math.max(1, Math.min(limit, 100))}
    `;
  }

  async getCallById(context: AuthorizationContext, callId: string, selected: SelectedOrganizationScope = {}): Promise<ScopedCallRow | null> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const rows = await this.sql<ScopedCallRow[]>`
      select
        c.id, c.customer_name, s.display_name as seller_name, coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id) team_id,
        tteam.display_name as team_name, c.product_key, c.started_at, c.duration_seconds,
        ar.score, ar.result_json, ar.rubric_version,
        ar.prompt_version, ar.model, coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      left join teams tteam on tteam.id = coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)
      where c.id = ${callId}
        and ar.status = 'completed' and ar.is_current = true and ${predicate} and ${selection}
      limit 1
    `;
    return rows[0] ?? null;
  }

  async listCallCatalog(context: AuthorizationContext, options: { page: number; pageSize: number; selected?: SelectedOrganizationScope }): Promise<{ rows: ScopedCallCatalogRow[]; total: number }> {
    this.require(context, "calls:read");
    const page = Math.max(1, Math.trunc(options.page));
    const pageSize = Math.max(1, Math.min(100, Math.trunc(options.pageSize)));
    const offset = (page - 1) * pageSize;
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, options.selected ?? {});
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
        left join teams t on t.id=coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)
        left join analysis_jobs j on j.call_id=c.id
        left join analysis_runs ar on ar.call_id=c.id and ar.status='completed' and ar.is_current=true
        where ${predicate} and ${selection}
        order by coalesce(c.started_at,c.created_at) desc,c.id desc
        limit ${pageSize} offset ${offset}
      `,
      this.sql<{ total: number }[]>`
        select count(*)::integer total from calls c join sellers s on s.id=c.seller_id where ${predicate} and ${selection}
      `,
    ]);
    return { rows, total: totals[0].total };
  }

  async getCatalogCallById(context: AuthorizationContext, callId: string, selected: SelectedOrganizationScope = {}): Promise<ScopedCallCatalogRow | null> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
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
      left join teams t on t.id=coalesce(c.team_id,c.legacy_team_snapshot_id,s.team_id)
      left join analysis_jobs j on j.call_id=c.id
      left join analysis_runs ar on ar.call_id=c.id and ar.status='completed' and ar.is_current=true
      where c.id=${callId} and ${predicate} and ${selection} limit 1
    `;
    return rows[0] ?? null;
  }

  async getCallTranscript(context: AuthorizationContext, callId: string, selected: SelectedOrganizationScope = {}): Promise<string | null> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const rows = await this.sql<{ normalized_text: string }[]>`
      select tr.normalized_text from calls c join sellers s on s.id=c.seller_id
      join lateral (select normalized_text from transcripts where call_id=c.id order by version desc limit 1) tr on true
      where c.id=${callId} and ${predicate} and ${selection}
    `;
    return rows[0]?.normalized_text ?? null;
  }

  async getBacklogProgress(context: AuthorizationContext, selected: SelectedOrganizationScope = {}): Promise<ScopedBacklogProgress> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    const globalQuarantine = context.scope.kind === "GLOBAL";
    const rows = await this.sql<ScopedBacklogProgress[]>`
      with scoped as (
        select c.id from calls c join sellers s on s.id=c.seller_id where ${predicate} and ${selection}
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

  async listActiveAnalyses(context: AuthorizationContext, selected: SelectedOrganizationScope = {}): Promise<ScopedActiveAnalysis[]> {
    this.require(context, "analytics:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    return this.sql<ScopedActiveAnalysis[]>`
      select c.id call_id, s.display_name seller_name, j.stage,
        case when j.stage='escalation' then ar.escalation_model else ar.primary_model end model,
        ar.started_at
      from analysis_jobs j join calls c on c.id=j.call_id join sellers s on s.id=c.seller_id
      join analysis_runs ar on ar.id=j.analysis_run_id
      where j.status='claimed' and ${predicate} and ${selection}
      order by ar.started_at limit 20
    `;
  }

  async listAnalysisAttempts(context: AuthorizationContext, callId: string, selected: SelectedOrganizationScope = {}): Promise<ScopedAnalysisAttempt[]> {
    this.require(context, "calls:read");
    const predicate = scopePredicate(this.sql, context);
    const selection = selectedCallPredicate(this.sql, selected);
    return this.sql<ScopedAnalysisAttempt[]>`
      select aa.role,aa.attempt_number,aa.model,aa.provider,aa.status,aa.gateway_actual_cost_usd,
        aa.latency_ms,aa.requested_at,aa.error_code
      from calls c join sellers s on s.id=c.seller_id
      join analysis_runs ar on ar.call_id=c.id and ar.status='completed' and ar.is_current=true
      join analysis_attempts aa on aa.analysis_run_id=ar.id
      where c.id=${callId} and ${predicate} and ${selection} order by aa.attempt_number
    `;
  }

  async getAiSpendSummary(context: AuthorizationContext, options: {
    accountId: string; strategyVersion: string; confidencePolicyVersion: string;
  }): Promise<AiSpendSummary> {
    this.require(context, "platform:observe");
    const [accounts, callRows, backlogs, workers, completions] = await Promise.all([
      this.sql<{
        limit_usd: string | number; external_spend_baseline_usd: string | number;
        baseline_captured_at: Date; paused: boolean; settled_usd: string | number;
        active_usd: string | number; official_usd: string | number; benchmark_usd: string | number;
      }[]>`
        select a.limit_usd,a.external_spend_baseline_usd,a.baseline_captured_at,a.paused,
          coalesce(sum(r.actual_usd) filter(where r.status='settled'),0) settled_usd,
          coalesce(sum(r.reserved_usd) filter(where r.status in ('reserved','request_started','outcome_unknown')),0) active_usd,
          coalesce(sum(r.actual_usd) filter(where r.status='settled' and r.owner_type='official'),0) official_usd,
          coalesce(sum(r.actual_usd) filter(where r.status='settled' and r.owner_type='benchmark'),0) benchmark_usd
        from ai_budget_accounts a left join ai_cost_reservations r on r.budget_account_id=a.id
        where a.id=${options.accountId}
        group by a.id
      `,
      this.sql<{
        cost_usd: string | number | null; primary_cost_usd: string | number | null;
        escalation_cost_usd: string | number | null; escalated: boolean;
        human_review_requested: boolean; completed_at: Date; current_strategy: boolean;
      }[]>`
        with attempt_costs as (
          select analysis_run_id,count(*)::integer attempt_count,
            bool_or(gateway_actual_cost_usd is null) has_unknown_cost,
            sum(gateway_actual_cost_usd) total_cost,
            sum(gateway_actual_cost_usd) filter(where role='primary') primary_cost,
            sum(gateway_actual_cost_usd) filter(where role='escalation') escalation_cost
          from analysis_attempts group by analysis_run_id
        )
        select case when coalesce(ac.attempt_count,0)=0 or ac.has_unknown_cost then null else ac.total_cost end cost_usd,
          case when coalesce(ac.attempt_count,0)=0 or ac.has_unknown_cost then null else coalesce(ac.primary_cost,0) end primary_cost_usd,
          case when coalesce(ac.attempt_count,0)=0 or ac.has_unknown_cost then null else coalesce(ac.escalation_cost,0) end escalation_cost_usd,
          ar.escalated,ar.human_review_requested,coalesce(ar.finished_at,ar.created_at) completed_at,
          (ar.strategy_version=${options.strategyVersion} and ar.confidence_policy_version=${options.confidencePolicyVersion}) current_strategy
        from analysis_runs ar left join attempt_costs ac on ac.analysis_run_id=ar.id
        where ar.status='completed' and ar.is_current=true
        order by coalesce(ar.finished_at,ar.created_at) desc
      `,
      this.sql<{ eligible: number }[]>`
        select count(*)::integer eligible
        from analysis_jobs j
        where j.status in ('ready','retry_wait','awaiting_transcript','paused_budget')
          and not (j.status='awaiting_transcript' and coalesce(j.last_error_code,'') like 'transcript_access%')
          and not exists (
            select 1 from analysis_runs ar
            where ar.call_id=j.call_id and ar.status='completed' and ar.is_current=true
          )
      `,
      this.sql<{ status: string; concurrency: number; last_seen_at: Date }[]>`
        select case when last_seen_at < now()-interval '45 seconds' then 'stopped' else status end status,
          concurrency,last_seen_at
        from analysis_worker_heartbeats order by last_seen_at desc limit 1
      `,
      this.sql<{ last_completion_at: Date | null }[]>`
        select max(coalesce(finished_at,created_at)) last_completion_at
        from analysis_runs
        where status='completed' and strategy_version=${options.strategyVersion}
          and confidence_policy_version=${options.confidencePolicyVersion}
      `,
    ]);
    const account = accounts[0];
    if (!account) throw new Error("budget_account_not_found");
    const officialCalls: OfficialCallCost[] = callRows.map((row) => ({
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      primaryCostUsd: row.primary_cost_usd === null ? null : Number(row.primary_cost_usd),
      escalationCostUsd: row.escalation_cost_usd === null ? null : Number(row.escalation_cost_usd),
      escalated: row.escalated,
      humanReviewRequested: row.human_review_requested,
      completedAt: row.completed_at,
      currentStrategy: row.current_strategy,
    }));
    const worker = workers[0];
    return calculateAiSpendSummary({
      budgetUsd: Number(account.limit_usd),
      reconciledSpendUsd: Number(account.external_spend_baseline_usd) + Number(account.settled_usd),
      activeReservationsUsd: Number(account.active_usd),
      officialSpentUsd: Number(account.official_usd),
      benchmarkSpentUsd: Number(account.benchmark_usd),
      officialCalls,
      eligibleBacklog: backlogs[0].eligible,
      lastReconciledAt: account.baseline_captured_at,
      budgetPaused: account.paused,
      worker: {
        status: worker?.status ?? "stopped",
        concurrency: worker?.concurrency ?? null,
        lastSeenAt: worker?.last_seen_at ?? null,
        lastCompletionAt: completions[0].last_completion_at,
      },
    });
  }
}
