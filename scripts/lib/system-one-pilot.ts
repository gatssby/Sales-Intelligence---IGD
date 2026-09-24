export type PilotCliArgs = {
  manifestPath: string;
  providerName: "laya" | "jev" | "both";
  dryRun: boolean;
  execute: boolean;
  persist: boolean;
  analysisGeneration: number;
};

export const PILOT_DRY_RUN_SQL = `
  select
    c.id::text call_id,
    c.duration_seconds,
    t.id::text transcript_id,
    t.character_count
  from public.calls c
  left join lateral (
    select id, char_length(normalized_text)::integer character_count
    from public.transcripts
    where call_id = c.id
    order by version desc, created_at desc, id desc
    limit 1
  ) t on true
  where c.id = any($1::uuid[])
  order by c.id
`;

export const PILOT_LOAD_SQL = `
  select
    c.id::text call_id,
    t.id::text transcript_id,
    t.normalized_text transcript
  from public.calls c
  join lateral (
    select id, normalized_text
    from public.transcripts
    where call_id = c.id
    order by version desc, created_at desc, id desc
    limit 1
  ) t on true
  where c.id = any($1::uuid[])
  order by c.id
`;

export function parsePilotCliArgs(argv: string[]): PilotCliArgs {
  const args = new Set(argv);
  const value = (name: string) => argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const manifestPath = value("--manifest");
  const providerName = value("--provider") ?? "laya";
  const dryRun = args.has("--dry-run");
  const execute = args.has("--execute");
  const persist = args.has("--persist");
  const analysisGeneration = Number(value("--analysis-generation") ?? "1");

  if (!manifestPath) throw new Error("pilot_manifest_required");
  if (!(["laya", "jev", "both"] as string[]).includes(providerName)) throw new Error("pilot_provider_invalid");
  if (!dryRun && !execute) throw new Error("pilot_mode_required");
  if (dryRun && execute) throw new Error("pilot_mode_conflict");
  if (persist && !execute) throw new Error("pilot_persistence_requires_execute");
  if (!Number.isInteger(analysisGeneration) || analysisGeneration < 1) throw new Error("pilot_analysis_generation_invalid");

  return {
    manifestPath,
    providerName: providerName as PilotCliArgs["providerName"],
    dryRun,
    execute,
    persist,
    analysisGeneration,
  };
}
