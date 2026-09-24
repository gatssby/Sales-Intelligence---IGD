import { z } from "zod";
import { DecisionResponseSchema, type Decision, type DecisionProvider, type DecisionRequest, type ProviderHealth } from "./types.js";

type FetchLike = typeof fetch;

const LayaAnswersSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), z.object({
    choice: z.union([z.string(), z.number(), z.boolean()]).optional(),
    score: z.number().min(0).max(1).optional(),
    noul: z.number().min(0).max(1).optional(),
    probabilities: z.union([z.record(z.string(), z.number().min(0).max(1)), z.array(z.number().min(0).max(1))]).default({}),
    confidence: z.number().min(0).max(1).optional(),
  })),
});

export class LayaDecisionEngine implements DecisionProvider {
  readonly provider = "laya";
  readonly model: string;
  readonly modelVersion: string;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options: { baseUrl?: string; model?: string; modelVersion?: string; fetch?: FetchLike } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.LAYA_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    this.model = options.model ?? process.env.LAYA_MODEL ?? "sales-decision";
    this.modelVersion = options.modelVersion ?? process.env.LAYA_MODEL_VERSION ?? "local";
    this.fetcher = options.fetch ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/health`);
      if (!response.ok) return { available: false, reason: `health_http_${response.status}` };
      const body = await response.json() as { device?: string };
      return { available: true, ...(body.device ? { device: body.device } : {}) };
    } catch {
      return { available: false, reason: "connection_failed" };
    }
  }

  async decide(request: DecisionRequest) {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: request.input, questions: request.questions ?? {} }),
      });
    } catch (error) {
      throw Object.assign(new Error("local_service_unavailable"), { retryable: true, cause: error });
    }
    if (!response.ok) {
      const error = new Error(`provider_http_${response.status}`);
      throw Object.assign(error, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
    }
    const body: unknown = await response.json();
    const direct = DecisionResponseSchema.safeParse(body);
    const parsed = direct.success ? direct.data : (() => {
      const answers = LayaAnswersSchema.parse(body);
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
      return { model: answers.model, decisions, usage: {}, metadata: {} };
    })();
    return { ...parsed, latencyMs: performance.now() - startedAt };
  }
}
