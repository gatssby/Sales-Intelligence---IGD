import type { Sql } from "postgres";

export type GeminiPocEvent = {
  eventId: number;
  jobId: string;
  workerId: string | null;
  eventType: "claimed" | "completed" | "failed_retryable" | "failed_terminal";
  errorCode: string | null;
  createdAt: string;
};

export type GeminiPocEventPage = {
  events: GeminiPocEvent[];
  nextCursor: number;
  hasMore: boolean;
};

export async function getGeminiPocEvents(sql: Sql, afterEventId: number, limit = 200): Promise<GeminiPocEventPage> {
  if (!Number.isSafeInteger(afterEventId) || afterEventId < 0) throw new Error("invalid_event_cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("invalid_event_limit");

  const rows = await sql<{
    event_id: string | number;
    job_id: string;
    worker_id: string | null;
    event_type: GeminiPocEvent["eventType"];
    error_code: string | null;
    created_at: Date;
  }[]>`
    select event_id, job_id, worker_id, event_type, error_code, created_at
    from gemini_poc_job_events
    where event_id > ${afterEventId}
    order by event_id asc
    limit ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const events = visible.map((row) => ({
    eventId: Number(row.event_id),
    jobId: row.job_id,
    workerId: row.worker_id,
    eventType: row.event_type,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
  }));
  return {
    events,
    nextCursor: events.at(-1)?.eventId ?? afterEventId,
    hasMore,
  };
}
