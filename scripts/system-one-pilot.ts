import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  CALL_PILOT_QUESTIONS,
  JevDecisionEngine,
  LayaDecisionEngine,
  aggregatePilotChunkDecisions,
  chunkPilotTranscript,
  parsePilotManifest,
  runPilotProviders,
  type DecisionProvider,
  type PilotChunkDecision,
} from "@igd/decision-engine";
import { PILOT_DRY_RUN_SQL, PILOT_LOAD_SQL, parsePilotCliArgs } from "./lib/system-one-pilot.js";

type PilotDryRunRow = {
  call_id: string;
  duration_seconds: number | null;
  transcript_id: string | null;
  character_count: number | null;
};

type PilotLoadRow = {
  call_id: string;
  transcript_id: string;
  transcript: string;
};

async function main() {
  const options = parsePilotCliArgs(process.argv.slice(2));
  const manifest = parsePilotManifest(await readFile(options.manifestPath, "utf8"));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_required_for_explicit_pilot");

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
  });

  try {
    const calls = await sql.unsafe<PilotDryRunRow[]>(PILOT_DRY_RUN_SQL, [manifest.callIds]);
    const byId = new Map(calls.map((row) => [row.call_id, row]));
    const summary = manifest.callIds.map((callId) => {
      const call = byId.get(callId);
      return {
        callId,
        found: Boolean(call),
        durationSeconds: call?.duration_seconds ?? null,
        transcriptPresent: Boolean(call?.transcript_id),
        estimatedChunks: call?.character_count ? Math.ceil(call.character_count / 8000) : 0,
      };
    });

    console.log(JSON.stringify({
      runMode: options.execute ? "execute" : "dry-run",
      persist: options.persist,
      provider: options.providerName,
      manifestVersion: manifest.version,
      calls: summary,
    }, null, 2));

    if (!options.execute) return;
    if (summary.some((row) => !row.found || !row.transcriptPresent)) throw new Error("pilot_call_not_eligible");

    const loaded = await sql.unsafe<PilotLoadRow[]>(PILOT_LOAD_SQL, [manifest.callIds]);
    const providers: Record<string, DecisionProvider> = {
      laya: new LayaDecisionEngine(),
      jev: new JevDecisionEngine(),
    };
    const selected = options.providerName === "both" ? ["laya", "jev"] : [options.providerName];
    const runId = randomUUID();
    const outputs: unknown[] = [];

    for (const call of loaded) {
      const chunking = chunkPilotTranscript(call.transcript, { maxCharacters: 8000 });
      const outcome = await runPilotProviders({
        providers: selected.map((name) => ({
          name,
          evaluate: async () => {
            const provider = providers[name]!;
            const health = await provider.health?.();
            if (health && !health.available) throw new Error(health.reason);

            const decisions: PilotChunkDecision[] = [];
            for (const chunk of chunking.chunks) {
              const response = await provider.decide({
                subjectType: "call",
                subjectId: call.call_id,
                input: { text: chunk.text },
                questions: CALL_PILOT_QUESTIONS,
                schemaVersion: "sales-decision-calls-v0.1",
              });
              decisions.push(...response.decisions.map((decision) => ({
                chunkIndex: chunk.index,
                key: decision.key,
                value: decision.value,
                confidence: decision.confidence,
                probabilities: decision.probabilities,
              })));
            }
            return decisions;
          },
        })),
      });

      for (const [name, result] of Object.entries(outcome.providers)) {
        if (result.status === "completed") {
          const aggregate = aggregatePilotChunkDecisions(result.decisions);
          outputs.push({
            callId: call.call_id,
            provider: name,
            status: aggregate.needsReview ? "needs_review" : "completed",
            chunks: chunking.chunks.length,
            decisions: aggregate.decisions,
          });
        } else {
          outputs.push({
            callId: call.call_id,
            provider: name,
            status: "provider_unavailable",
            reason: result.reason,
            chunks: chunking.chunks.length,
          });
        }
      }
    }

    if (options.persist) throw new Error("pilot_persistence_migration_required_before_use");
    console.log(JSON.stringify({ runId, persisted: false, outputs }, null, 2));
  } finally {
    await sql.end();
  }
}

await main();