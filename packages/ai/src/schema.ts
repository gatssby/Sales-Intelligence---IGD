import { z } from "zod";

export const AnalysisDimensionSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().min(0).max(100),
  rationale: z.string(),
});

export const AnalysisEvidenceSchema = z.object({
  timestamp: z.string(),
  speaker: z.string(),
  criterion: z.string(),
  quote: z.string(),
  interpretation: z.string(),
});

const commonOutputShape = {
  opportunity_quality: z.enum(["high", "medium", "low", "unqualified", "unknown"]),
  opportunity_quality_label: z.string(),
  call_outcome: z.enum(["sold", "not_sold", "disqualified", "follow_up", "unknown"]),
  call_outcome_label: z.string(),
  confidence: z.number().min(0).max(1),
  executive_summary: z.string(),
  strengths: z.array(z.string()),
  critical_failures: z.array(z.string()),
  objections: z.array(z.string()),
  coaching_actions: z.array(z.string()),
  dimensions: z.array(AnalysisDimensionSchema),
  evidence: z.array(AnalysisEvidenceSchema),
  requires_human_review: z.boolean(),
};

export const AnalysisOutputSchema = z.object({
  scoreability: z.enum(["scoreable", "unscorable"]),
  unscorable_reason: z.string().min(1).nullable(),
  overall_score: z.number().min(0).max(100).nullable(),
  ...commonOutputShape,
}).superRefine((output, context) => {
  if (output.scoreability === "scoreable" && output.overall_score === null) {
    context.addIssue({ code: "custom", path: ["overall_score"], message: "scoreable_analysis_requires_score" });
  }
  if (output.scoreability === "unscorable" && output.overall_score !== null) {
    context.addIssue({ code: "custom", path: ["overall_score"], message: "unscorable_analysis_must_not_have_score" });
  }
  if (output.scoreability === "unscorable" && output.unscorable_reason === null) {
    context.addIssue({ code: "custom", path: ["unscorable_reason"], message: "unscorable_analysis_requires_reason" });
  }
  if (output.scoreability === "scoreable" && output.unscorable_reason !== null) {
    context.addIssue({ code: "custom", path: ["unscorable_reason"], message: "scoreable_analysis_must_not_have_unscorable_reason" });
  }
});

const LegacyAnalysisOutputSchema = z.object({
  overall_score: z.number().min(0).max(100),
  ...commonOutputShape,
}).transform((output) => ({
  ...output,
  scoreability: "scoreable" as const,
  unscorable_reason: null,
}));

export const StoredAnalysisOutputSchema = z.union([AnalysisOutputSchema, LegacyAnalysisOutputSchema]);

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
