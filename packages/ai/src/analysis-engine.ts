import { AnalysisOutputSchema, type AnalysisOutput } from "./schema";

export type AnalysisEngineInput = {
  transcript: string;
  rubric: string;
  promptVersion: string;
  expectedDimensionKeys: string[];
};

export type AnalysisStrategy = {
  version: string;
  primaryModel: string;
  escalationModel: string;
  confidenceThreshold: number;
  maxTechnicalRetries: number;
};

export type ModelAnalysisRequest = AnalysisEngineInput & {
  model: string;
  purpose: "benchmark" | "official-analysis";
  role: "benchmark" | "primary" | "escalation";
};

export type ModelExecution = {
  output: unknown;
  provider: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  gatewayActualCostUsd: number | null;
  estimatedCostUsd: number | null;
  costSource: "gateway_actual" | "estimated" | "unavailable";
  latencyMs: number;
  requestedAt: string;
};

export interface ModelGateway {
  analyze(request: ModelAnalysisRequest): Promise<ModelExecution>;
}

export class ModelGatewayError extends Error {
  readonly retryable: boolean;
  readonly latencyMs: number;
  readonly receipt: Omit<ModelExecution, "output" | "latencyMs"> | null;

  constructor(code: string, options: { retryable: boolean; latencyMs?: number; receipt?: Omit<ModelExecution, "output" | "latencyMs"> }) {
    super(code);
    this.name = "ModelGatewayError";
    this.retryable = options.retryable;
    this.latencyMs = options.latencyMs ?? 0;
    this.receipt = options.receipt ?? null;
  }
}

export class AnalysisEngineError extends Error {
  constructor(
    readonly code: string,
    readonly attempts: AnalysisAttemptResult[],
    readonly escalationReasons: string[],
  ) {
    super(code);
    this.name = "AnalysisEngineError";
  }
}

export type AnalysisQualitySignals = {
  evidenceGroundingRate: number;
  dimensionCoverageRate: number;
  scoreDimensionDelta: number;
};

export type CompletedAnalysisAttempt = ModelExecution & {
  status: "completed";
  role: "primary" | "escalation";
  model: string;
  output: AnalysisOutput;
  qualitySignals: AnalysisQualitySignals;
};

export type FailedAnalysisAttempt = Omit<ModelExecution, "output"> & {
  status: "failed";
  role: "primary" | "escalation";
  model: string;
  errorCode: string;
};

export type AnalysisAttemptResult = CompletedAnalysisAttempt | FailedAnalysisAttempt;

export type OfficialAnalysisExecution = {
  status: "completed";
  output: AnalysisOutput;
  finalModel: string;
  escalated: boolean;
  escalationReasons: string[];
  attempts: AnalysisAttemptResult[];
};

export type BenchmarkModelResult =
  | (ModelExecution & {
      status: "completed";
      model: string;
      output: AnalysisOutput;
      qualitySignals: AnalysisQualitySignals;
    })
  | {
      status: "failed";
      model: string;
      provider: string;
      errorCode: string;
      inputTokens: number | null;
      outputTokens: number | null;
      cachedInputTokens: number | null;
      costUsd: number | null;
      gatewayActualCostUsd: number | null;
      estimatedCostUsd: number | null;
      costSource: "gateway_actual" | "estimated" | "unavailable";
      latencyMs: number;
      requestedAt: string;
    };

export type BenchmarkExecution = {
  purpose: "benchmark";
  results: BenchmarkModelResult[];
};

export interface AnalysisEngine {
  runOfficial(input: AnalysisEngineInput): Promise<OfficialAnalysisExecution>;
  runBenchmark(input: AnalysisEngineInput, models: string[]): Promise<BenchmarkExecution>;
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function providerFromModel(model: string): string {
  return model.split("/")[0] || "unknown";
}

function qualitySignals(output: AnalysisOutput, input: AnalysisEngineInput): AnalysisQualitySignals {
  const transcript = normalizeEvidence(input.transcript);
  const grounded = output.evidence.filter((item) => transcript.includes(normalizeEvidence(item.quote))).length;
  const returnedDimensions = new Set(output.dimensions.map((item) => item.key));
  const expectedDimensions = new Set(input.expectedDimensionKeys);
  const covered = [...expectedDimensions].filter((key) => returnedDimensions.has(key)).length;
  const dimensionAverage = output.dimensions.length
    ? output.dimensions.reduce((sum, item) => sum + item.score, 0) / output.dimensions.length
    : 0;
  return {
    evidenceGroundingRate: output.evidence.length ? grounded / output.evidence.length : 0,
    dimensionCoverageRate: expectedDimensions.size ? covered / expectedDimensions.size : 1,
    scoreDimensionDelta: Math.abs(output.overall_score - dimensionAverage),
  };
}

function escalationReasons(
  output: AnalysisOutput,
  signals: AnalysisQualitySignals,
  strategy: AnalysisStrategy,
): string[] {
  const reasons: string[] = [];
  if (output.confidence < strategy.confidenceThreshold) reasons.push("low_confidence");
  if (output.requires_human_review) reasons.push("human_review_requested");
  if (signals.evidenceGroundingRate < 0.5) reasons.push("insufficient_grounding");
  if (signals.dimensionCoverageRate < 1) reasons.push("incomplete_dimensions");
  if (signals.scoreDimensionDelta > 15) reasons.push("inconsistent_score");
  return reasons;
}

export function createAnalysisEngine(options: {
  gateway: ModelGateway;
  strategy: AnalysisStrategy;
}): AnalysisEngine {
  const { gateway, strategy } = options;
  if (!strategy.version.trim()) throw new Error("analysis_strategy_version_required");
  if (!strategy.primaryModel.trim() || !strategy.escalationModel.trim()) throw new Error("analysis_strategy_models_required");
  if (strategy.confidenceThreshold < 0 || strategy.confidenceThreshold > 1) throw new Error("invalid_confidence_threshold");
  if (!Number.isInteger(strategy.maxTechnicalRetries) || strategy.maxTechnicalRetries < 0) throw new Error("invalid_technical_retry_limit");

  return {
    async runBenchmark(input, models) {
      const results = await Promise.all(models.map(async (model): Promise<BenchmarkModelResult> => {
        try {
          const execution = await gateway.analyze({ ...input, model, purpose: "benchmark", role: "benchmark" });
          const parsed = AnalysisOutputSchema.safeParse(execution.output);
          if (!parsed.success) {
            return {
              status: "failed",
              model,
              provider: execution.provider,
              errorCode: "schema_invalid",
              inputTokens: execution.inputTokens,
              outputTokens: execution.outputTokens,
              cachedInputTokens: execution.cachedInputTokens,
              costUsd: execution.costUsd,
              gatewayActualCostUsd: execution.gatewayActualCostUsd,
              estimatedCostUsd: execution.estimatedCostUsd,
              costSource: execution.costSource,
              latencyMs: execution.latencyMs,
              requestedAt: execution.requestedAt,
            };
          }
          return {
            ...execution,
            status: "completed",
            model,
            output: parsed.data,
            qualitySignals: qualitySignals(parsed.data, input),
          };
        } catch (error) {
          const gatewayError = error instanceof ModelGatewayError ? error : null;
          return {
            status: "failed",
            model,
            provider: gatewayError?.receipt?.provider ?? providerFromModel(model),
            errorCode: gatewayError?.message ?? "model_execution_failed",
            inputTokens: gatewayError?.receipt?.inputTokens ?? null,
            outputTokens: gatewayError?.receipt?.outputTokens ?? null,
            cachedInputTokens: gatewayError?.receipt?.cachedInputTokens ?? null,
            costUsd: gatewayError?.receipt?.costUsd ?? null,
            gatewayActualCostUsd: gatewayError?.receipt?.gatewayActualCostUsd ?? null,
            estimatedCostUsd: gatewayError?.receipt?.estimatedCostUsd ?? null,
            costSource: gatewayError?.receipt?.costSource ?? "unavailable",
            latencyMs: gatewayError?.latencyMs ?? 0,
            requestedAt: gatewayError?.receipt?.requestedAt ?? new Date().toISOString(),
          };
        }
      }));
      return { purpose: "benchmark", results };
    },
    async runOfficial(input) {
      const finishWithEscalation = async (
        attempts: AnalysisAttemptResult[],
        reasons: string[],
      ): Promise<OfficialAnalysisExecution> => {
        let escalationExecution: ModelExecution;
        try {
          escalationExecution = await gateway.analyze({ ...input, model: strategy.escalationModel, purpose: "official-analysis", role: "escalation" });
        } catch (error) {
          if (!(error instanceof ModelGatewayError)) throw error;
          const failed: FailedAnalysisAttempt = {
            role: "escalation",
            model: strategy.escalationModel,
            provider: error.receipt?.provider ?? providerFromModel(strategy.escalationModel),
            status: "failed",
            errorCode: error.message,
            inputTokens: error.receipt?.inputTokens ?? null,
            outputTokens: error.receipt?.outputTokens ?? null,
            cachedInputTokens: error.receipt?.cachedInputTokens ?? null,
            costUsd: error.receipt?.costUsd ?? null,
            gatewayActualCostUsd: error.receipt?.gatewayActualCostUsd ?? null,
            estimatedCostUsd: error.receipt?.estimatedCostUsd ?? null,
            costSource: error.receipt?.costSource ?? "unavailable",
            latencyMs: error.latencyMs,
            requestedAt: error.receipt?.requestedAt ?? new Date().toISOString(),
          };
          throw new AnalysisEngineError("escalation_failed", [...attempts, failed], reasons);
        }
        const escalationParsed = AnalysisOutputSchema.safeParse(escalationExecution.output);
        if (!escalationParsed.success) {
          const failed: FailedAnalysisAttempt = {
            role: "escalation",
            model: strategy.escalationModel,
            provider: escalationExecution.provider,
            status: "failed",
            errorCode: "schema_invalid",
            inputTokens: escalationExecution.inputTokens,
            outputTokens: escalationExecution.outputTokens,
            cachedInputTokens: escalationExecution.cachedInputTokens,
            costUsd: escalationExecution.costUsd,
            gatewayActualCostUsd: escalationExecution.gatewayActualCostUsd,
            estimatedCostUsd: escalationExecution.estimatedCostUsd,
            costSource: escalationExecution.costSource,
            latencyMs: escalationExecution.latencyMs,
            requestedAt: escalationExecution.requestedAt,
          };
          throw new AnalysisEngineError("escalation_failed", [...attempts, failed], reasons);
        }
        const escalationOutput = escalationParsed.data;
        const escalationSignals = qualitySignals(escalationOutput, input);
        return {
          status: "completed",
          output: escalationOutput,
          finalModel: strategy.escalationModel,
          escalated: true,
          escalationReasons: reasons,
          attempts: [...attempts, {
            ...escalationExecution,
            output: escalationOutput,
            role: "escalation",
            model: strategy.escalationModel,
            status: "completed",
            qualitySignals: escalationSignals,
          }],
        };
      };

      const technicalAttempts: FailedAnalysisAttempt[] = [];
      let execution: ModelExecution;
      for (let retry = 0; ; retry += 1) {
        try {
          execution = await gateway.analyze({ ...input, model: strategy.primaryModel, purpose: "official-analysis", role: "primary" });
          break;
        } catch (error) {
          if (!(error instanceof ModelGatewayError)) throw error;
          technicalAttempts.push({
            role: "primary",
            model: strategy.primaryModel,
            provider: error.receipt?.provider ?? providerFromModel(strategy.primaryModel),
            status: "failed",
            errorCode: error.message,
            inputTokens: error.receipt?.inputTokens ?? null,
            outputTokens: error.receipt?.outputTokens ?? null,
            cachedInputTokens: error.receipt?.cachedInputTokens ?? null,
            costUsd: error.receipt?.costUsd ?? null,
            gatewayActualCostUsd: error.receipt?.gatewayActualCostUsd ?? null,
            estimatedCostUsd: error.receipt?.estimatedCostUsd ?? null,
            costSource: error.receipt?.costSource ?? "unavailable",
            latencyMs: error.latencyMs,
            requestedAt: error.receipt?.requestedAt ?? new Date().toISOString(),
          });
          if (!error.retryable || retry >= strategy.maxTechnicalRetries) {
            return finishWithEscalation(technicalAttempts, [`primary_${error.message}`]);
          }
        }
      }
      const parsed = AnalysisOutputSchema.safeParse(execution.output);
      if (!parsed.success) {
        return finishWithEscalation([...technicalAttempts, {
          role: "primary",
          model: strategy.primaryModel,
          provider: execution.provider,
          status: "failed",
          errorCode: "schema_invalid",
          inputTokens: execution.inputTokens,
          outputTokens: execution.outputTokens,
          cachedInputTokens: execution.cachedInputTokens,
          costUsd: execution.costUsd,
          gatewayActualCostUsd: execution.gatewayActualCostUsd,
          estimatedCostUsd: execution.estimatedCostUsd,
          costSource: execution.costSource,
          latencyMs: execution.latencyMs,
          requestedAt: execution.requestedAt,
        }], ["primary_schema_invalid"]);
      }
      const output = parsed.data;
      const signals = qualitySignals(output, input);
      const reasons = escalationReasons(output, signals, strategy);
      const primaryAttempt: AnalysisAttemptResult = {
        ...execution,
        output,
        role: "primary",
        model: strategy.primaryModel,
        status: "completed",
        qualitySignals: signals,
      };
      if (reasons.length) {
        return finishWithEscalation([...technicalAttempts, primaryAttempt], reasons);
      }
      return {
        status: "completed",
        output,
        finalModel: strategy.primaryModel,
        escalated: false,
        escalationReasons: [],
        attempts: [...technicalAttempts, primaryAttempt],
      };
    },
  };
}
