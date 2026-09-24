import { z } from "zod";
import { DecisionResponseSchema, type Decision, type DecisionProvider, type DecisionRequest, type ProviderHealth } from "./types.js";

type FetchLike = typeof fetch;
export type JevTransport = "vercel-ai-gateway" | "typesafe-direct";
export type JevLiveStatus = {
  configured: boolean;
  reachable: boolean | null;
  authorized: boolean | null;
  billingAvailable: boolean | null;
  liveAvailable: boolean | null;
  reason?: string;
};

const ProbabilityMapSchema = z.record(z.string().min(1), z.number().min(0).max(1));
const GatewayAnswerSchema = z.object({
  choice: z.union([z.string(), z.number(), z.boolean()]).optional(),
  probability: z.number().min(0).max(1).optional(),
  score: z.number().finite().optional(),
  probabilities: ProbabilityMapSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
}).passthrough();
const GatewayResponseSchema = z.object({
  model: z.string().min(1).optional(),
  answers: z.record(z.string().min(1), GatewayAnswerSchema).refine((answers) => Object.keys(answers).length > 0, "gateway_answers_required"),
  providerMetadata: z.object({
    typesafe: z.object({ confidence: z.record(z.string().min(1), z.number().min(0).max(1)).optional() }).optional(),
  }).optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.number().nonnegative().nullable().optional(),
  }).default({}),
});
const TypedQuestionSchema = z.object({
  type: z.enum(["choice", "noul", "score"]),
  instructions: z.string().min(1),
}).passthrough();
const TypedQuestionsSchema = z.record(z.string().min(1), TypedQuestionSchema);

function validatedDistribution(probabilities: Record<string, number>, key: string): Record<string, number> {
  if (!(key in probabilities)) throw new Error("provider_response_probability_missing_selected_value");
  const total = Object.values(probabilities).reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 1) > 0.02) throw new Error("provider_response_probability_distribution_invalid");
  return probabilities;
}

function requireExactKeys(actual: Record<string, number>, expected: string[], errorCode: string): void {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error(errorCode);
}

function gatewayQuestions(questions: unknown): Record<string, Record<string, unknown>> {
  const parsed = TypedQuestionsSchema.parse(questions ?? {});
  return Object.fromEntries(Object.entries(parsed).map(([key, question]) => [
    key,
    question.type === "noul" ? { ...question, type: "boolean" } : question,
  ]));
}

function mapGatewayDecision(
  key: string,
  question: z.infer<typeof TypedQuestionSchema>,
  answer: z.infer<typeof GatewayAnswerSchema>,
  providerConfidence: number | undefined,
): Decision {
  if (question.type === "noul") {
    if (answer.probability === undefined) throw new Error("provider_response_boolean_probability_required");
    const probabilities = { false: 1 - answer.probability, true: answer.probability };
    return {
      key,
      value: answer.probability >= 0.5,
      score: answer.probability,
      confidence: answer.confidence ?? providerConfidence ?? Math.max(answer.probability, 1 - answer.probability),
      probabilities,
      evidence: [],
      metadata: { transportType: "boolean" },
    };
  }

  if (question.type === "choice") {
    if (answer.choice === undefined || !answer.probabilities) throw new Error("provider_response_choice_required");
    const criteria = z.record(z.string().min(1), z.string().min(1)).safeParse(question.criteria);
    if (!criteria.success) throw new Error("provider_response_choice_schema_invalid");
    const selected = String(answer.choice);
    const probabilities = validatedDistribution(answer.probabilities, selected);
    requireExactKeys(probabilities, Object.keys(criteria.data), "provider_response_choice_out_of_schema");
    return {
      key,
      value: answer.choice,
      score: probabilities[selected]!,
      confidence: answer.confidence ?? providerConfidence ?? probabilities[selected]!,
      probabilities,
      evidence: [],
      metadata: { transportType: "choice" },
    };
  }

  if (answer.score === undefined || !answer.probabilities) throw new Error("provider_response_score_required");
  const minimum = Number(question.minimum);
  const maximum = Number(question.maximum);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= minimum || !Number.isInteger(answer.score) || answer.score < minimum || answer.score > maximum) {
    throw new Error("provider_response_score_out_of_schema");
  }
  const selected = String(answer.score);
  const probabilities = validatedDistribution(answer.probabilities, selected);
  requireExactKeys(probabilities, Array.from({ length: maximum - minimum + 1 }, (_, index) => String(minimum + index)), "provider_response_score_out_of_schema");
  return {
    key,
    value: answer.score,
    score: (answer.score - minimum) / (maximum - minimum),
    confidence: answer.confidence ?? providerConfidence ?? probabilities[selected]!,
    probabilities,
    evidence: [],
    metadata: { transportType: "score", scoreScale: { minimum, maximum } },
  };
}

export class JevDecisionEngine implements DecisionProvider {
  readonly provider = "jev";
  readonly model: string;
  readonly modelVersion: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly transport: JevTransport;

  constructor(options: { apiKey?: string; baseUrl?: string; model?: string; modelVersion?: string; transport?: JevTransport; fetch?: FetchLike } = {}) {
    this.transport = options.transport ?? (process.env.JEV_TRANSPORT === "typesafe-direct" ? "typesafe-direct" : "vercel-ai-gateway");
    this.apiKey = options.apiKey ?? (this.transport === "vercel-ai-gateway" ? process.env.AI_GATEWAY_API_KEY : process.env.JEV_API_KEY);
    this.baseUrl = (options.baseUrl ?? (this.transport === "vercel-ai-gateway" ? process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1" : process.env.JEV_BASE_URL ?? "https://thejevai.com")).replace(/\/$/, "");
    this.model = options.model ?? (this.transport === "vercel-ai-gateway" ? process.env.JEV_MODEL ?? "typesafe-ai/jev" : process.env.JEV_MODEL ?? "jev-latest");
    this.modelVersion = options.modelVersion ?? process.env.JEV_MODEL_VERSION ?? "unknown";
    this.fetcher = options.fetch ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    return this.apiKey ? { available: true } : { available: false, reason: this.transport === "vercel-ai-gateway" ? "missing_ai_gateway_api_key" : "missing_api_key" };
  }

  async liveStatus(): Promise<JevLiveStatus> {
    return this.apiKey
      ? { configured: true, reachable: null, authorized: null, billingAvailable: null, liveAvailable: null }
      : { configured: false, reachable: null, authorized: null, billingAvailable: null, liveAvailable: false, reason: this.transport === "vercel-ai-gateway" ? "missing_ai_gateway_api_key" : "missing_api_key" };
  }

  async decide(request: DecisionRequest) {
    if (!this.apiKey) throw new Error(this.transport === "vercel-ai-gateway" ? "missing_ai_gateway_api_key" : "missing_api_key");
    if (this.transport !== "vercel-ai-gateway") throw new Error("typesafe_direct_transport_not_implemented");
    const questions = TypedQuestionsSchema.parse(request.questions ?? {});
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/evaluate`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, state: request.input, questions: gatewayQuestions(questions) }),
      });
    } catch (error) {
      throw Object.assign(new Error("provider_network_error"), { retryable: true, cause: error });
    }
    if (!response.ok) {
      const error = new Error(`provider_http_${response.status}`);
      throw Object.assign(error, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
    }
    const body: unknown = await response.json();
    const parsed = GatewayResponseSchema.parse(body);
    const responseKeys = Object.keys(parsed.answers).sort();
    const questionKeys = Object.keys(questions).sort();
    if (JSON.stringify(responseKeys) !== JSON.stringify(questionKeys)) throw new Error("provider_response_question_set_mismatch");
    const decisions = questionKeys.map((key) => mapGatewayDecision(
      key,
      questions[key]!,
      parsed.answers[key]!,
      parsed.providerMetadata?.typesafe?.confidence?.[key],
    ));
    return DecisionResponseSchema.parse({
      model: parsed.model ?? this.model,
      decisions,
      usage: parsed.usage,
      metadata: { transport: this.transport, httpStatus: response.status },
      latencyMs: performance.now() - startedAt,
    });
  }
}