import test from "node:test";
import assert from "node:assert/strict";
import { createConfidencePolicy } from "../src/confidence-policy";

const policy = createConfidencePolicy({
  version: "insider-confidence-v2",
  confidenceThreshold: 0.5,
  minimumGroundingRate: 0.5,
  requiredDimensionCoverageRate: 1,
  maximumScoreDimensionDelta: 15,
});

const scoreable = {
  scoreability: "scoreable" as const,
  confidence: 0.84,
  requiresHumanReview: false,
  evidenceGroundingRate: 0.8,
  dimensionCoverageRate: 1,
  scoreDimensionDelta: 4,
};

test("human review remains a flag and does not require escalation by itself", () => {
  const decision = policy.evaluate({ ...scoreable, requiresHumanReview: true });
  assert.deepEqual(decision, {
    policyVersion: "insider-confidence-v2",
    decision: "accept",
    escalationReasons: [],
    humanReviewRequested: true,
  });
});

test("auditable quality signals require escalation", () => {
  assert.deepEqual(
    policy.evaluate({ ...scoreable, evidenceGroundingRate: 0.49 }).escalationReasons,
    ["insufficient_grounding"],
  );
  assert.deepEqual(
    policy.evaluate({ ...scoreable, dimensionCoverageRate: 0.8 }).escalationReasons,
    ["incomplete_dimensions"],
  );
  assert.deepEqual(
    policy.evaluate({ ...scoreable, scoreDimensionDelta: 16 }).escalationReasons,
    ["inconsistent_score"],
  );
  assert.deepEqual(
    policy.evaluate({ ...scoreable, confidence: 0.49 }).escalationReasons,
    ["low_confidence"],
  );
});

test("human review plus poor grounding escalates only for grounding", () => {
  const decision = policy.evaluate({ ...scoreable, requiresHumanReview: true, evidenceGroundingRate: 0.2 });
  assert.equal(decision.decision, "escalate");
  assert.deepEqual(decision.escalationReasons, ["insufficient_grounding"]);
  assert.equal(decision.humanReviewRequested, true);
});

test("unscorable analysis is accepted without a performance score", () => {
  const decision = policy.evaluate({
    ...scoreable,
    scoreability: "unscorable",
    requiresHumanReview: true,
    evidenceGroundingRate: 0,
    scoreDimensionDelta: null,
  });
  assert.equal(decision.decision, "accept_unscorable");
  assert.equal(decision.performanceScore, null);
  assert.deepEqual(decision.escalationReasons, []);
});
