import type { Sql } from "postgres";

export type GeminiPocFeedResult = {
  eligible: number;
  enqueued: number;
};

export async function feedGeminiPocQueue(sql: Sql, limit = 50): Promise<GeminiPocFeedResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("invalid_gemini_poc_feed_limit");
  }

  return sql.begin(async (tx) => {
    const rows = await tx<{ call_id: string; transcript_id: string }[]>`
      select aj.call_id, t.id transcript_id
      from analysis_jobs aj
      join calls c on c.id=aj.call_id
      join lateral (
        select id
        from transcripts
        where call_id=aj.call_id
        order by version desc, created_at desc, id desc
        limit 1
      ) t on true
      where aj.status='ready'
        and not exists (
          select 1
          from analysis_runs ar
          where ar.call_id=aj.call_id
            and ar.status='completed'
            and ar.is_current=true
        )
        and not exists (
          select 1
          from gemini_poc_jobs existing
          where existing.call_id=aj.call_id
            and existing.status in ('queued','claimed','retry_wait','completed','failed_terminal')
        )
      order by
        case
          when c.started_at is not null then 0
          when c.metadata->>'recency_method'='source_row_desc_verified' then 1
          else 2
        end asc,
        c.started_at desc nulls last,
        case
          when c.metadata->>'recency_method'='source_row_desc_verified'
            and coalesce(c.metadata->>'source_row','') ~ '^[0-9]+$'
          then (c.metadata->>'source_row')::bigint
          else null
        end desc nulls last,
        c.created_at desc,
        c.id
      for update of aj skip locked
      limit ${limit}
    `;

    let enqueued = 0;
    for (const row of rows) {
      const inserted = await tx`
        insert into gemini_poc_jobs (call_id, transcript_id, status)
        values (${row.call_id}, ${row.transcript_id}, 'queued')
        on conflict (call_id, transcript_id) do nothing
        returning id
      `;
      enqueued += inserted.length;
    }

    return { eligible: rows.length, enqueued };
  });
}
