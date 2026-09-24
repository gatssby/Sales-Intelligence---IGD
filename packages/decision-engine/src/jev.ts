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
const TypesafeNoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});
const TypesafeChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  confidence: z.number().min(0).max(1),
  probabilities: ProbabilityMapSchema,
});
const TypesafeScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().finite(),
  confidence: z.number().min(0).max(1),
  legend: z.record(z.string().min(1), z.unknown()),
  probabilities: ProbabilityMapSchema,
});
const TypesafeResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string().min(1), z.discriminatedUnion("type", [
    TypesafeNoulAnswerSchema,
    TypesafeChoiceAnswerSchema,
    TypesafeScoreAnswerSchema,
  ])).refine((answers) => Object.keys(answers).length > 0, "typesafe_answers_required"),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
const TypesafeModelsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string().min(1),
    description: z.string(),
    release_date: z.string(),
  })).min(1),
});
const TypedQuestionSchema = z.object({
  type: z.enum(["choice", "noul", "score"]),
  instructions: z.string().min(1),
}).passthrough();
const TypedQuestionsSchema = z.record(z.string().min(1), TypedQuestionSchema);

function validatedDistribution(probabilities: Record<string, number>, selectedKey?: string): Record<string, number> {
  if (selectedKey !== undefined && !(selectedKey in probabilities)) throw new Error("provider_response_probability_missing_selected_value");
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

function typesafeQuestions(questions: Record<string, z.infer<typeof TypedQuestionSchema>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(questions).map(([key, question]) => {
    if (question.type === "choice") return [key, { type: "choice", instructions: question.instructions, criteria: question.criteria }];
    if (question.type === "noul") return [key, { type: "noul", instructions: question.instructions }];
    const minimum = Number(question.minimum);
    const maximum = Number(question.maximum);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= minimum) throw new Error("provider_request_score_schema_invalid");
    return [key, {
      type: "score",
      instructions: question.instructions,
      criteria: Array.from({ length: maximum - minimum + 1 }, (_, index) => String(minimum + index)),
    }];
  }));
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

function mapTypesafeDecision(
  key: string,
  question: z.infer<typeof TypedQuestionSchema>,
  answer: z.infer<typeof TypesafeResponseSchema>["answers"][string],
): Decision {
  if (question.type === "noul") {
    if (answer.type !== "noul") throw new Error("provider_response_type_mismatch");
    const probabilities = { false: 1 - answer.noul, true: answer.noul };
    return {
      key,
      value: answer.noul >= 0.5,
      score: answer.noul,
      confidence: Math.max(answer.noul, 1 - answer.noul),
      probabilities,
      evidence: [],
      metadata: { transportType: "noul" },
    };
  }

  if (question.type === "choice") {
    if (answer.type !== "choice") throw new Error("provider_response_type_mismatch");
    const criteria = z.record(z.string().min(1), z.string().min(1)).safeParse(question.criteria);
    if (!criteria.success) throw new Error("provider_response_choice_schema_invalid");
    const probabilities = validatedDistribution(answer.probabilities, answer.choice);
    requireExactKeys(probabilities, Object.keys(criteria.data), "provider_response_choice_out_of_schema");
    return {
      key,
      value: answer.choice,
      score: probabilities[answer.choice]!,
      confidence: answer.confidence,
      probabilities,
      evidence: [],
      metadata: { transportType: "choice" },
    };
  }

  if (answer.type !== "score") throw new Error("provider_response_type_mismatch");
  const minimum = Number(question.minimum);
  const maximum = Number(question.maximum);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= minimum) throw new Error("provider_response_score_out_of_schema");
  const levels = maximum - minimum + 1;
  if (answer.score < 0 || answer.score > levels - 1) throw new Error("provider_response_score_out_of_schema");
  // TypeSafe score criteria are positional: index zero is the first requested
  // domain level. Preserve that provider scale explicitly before translating it.
  const providerLevels = Array.from({ length: levels }, (_, index) => String(index));
  const legendKeys = Object.keys(answer.legend).sort();
  if (JSON.stringify(legendKeys) !== JSON.stringify(providerLevels)) throw new Error("provider_response_score_legend_out_of_schema");
  const directProbabilities = validatedDistribution(answer.probabilities);
  requireExactKeys(directProbabilities, providerLevels, "provider_response_score_out_of_schema");
  const probabilities = Object.fromEntries(Object.entries(directProbabilities).map(([level, probability]) => [String(Number(level) + minimum), probability]));
  return {
    key,
    value: answer.score + minimum,
    score: answer.score / (levels - 1),
    confidence: answer.confidence,
    probabilities,
    evidence: [],
    metadata: {
      transportType: "score",
      scoreScale: { minimum, maximum },
      providerScore: answer.score,
      providerLegend: answer.legend,
    },
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
    this.transport = options.transport ?? (process.env.JEV_TRANSPORT === "vercel-ai-gateway" ? "vercel-ai-gateway" : "typesafe-direct");
    this.apiKey = options.apiKey ?? (this.transport === "vercel-ai-gateway" ? process.env.AI_GATEWAY_API_KEY : process.env.TYPESAFE_API_KEY);
    this.baseUrl = (options.baseUrl ?? (this.transport === "vercel-ai-gateway" ? process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1" : process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai")).replace(/\/$/, "");
    this.model = options.model ?? (this.transport === "vercel-ai-gateway" ? process.env.JEV_MODEL ?? "typesafe-ai/jev" : process.env.JEV_MODEL ?? "jev-latest");
    this.modelVersion = options.modelVersion ?? process.env.JEV_MODEL_VERSION ?? "unknown";
    this.fetcher = options.fetch ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    return this.apiKey ? { available: true } : { available: false, reason: this.transport === "vercel-ai-gateway" ? "missing_ai_gateway_api_key" : "missing_typesafe_api_key" };
  }

  async liveStatus(): Promise<JevLiveStatus> {
    if (!this.apiKey) {
      return { configured: false, reachable: null, authorized: null, billingAvailable: null, liveAvailable: false, reason: this.transport === "vercel-ai-gateway" ? "missing_ai_gateway_api_key" : "missing_typesafe_api_key" };
    }
    if (this.transport === "vercel-ai-gateway") return { configured: true, reachable: null, authorized: null, billingAvailable: null, liveAvailable: null };
    try {
      const response = await this.fetcher(`${this.baseUrl}/v1/models`, { method: "GET", headers: { authorization: `Bearer ${this.apiKey}` } });
      if (!response.ok) {
        return {
          configured: true,
          reachable: true,
          authorized: response.status === 401 || response.status === 403 ? false : null,
          billingAvailable: null,
          liveAvailable: false,
          reason: `models_http_${response.status}`,
        };
      }
      const models = TypesafeModelsResponseSchema.parse(await response.json());
      if (!models.models.some((model) => model.name === this.model)) {
        return { configured: true, reachable: true, authorized: true, billingAvailable: true, liveAvailable: false, reason: "configured_model_unavailable" };
      }
      return { configured: true, reachable: true, authorized: true, billingAvailable: true, liveAvailable: true };
    } catch {
      return { configured: true, reachable: false, authorized: null, billingAvailable: null, liveAvailable: false, reason: "models_network_or_response_error" };
    }
  }

  async decide(request: DecisionRequest) {
    if (!this.apiKey) throw new Error(this.transport === "vercel-ai-gateway" ? "missing_ai_gateway_api_key" : "missing_typesafe_api_key");
    const questions = TypedQuestionsSchema.parse(request.questions ?? {});
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(this.transport === "vercel-ai-gateway" ? `${this.baseUrl}/evaluate` : `${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, state: request.input, questions: this.transport === "vercel-ai-gateway" ? gatewayQuestions(questions) : typesafeQuestions(questions) }),
      });
    } catch (error) {
      throw Object.assign(new Error("provider_network_error"), { retryable: true, cause: error });
    }
    if (!response.ok) {
      const error = new Error(`provider_http_${response.status}`);
      throw Object.assign(error, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
    }
    try {
      const body: unknown = await response.json();
      const questionKeys = Object.keys(questions).sort();
      if (this.transport === "vercel-ai-gateway") {
        const parsed = GatewayResponseSchema.parse(body);
        if (JSON.stringify(Object.keys(parsed.answers).sort()) !== JSON.stringify(questionKeys)) throw new Error("provider_response_question_set_mismatch");
        return DecisionResponseSchema.parse({
          model: parsed.model ?? this.model,
          decisions: questionKeys.map((key) => mapGatewayDecision(key, questions[key]!, parsed.answers[key]!, parsed.providerMetadata?.typesafe?.confidence?.[key])),
          usage: parsed.usage,
          metadata: { transport: this.transport, httpStatus: response.status },
          latencyMs: performance.now() - startedAt,
        });
      }
      const parsed = TypesafeResponseSchema.parse(body);
      if (JSON.stringify(Object.keys(parsed.answers).sort()) !== JSON.stringify(questionKeys)) throw new Error("provider_response_question_set_mismatch");
      return DecisionResponseSchema.parse({
        model: parsed.model,
        decisions: questionKeys.map((key) => mapTypesafeDecision(key, questions[key]!, parsed.answers[key]!)),
        usage: { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens },
        metadata: { transport: this.transport, httpStatus: response.status },
        latencyMs: performance.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith("provider_response_")
        ? error.message
        : "provider_response_schema_mismatch";
      throw Object.assign(new Error(message), { retryable: false, cause: error });
    }
  }
}