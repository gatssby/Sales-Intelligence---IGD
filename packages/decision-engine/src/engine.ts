import { randomUUID } from "node:crypto";
import { DecisionResponseSchema, type DecisionProvider, type DecisionRequest, type DecisionRunRecord } from "./types.js";

export class DecisionEngineUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DecisionEngineUnavailableError";
  }
}

export type DecisionRunStore = {
  append(record: DecisionRunRecord): Promise<void> | void;
  list(filter?: { subjectId?: string; engineFamily?: string }): DecisionRunRecord[];
};

export class InMemoryDecisionRunStore implements DecisionRunStore {
  private readonly records: DecisionRunRecord[] = [];

  append(record: DecisionRunRecord): void {
    this.records.push(structuredClone(record));
  }

  list(filter: { subjectId?: string; engineFamily?: string } = {}): DecisionRunRecord[] {
    return this.records.filter((record) =>
      (filter.subjectId === undefined || record.subjectId === filter.subjectId) &&
      (filter.engineFamily === undefined || record.engineFamily === filter.engineFamily),
    ).map((record) => structuredClone(record));
  }
}

function isRetryable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true);
}

export function createDecisionEngine(options: {
  provider: DecisionProvider;
  schemaVersion: string;
  engineFamily?: string;
  analysisGeneration?: number;
  maxRetries?: number;
  store?: DecisionRunStore;
}) {
  const engineFamily = options.engineFamily ?? "system-one";
  const analysisGeneration = options.analysisGeneration ?? 1;
  if (!options.schemaVersion.trim()) throw new Error("decision_schema_version_required");
  if (!engineFamily.trim()) throw new Error("decision_engine_family_required");
  if (!Number.isInteger(analysisGeneration) || analysisGeneration < 1) throw new Error("decision_analysis_generation_invalid");
  if (!Number.isInteger(options.maxRetries ?? 0) || (options.maxRetries ?? 0) < 0) throw new Error("decision_retry_limit_invalid");

  return {
    async evaluate(request: DecisionRequest): Promise<DecisionRunRecord> {
      const health = await options.provider.health?.();
      if (health && !health.available) throw new DecisionEngineUnavailableError(health.reason);
      let response: Awaited<ReturnType<DecisionProvider["decide"]>> | undefined;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await options.provider.decide({ ...request, schemaVersion: request.schemaVersion ?? options.schemaVersion });
          break;
        } catch (error) {
          if (!isRetryable(error) || attempt >= (options.maxRetries ?? 0)) throw error;
        }
      }
      const parsed = DecisionResponseSchema.parse(response);
      const record: DecisionRunRecord = {
        ...parsed,
        provider: options.provider.provider,
        model: parsed.model ?? options.provider.model,
        modelVersion: parsed.modelVersion ?? options.provider.modelVersion,
        latencyMs: parsed.latencyMs ?? 0,
        id: randomUUID(),
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        engineFamily,
        analysisGeneration,
        schemaVersion: request.schemaVersion ?? options.schemaVersion,
        createdAt: new Date().toISOString(),
      };
      await options.store?.append(record);
      return record;
    },
  };
}
