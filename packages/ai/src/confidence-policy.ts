export type ConfidencePolicySignals = {
  scoreability: "scoreable" | "unscorable";
  confidence: number;
  requiresHumanReview: boolean;
  evidenceGroundingRate: number;
  dimensionCoverageRate: number;
  scoreDimensionDelta: number | null;
};

export type ConfidencePolicyDecision = {
  policyVersion: string;
  decision: "accept" | "accept_unscorable" | "escalate";
  escalationReasons: string[];
  humanReviewRequested: boolean;
  performanceScore?: null;
};

export type ConfidencePolicy = {
  version: string;
  evaluate(signals: ConfidencePolicySignals): ConfidencePolicyDecision;
};

export function createConfidencePolicy(config: {
  version: string;
  confidenceThreshold: number;
  minimumGroundingRate: number;
  requiredDimensionCoverageRate: number;
  maximumScoreDimensionDelta: number;
}): ConfidencePolicy {
  if (!config.version.trim()) throw new Error("confidence_policy_version_required");
  const rates = [config.confidenceThreshold, config.minimumGroundingRate, config.requiredDimensionCoverageRate];
  if (rates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("invalid_confidence_policy_rate");
  }
  if (!Number.isFinite(config.maximumScoreDimensionDelta) || config.maximumScoreDimensionDelta < 0) {
    throw new Error("invalid_score_dimension_delta");
  }

  return {
    version: config.version,
    evaluate(signals) {
      if (signals.scoreability === "unscorable") {
        return {
          policyVersion: config.version,
          decision: "accept_unscorable",
          escalationReasons: [],
          humanReviewRequested: signals.requiresHumanReview,
          performanceScore: null,
        };
      }
      const reasons: string[] = [];
      if (signals.confidence < config.confidenceThreshold) reasons.push("low_confidence");
      if (signals.evidenceGroundingRate < config.minimumGroundingRate) reasons.push("insufficient_grounding");
      if (signals.dimensionCoverageRate < config.requiredDimensionCoverageRate) reasons.push("incomplete_dimensions");
      if (signals.scoreDimensionDelta !== null && signals.scoreDimensionDelta > config.maximumScoreDimensionDelta) {
        reasons.push("inconsistent_score");
      }
      return {
        policyVersion: config.version,
        decision: reasons.length ? "escalate" : "accept",
        escalationReasons: reasons,
        humanReviewRequested: signals.requiresHumanReview,
      };
    },
  };
}
