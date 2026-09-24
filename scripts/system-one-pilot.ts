import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { CALL_PILOT_QUESTIONS, JevDecisionEngine, LayaDecisionEngine, aggregatePilotChunkDecisions, chunkPilotTranscript, parsePilotManifest, runPilotProviders, type DecisionProvider, type PilotChunkDecision } from "@igd/decision-engine";

const args = new Set(process.argv.slice(2));
const value = (name: string) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const manifestPath = value("--manifest");
const providerName = value("--provider") ?? "laya";
const execute = args.has("--execute");
const persist = args.has("--persist");
const analysisGeneration = Number(value("--analysis-generation") ?? "1");
if (!manifestPath) throw new Error("pilot_manifest_required");
if (!(["laya", "jev", "both"] as string[]).includes(providerName)) throw new Error("pilot_provider_invalid");
if (persist && !execute) throw new Error("pilot_persistence_requires_execute");
if (!Number.isInteger(analysisGeneration) || analysisGeneration < 1) throw new Error("pilot_analysis_generation_invalid");
const manifest = parsePilotManifest(await readFile(manifestPath, "utf8"));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_required_for_explicit_pilot");
const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });
try {
  const calls = await sql<{ call_id: string; duration_seconds: number | null; transcript_id: string | null; character_count: number | null }[]>`
    select c.id call_id, c.duration_seconds, t.id transcript_id, char_length(t.normalized_text)::integer character_count
    from calls c left join lateral (
      select id, normalized_text from transcripts where call_id=c.id order by version desc limit 1
    ) t on true where c.id = any(${sql.array(manifest.callIds)}) order by c.id
  `;
  const byId = new Map(calls.map((row) => [row.call_id, row]));
  const summary = manifest.callIds.map((callId) => {
    const call = byId.get(callId);
    return { callId, found: Boolean(call), durationSeconds: call?.duration_seconds ?? null, transcriptPresent: Boolean(call?.transcript_id), estimatedChunks: call?.character_count ? Math.ceil(call.character_count / 8000) : 0 };
  });
  console.log(JSON.stringify({ runMode: execute ? "execute" : "dry-run", persist, provider: providerName, manifestVersion: manifest.version, calls: summary }, null, 2));
  if (!execute) process.exit(0);
  if (summary.some((row) => !row.found || !row.transcriptPresent)) throw new Error("pilot_call_not_eligible");
  const loaded = await sql<{ call_id: string; transcript_id: string; transcript: string }[]>`
    select c.id call_id, t.id transcript_id, t.normalized_text transcript from calls c join lateral (
      select id, normalized_text from transcripts where call_id=c.id order by version desc limit 1
    ) t on true where c.id = any(${sql.array(manifest.callIds)}) order by c.id
  `;
  const providers: Record<string, DecisionProvider> = { laya: new LayaDecisionEngine(), jev: new JevDecisionEngine() };
  const selected = providerName === "both" ? ["laya", "jev"] : [providerName];
  const runId = randomUUID();
  const outputs: unknown[] = [];
  for (const call of loaded) {
    const chunking = chunkPilotTranscript(call.transcript, { maxCharacters: 8000 });
    const outcome = await runPilotProviders({ providers: selected.map((name) => ({ name, evaluate: async () => {
      const provider = providers[name]!;
      const health = await provider.health?.();
      if (health && !health.available) throw new Error(health.reason);
      const decisions: PilotChunkDecision[] = [];
      for (const chunk of chunking.chunks) {
        const response = await provider.decide({ subjectType: "call", subjectId: call.call_id, input: { text: chunk.text }, questions: CALL_PILOT_QUESTIONS, schemaVersion: "sales-decision-calls-v0.1" });
        decisions.push(...response.decisions.map((decision) => ({ chunkIndex: chunk.index, key: decision.key, value: decision.value, confidence: decision.confidence, probabilities: decision.probabilities })));
      }
      return decisions;
    } })) });
    for (const [name, result] of Object.entries(outcome.providers)) {
      if (result.status === "completed") {
        const aggregate = aggregatePilotChunkDecisions(result.decisions);
        outputs.push({ callId: call.call_id, provider: name, status: aggregate.needsReview ? "needs_review" : "completed", chunks: chunking.chunks.length, decisions: aggregate.decisions });
      } else outputs.push({ callId: call.call_id, provider: name, status: "provider_unavailable", reason: result.reason, chunks: chunking.chunks.length });
    }
  }
  if (persist) throw new Error("pilot_persistence_migration_required_before_use");
  console.log(JSON.stringify({ runId, persisted: false, outputs }, null, 2));
} finally { await sql.end(); }
