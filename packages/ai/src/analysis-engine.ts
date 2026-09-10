import { AnalysisOutputSchema, type AnalysisOutput } from "./schema";
import { createConfidencePolicy } from "./confidence-policy";

export type AnalysisEngineInput = {
  transcript: string;
  rubric: string;
  promptVersion: string;
  expectedDimensionKeys: string[];
};

export type AnalysisStrategy = {
  version: string;
  confidencePolicyVersion?: string;
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
  scoreDimensionDelta: number | null;
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
  confidencePolicyVersion: string;
  analysisEligibility: "scoreable" | "unscorable";
  performanceScore: number | null;
  humanReviewRequested: boolean;
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

export type AnalysisEngineObserver = {
  onPhase?(phase: "analyzing_primary" | "escalation_required" | "analyzing_escalation"): Promise<void> | void;
  onRequest?(request: { role: "primary" | "escalation"; model: string }): Promise<void> | void;
  onAttempt?(attempt: AnalysisAttemptResult): Promise<void> | void;
};

export type OfficialAnalysisResume = {
  attempts: AnalysisAttemptResult[];
  escalationReasons: string[];
};

export interface AnalysisEngine {
  runOfficial(input: AnalysisEngineInput, observer?: AnalysisEngineObserver, resume?: OfficialAnalysisResume): Promise<OfficialAnalysisExecution>;
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
    scoreDimensionDelta: output.overall_score === null ? null : Math.abs(output.overall_score - dimensionAverage),
  };
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
  const confidencePolicy = createConfidencePolicy({
    version: strategy.confidencePolicyVersion ?? "insider-confidence-v2",
    confidenceThreshold: strategy.confidenceThreshold,
    minimumGroundingRate: 0.5,
    requiredDimensionCoverageRate: 1,
    maximumScoreDimensionDelta: 15,
  });

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
    async runOfficial(input, observer = {}, resume) {
      const finishWithEscalation = async (
        attempts: AnalysisAttemptResult[],
        reasons: string[],
      ): Promise<OfficialAnalysisExecution> => {
        await observer.onPhase?.("escalation_required");
        await observer.onPhase?.("analyzing_escalation");
        await observer.onRequest?.({ role: "escalation", model: strategy.escalationModel });
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
          await observer.onAttempt?.(failed);
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
          await observer.onAttempt?.(failed);
          throw new AnalysisEngineError("escalation_failed", [...attempts, failed], reasons);
        }
        const escalationOutput = escalationParsed.data;
        const escalationSignals = qualitySignals(escalationOutput, input);
        const escalationDecision = confidencePolicy.evaluate({
          scoreability: escalationOutput.scoreability,
          confidence: escalationOutput.confidence,
          requiresHumanReview: escalationOutput.requires_human_review,
          ...escalationSignals,
        });
        const escalationAttempt: CompletedAnalysisAttempt = {
          ...escalationExecution,
          output: escalationOutput,
          role: "escalation",
          model: strategy.escalationModel,
          status: "completed",
          qualitySignals: escalationSignals,
        };
        await observer.onAttempt?.(escalationAttempt);
        return {
          status: "completed",
          output: escalationOutput,
          finalModel: strategy.escalationModel,
          escalated: true,
          escalationReasons: reasons,
          attempts: [...attempts, escalationAttempt],
          confidencePolicyVersion: confidencePolicy.version,
          analysisEligibility: escalationOutput.scoreability,
          performanceScore: escalationDecision.performanceScore === null ? null : escalationOutput.overall_score,
          humanReviewRequested: escalationOutput.requires_human_review,
        };
      };

      if (resume) return finishWithEscalation(resume.attempts, resume.escalationReasons);

      await observer.onPhase?.("analyzing_primary");
      const technicalAttempts: FailedAnalysisAttempt[] = [];
      let execution: ModelExecution;
      for (let retry = 0; ; retry += 1) {
        try {
          await observer.onRequest?.({ role: "primary", model: strategy.primaryModel });
          execution = await gateway.analyze({ ...input, model: strategy.primaryModel, purpose: "official-analysis", role: "primary" });
          break;
        } catch (error) {
          if (!(error instanceof ModelGatewayError)) throw error;
          const failedAttempt: FailedAnalysisAttempt = {
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
          };
          technicalAttempts.push(failedAttempt);
          await observer.onAttempt?.(failedAttempt);
          if (!error.retryable || retry >= strategy.maxTechnicalRetries) {
            throw new AnalysisEngineError("primary_failed", technicalAttempts, []);
          }
        }
      }
      const parsed = AnalysisOutputSchema.safeParse(execution.output);
      if (!parsed.success) {
        const failedAttempt: FailedAnalysisAttempt = {
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
        };
        await observer.onAttempt?.(failedAttempt);
        return finishWithEscalation([...technicalAttempts, failedAttempt], ["primary_schema_invalid"]);
      }
      const output = parsed.data;
      const signals = qualitySignals(output, input);
      const decision = confidencePolicy.evaluate({
        scoreability: output.scoreability,
        confidence: output.confidence,
        requiresHumanReview: output.requires_human_review,
        ...signals,
      });
      const reasons = decision.escalationReasons;
      const primaryAttempt: AnalysisAttemptResult = {
        ...execution,
        output,
        role: "primary",
        model: strategy.primaryModel,
        status: "completed",
        qualitySignals: signals,
      };
      await observer.onAttempt?.(primaryAttempt);
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
        confidencePolicyVersion: confidencePolicy.version,
        analysisEligibility: output.scoreability,
        performanceScore: decision.performanceScore === null ? null : output.overall_score,
        humanReviewRequested: output.requires_human_review,
      };
    },
  };
}
