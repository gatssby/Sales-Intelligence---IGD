import type { PendingQuery, Sql } from "postgres";

const LEGACY_ENGINE_FAMILY = "generative-ai-v1";
const schemaCapabilityCache = new WeakMap<object, Promise<boolean>>();

function hasAnalysisRunEngineFamily(sql: Sql): Promise<boolean> {
  const key = sql as unknown as object;
  const cached = schemaCapabilityCache.get(key);
  if (cached) return cached;

  const capability = sql<{ present: boolean }[]>`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'analysis_runs'
        and column_name = 'engine_family'
    ) as present
  `.then((rows) => rows[0]?.present === true);
  schemaCapabilityCache.set(key, capability);
  return capability;
}

export async function legacyAnalysisRunPredicate(
  sql: Sql,
  alias: string,
): Promise<PendingQuery<never[]>> {
  const supported = await hasAnalysisRunEngineFamily(sql);
  if (!supported) return sql`true`;
  return sql.unsafe(`${alias}.engine_family = '${LEGACY_ENGINE_FAMILY}'`);
}
