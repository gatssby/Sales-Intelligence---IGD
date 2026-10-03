/**
 * Frozen benchmark metrics. Classification metrics are delegated to the
 * existing `evaluateLabeledPredictions`; this module adds only the pieces that
 * frozen protocol v01 requires and the existing evaluator does not provide:
 * latency percentiles, parse/schema success rate, explicit abstention rate,
 * score metrics with +/-1 tolerance, and a `pending` state so quality is never
 * invented before human labels exist.
 */

import { evaluateLabeledPredictions, type LabeledPrediction } from "./benchmark.js";
import {
  BENCHMARK_ABSTENTION_MIN_CONFIDENCE,
  BENCHMARK_METRICS_VERSION,
  BENCHMARK_DECISIONS,
  BENCHMARK_SCORED_ADJUDICATION_STATUSES,
  type BenchmarkAdjudicationStatus,
  type BenchmarkDecisionContract,
} from "./benchmark-protocol.js";

export type BenchmarkPredictionRecord = {
  readonly canonicalLogicalCallKey: string;
  readonly decisionId: string;
  readonly value: boolean | string | number | null;
  readonly confidence: number;
  readonly outputParsed: boolean;
  readonly retries: number;
  readonly errorCode: string | null;
  readonly latencyMs: number;
  readonly costUsd: number | null;
};

export type BenchmarkGroundTruthRecord = {
  readonly canonicalLogicalCallKey: string;
  readonly decisionId: string;
  readonly label: boolean | string | number | null;
  readonly adjudicationStatus: BenchmarkAdjudicationStatus;
};

export type BenchmarkRunInput = {
  readonly engine: "jev" | "laya";
  readonly engineModel: string;
  readonly engineModelVersion: string;
  readonly predictions: readonly BenchmarkPredictionRecord[];
  readonly groundTruth: readonly BenchmarkGroundTruthRecord[];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
};

function percentile(values: readonly number[], probability: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function scoreMetrics(rows: readonly { label: number; value: number }[]) {
  if (!rows.length) return { n: 0, mae: null, rmse: null, exactMatchRate: null, withinOneRate: null, meanBias: null };
  const errors = rows.map((row) => row.value - row.label);
  const absolute = errors.map(Math.abs);
  return {
    n: rows.length,
    mae: absolute.reduce((sum, value) => sum + value, 0) / absolute.length,
    rmse: Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length),
    exactMatchRate: absolute.filter((value) => value === 0).length / absolute.length,
    withinOneRate: absolute.filter((value) => value <= 1).length / absolute.length,
    meanBias: errors.reduce((sum, value) => sum + value, 0) / errors.length,
  };
}

export function evaluateBenchmarkRun(input: BenchmarkRunInput) {
  if (!["jev", "laya"].includes(input.engine)) throw new Error("benchmark_engine_invalid");
  if (!(input.finishedAtMs >= input.startedAtMs)) throw new Error("benchmark_window_invalid");
  const decisionById = new Map<string, BenchmarkDecisionContract>(BENCHMARK_DECISIONS.map((decision) => [decision.decisionId, decision]));
  const groundTruthByIdentity = new Map(input.groundTruth.map((entry) => [`${entry.canonicalLogicalCallKey}:${entry.decisionId}`, entry]));
  const byDecision: Record<string, Record<string, unknown>> = {};
  const qualityPending: string[] = [];

  for (const decision of BENCHMARK_DECISIONS) {
    const rows = input.predictions.filter((prediction) => prediction.decisionId === decision.decisionId);
    const truthRecords = input.groundTruth.filter((entry) => entry.decisionId === decision.decisionId);
    const scorable = (entry: BenchmarkGroundTruthRecord | undefined): boolean => (
      entry !== undefined
      && entry.label !== null
      && BENCHMARK_SCORED_ADJUDICATION_STATUSES.includes(entry.adjudicationStatus)
    );
    const labeled = rows.filter((row) => scorable(groundTruthByIdentity.get(`${row.canonicalLogicalCallKey}:${row.decisionId}`)));
    const adjudication = {
      unlabeled: truthRecords.filter((entry) => entry.adjudicationStatus === "unlabeled").length,
      labeled: truthRecords.filter((entry) => entry.adjudicationStatus === "labeled").length,
      needsReview: truthRecords.filter((entry) => entry.adjudicationStatus === "needs_review").length,
      ambiguous: truthRecords.filter((entry) => entry.adjudicationStatus === "ambiguous").length,
      insufficientEvidence: truthRecords.filter((entry) => entry.adjudicationStatus === "insufficient_evidence").length,
    };
    const abstentions = rows.filter((row) => row.value === null || row.confidence < BENCHMARK_ABSTENTION_MIN_CONFIDENCE);
    const costRows = rows.filter((row) => row.costUsd !== null);
    const operational = {
      predicted: rows.length,
      abstentions: abstentions.length,
      abstentionRate: rate(abstentions.length, rows.length),
      parseSuccessRate: rate(rows.filter((row) => row.outputParsed).length, rows.length),
      retries: rows.reduce((sum, row) => sum + row.retries, 0),
      errors: rows.filter((row) => row.errorCode !== null).length,
      latencyMs: {
        p50: percentile(rows.map((row) => row.latencyMs), 0.5),
        p95: percentile(rows.map((row) => row.latencyMs), 0.95),
      },
      costStatus: costRows.length === rows.length && rows.length > 0 ? "available" as const : costRows.length === 0 ? "unavailable" as const : "partial" as const,
      costUsd: costRows.length ? costRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) : null,
      costPerDecisionUsd: costRows.length ? costRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) / costRows.length : null,
    };

    if (!labeled.length) {
      qualityPending.push(decision.decisionId);
      byDecision[decision.decisionId] = { outputType: decision.outputType, adjudication, operational, quality: "pending", pendingReason: "no_human_label_available" };
      continue;
    }

    if (decision.outputType === "score") {
      const scoreRows = labeled.flatMap((row) => {
        const truth = groundTruthByIdentity.get(`${row.canonicalLogicalCallKey}:${row.decisionId}`)!;
        return row.value === null || typeof row.value !== "number" || typeof truth.label !== "number"
          ? []
          : [{ label: truth.label, value: row.value }];
      });
      byDecision[decision.decisionId] = { outputType: decision.outputType, adjudication, operational, quality: scoreMetrics(scoreRows) };
      continue;
    }

    const labeledPredictions: LabeledPrediction[] = labeled.flatMap((row) => {
      const truth = groundTruthByIdentity.get(`${row.canonicalLogicalCallKey}:${row.decisionId}`)!;
      if (row.value === null) return [];
      return [{
        callId: row.canonicalLogicalCallKey,
        decisionKey: row.decisionId,
        humanValue: truth.label as string | number | boolean,
        provider: input.engine,
        value: row.value,
        confidence: row.confidence,
        probabilities: {},
        latencyMs: row.latencyMs,
        costUsd: row.costUsd ?? undefined,
      }];
    });
    const evaluated = evaluateLabeledPredictions(labeledPredictions).byDecision[decision.decisionId]?.[input.engine];
    const binary = decision.outputType === "yes_no";
    byDecision[decision.decisionId] = {
      outputType: decision.outputType,
      adjudication,
      operational,
      quality: {
        labeled: evaluated?.resolved ?? 0,
        accuracy: evaluated?.accuracy ?? null,
        precision: evaluated?.precision ?? null,
        recall: evaluated?.recall ?? null,
        f1: evaluated?.f1 ?? null,
        macroF1: binary ? null : evaluated?.f1 ?? null,
        confusionMatrix: evaluated?.confusionMatrix ?? {},
        falsePositives: binary ? labeled.filter((row) => groundTruthByIdentity.get(`${row.canonicalLogicalCallKey}:${row.decisionId}`)!.label === false && row.value === true).length : null,
        falseNegatives: binary ? labeled.filter((row) => groundTruthByIdentity.get(`${row.canonicalLogicalCallKey}:${row.decisionId}`)!.label === true && row.value === false).length : null,
      },
    };
  }

  const throughputDurationMs = Math.max(1, input.finishedAtMs - input.startedAtMs);
  const decisionGroups = decisionById.size;
  const overallCostRows = input.predictions.filter((row) => row.costUsd !== null);
  return {
    version: BENCHMARK_METRICS_VERSION,
    engine: { name: input.engine, model: input.engineModel, modelVersion: input.engineModelVersion },
    operational: {
      decisions: input.predictions.length,
      distinctDecisionContracts: decisionGroups,
      throughputPerMinute: input.predictions.length / (throughputDurationMs / 60_000),
      parseSuccessRate: rate(input.predictions.filter((row) => row.outputParsed).length, input.predictions.length),
      abstentionRate: rate(input.predictions.filter((row) => row.value === null || row.confidence < BENCHMARK_ABSTENTION_MIN_CONFIDENCE).length, input.predictions.length),
      retries: input.predictions.reduce((sum, row) => sum + row.retries, 0),
      errors: input.predictions.filter((row) => row.errorCode !== null).length,
      latencyMs: {
        p50: percentile(input.predictions.map((row) => row.latencyMs), 0.5),
        p95: percentile(input.predictions.map((row) => row.latencyMs), 0.95),
      },
      costStatus: input.predictions.length > 0 && overallCostRows.length === input.predictions.length
        ? "available" as const
        : overallCostRows.length === 0 ? "unavailable" as const : "partial" as const,
      costUsd: overallCostRows.length ? overallCostRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) : null,
      costPerCallUsd: overallCostRows.length ? overallCostRows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) / input.predictions.length : null,
    },
    byDecision,
    qualityStatus: qualityPending.length === BENCHMARK_DECISIONS.length ? "pending" as const : qualityPending.length ? "partial" as const : "scored" as const,
    pendingDecisions: qualityPending.sort(),
    confidenceCalibrated: false as const,
    winnerDeclared: false as const,
  };
}