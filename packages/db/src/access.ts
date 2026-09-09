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
  normalized_text: string;
  score: string | number;
  result_json: unknown;
  rubric_version: string;
  prompt_version: string;
  model: string;
  analyzed_at: Date;
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
      select s.seller_code, s.display_name seller_name, round(avg(ar.score)) score, count(*)::integer calls
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
      where ar.status='completed' and ar.is_current=true and ${predicate}
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
        tr.normalized_text, ar.score, ar.result_json, ar.rubric_version,
        ar.prompt_version, ar.model, coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      left join teams tteam on tteam.id = s.team_id
      join transcripts tr on tr.id = ar.transcript_id
      where ar.status = 'completed' and ar.is_current = true and ${predicate}
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
        tr.normalized_text, ar.score, ar.result_json, ar.rubric_version,
        ar.prompt_version, ar.model, coalesce(ar.finished_at, ar.created_at) as analyzed_at
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      left join teams tteam on tteam.id = s.team_id
      join transcripts tr on tr.id = ar.transcript_id
      where c.id = ${callId}
        and ar.status = 'completed' and ar.is_current = true and ${predicate}
      limit 1
    `;
    return rows[0] ?? null;
  }
}
