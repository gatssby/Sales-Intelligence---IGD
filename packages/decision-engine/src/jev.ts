import { z } from "zod";
import { DecisionResponseSchema, type Decision, type DecisionProvider, type DecisionRequest, type ProviderHealth } from "./types.js";

type FetchLike = typeof fetch;

const JevAnswersSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), z.object({
    choice: z.union([z.string(), z.number(), z.boolean()]).optional(),
    score: z.number().min(0).max(1).optional(),
    noul: z.number().min(0).max(1).optional(),
    probabilities: z.union([z.record(z.string(), z.number().min(0).max(1)), z.array(z.number().min(0).max(1))]).default({}),
    confidence: z.number().min(0).max(1).optional(),
  })),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.number().nonnegative().nullable().optional(),
  }).default({}),
});

export class JevDecisionEngine implements DecisionProvider {
  readonly provider = "jev";
  readonly model: string;
  readonly modelVersion: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options: { apiKey?: string; baseUrl?: string; model?: string; modelVersion?: string; fetch?: FetchLike } = {}) {
    this.apiKey = options.apiKey ?? process.env.JEV_API_KEY;
    this.baseUrl = (options.baseUrl ?? process.env.JEV_BASE_URL ?? "https://thejevai.com").replace(/\/$/, "");
    this.model = options.model ?? process.env.JEV_MODEL ?? "jev-latest";
    this.modelVersion = options.modelVersion ?? process.env.JEV_MODEL_VERSION ?? "unknown";
    this.fetcher = options.fetch ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    return this.apiKey ? { available: true } : { available: false, reason: "missing_api_key" };
  }

  async decide(request: DecisionRequest) {
    if (!this.apiKey) throw new Error("missing_api_key");
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, state: request.input, questions: request.questions ?? {} }),
      });
    } catch (error) {
      throw Object.assign(new Error("provider_network_error"), { retryable: true, cause: error });
    }
    if (!response.ok) {
      const error = new Error(`provider_http_${response.status}`);
      throw Object.assign(error, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
    }
    const body: unknown = await response.json();
    const direct = DecisionResponseSchema.safeParse(body);
    const parsed = direct.success ? direct.data : (() => {
      const answers = JevAnswersSchema.parse(body);
      const decisions: Decision[] = Object.entries(answers.answers).map(([key, answer]) => ({
        key,
        value: answer.choice ?? answer.score ?? answer.noul ?? false,
        score: answer.score ?? answer.noul ?? null,
        confidence: answer.confidence ?? (answer.noul === undefined ? 0 : Math.max(answer.noul, 1 - answer.noul)),
        probabilities: Array.isArray(answer.probabilities)
          ? Object.fromEntries(answer.probabilities.map((value, index) => [String(index), value]))
          : answer.probabilities,
        evidence: [],
        metadata: {},
      }));
      return { model: answers.model, decisions, usage: answers.usage, metadata: {} };
    })();
    return { ...parsed, latencyMs: performance.now() - startedAt };
  }
}
