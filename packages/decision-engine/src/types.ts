import { z } from "zod";

export const DecisionEvidenceSchema = z.object({
  timestampMs: z.number().int().nonnegative().nullable().optional(),
  speaker: z.string().min(1).nullable().optional(),
  quote: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const DecisionSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  score: z.number().min(0).max(1).nullable().optional(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)).default({}),
  evidence: z.array(DecisionEvidenceSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const DecisionResponseSchema = z.object({
  model: z.string().min(1).optional(),
  modelVersion: z.string().min(1).optional(),
  decisions: z.array(DecisionSchema).min(1),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.number().nonnegative().nullable().optional(),
  }).default({}),
  latencyMs: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type DecisionEvidence = z.infer<typeof DecisionEvidenceSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionRequest = {
  subjectType: "lead" | "call" | "batch";
  subjectId: string;
  input: unknown;
  questions?: unknown;
  schemaVersion?: string;
  decisionKeys?: string[];
};
export type DecisionResponse = z.infer<typeof DecisionResponseSchema> & {
  provider: string;
  model: string;
  modelVersion: string;
  latencyMs: number;
};
export type ProviderHealth = { available: true; device?: string } | { available: false; reason: string };
export type DecisionProvider = {
  provider: string;
  model: string;
  modelVersion: string;
  decide(request: DecisionRequest): Promise<Omit<DecisionResponse, "provider" | "model" | "modelVersion" | "latencyMs"> & { latencyMs?: number }>;
  health?(): Promise<ProviderHealth>;
};
export type DecisionRunRecord = DecisionResponse & {
  id: string;
  subjectType: DecisionRequest["subjectType"];
  subjectId: string;
  engineFamily: string;
  analysisGeneration: number;
  schemaVersion: string;
  createdAt: string;
};
