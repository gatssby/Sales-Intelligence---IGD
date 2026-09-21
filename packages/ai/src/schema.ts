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

export const AnalysisOutputSchema = z.object({
  overall_score: z.number().min(0).max(100),
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
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
