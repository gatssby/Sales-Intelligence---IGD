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
