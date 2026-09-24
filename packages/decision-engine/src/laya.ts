import { z } from "zod";
import { type Decision, type DecisionProvider, type DecisionRequest, type ProviderHealth } from "./types.js";

type FetchLike = typeof fetch;

const LayaTypedAnswerSchema = z.object({
  type: z.enum(["choice", "noul", "score"]),
  choice: z.union([z.string(), z.number(), z.boolean()]).optional(),
  score: z.number().nonnegative().optional(),
  noul: z.number().min(0).max(1).optional(),
  probabilities: z.union([z.record(z.string(), z.number().min(0).max(1).finite()), z.array(z.number().min(0).max(1).finite())]).default({}),
  legend: z.record(z.string(), z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).superRefine((answer, context) => {
  const invalid = (message: string) => context.addIssue({ code: "custom", message });
  if (answer.type === "choice" && (answer.choice === undefined || answer.score !== undefined || answer.noul !== undefined)) {
    invalid("choice_answer_requires_only_choice");
  }
  if (answer.type === "noul" && (answer.noul === undefined || answer.choice !== undefined || answer.score !== undefined)) {
    invalid("noul_answer_requires_only_noul");
  }
  if (answer.type === "score" && (answer.score === undefined || answer.choice !== undefined || answer.noul !== undefined || !Array.isArray(answer.probabilities) || answer.probabilities.length < 2 || answer.legend === undefined)) {
    invalid("score_answer_requires_levels");
  }
});

const LayaAnswersSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), LayaTypedAnswerSchema).refine((answers) => Object.keys(answers).length > 0, "typed_answers_required"),
});
const LayaQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    instructions: z.string().min(1),
    criteria: z.record(z.string().min(1), z.string().min(1)).refine((criteria) => Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 26, "choice_criteria_count_invalid"),
  }).strict(),
  z.object({
    type: z.literal("noul"),
    instructions: z.string().min(1),
    criteria: z.object({ false: z.string().min(1), true: z.string().min(1) }).strict().optional(),
  }).strict(),
  z.object({
    type: z.literal("score"),
    instructions: z.string().min(1),
    minimum: z.number().int(),
    maximum: z.number().int(),
  }).strict().refine((question) => question.maximum > question.minimum && question.maximum - question.minimum < 10, "score_range_invalid"),
]);
const LayaQuestionsSchema = z.record(z.string().min(1), LayaQuestionSchema).refine(
  (questions) => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 16,
  "laya_questions_count_invalid",
);

function requireExactKeys(actual: Record<string, unknown>, expected: string[], error: string): void {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...expected].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error(error);
}

function requireProbabilityDistribution(probabilities: number[], error: string): void {
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 1) > 0.02) throw new Error(error);
}

type SafeValidationDetail = {
  path: Array<string | number>;
  type: string;
  message: string;
  context?: Record<string, number | boolean>;
};

function sanitizeValidationContext(value: unknown): Record<string, number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const allowedKeys = new Set(["max_length", "min_length", "ge", "gt", "le", "lt"]);
  const entries = Object.entries(value).filter((entry): entry is [string, number | boolean] => {
    const [key, item] = entry;
    return allowedKeys.has(key) && (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)));
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function safeValidationType(type: string): string {
  return new Set([
    "string_too_long",
    "string_too_short",
    "missing",
    "extra_forbidden",
    "string_type",
    "dict_type",
    "literal_error",
  ]).has(type) ? type : "validation_error";
}

function safeValidationMessage(type: string, context: Record<string, number | boolean> | undefined): string {
  if (type === "string_too_long" && typeof context?.max_length === "number") return `String should have at most ${context.max_length} characters`;
  if (type === "string_too_short" && typeof context?.min_length === "number") return `String should have at least ${context.min_length} characters`;
  if (type === "missing") return "Field required";
  if (type === "extra_forbidden") return "Extra input is not permitted";
  if (type === "string_type") return "Input should be a valid string";
  if (type === "dict_type") return "Input should be a valid object";
  if (type === "literal_error") return "Input does not match an allowed literal";
  return "Request validation failed";
}

function sanitizeLayaValidation(body: unknown): SafeValidationDetail[] | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (Array.isArray(detail)) {
    const safe = detail.slice(0, 16).flatMap((item): SafeValidationDetail[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const candidate = item as { loc?: unknown; msg?: unknown; type?: unknown; ctx?: unknown };
      if (!Array.isArray(candidate.loc) || typeof candidate.msg !== "string" || typeof candidate.type !== "string") return [];
      const path = candidate.loc.flatMap((part): Array<string | number> => {
        if (typeof part === "number" && Number.isFinite(part)) return [part];
        if (typeof part === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(part)) return [part];
        return ["[redacted]"];
      });
      const type = safeValidationType(candidate.type);
      const context = type === "validation_error" ? undefined : sanitizeValidationContext(candidate.ctx);
      return [{ path, type, message: safeValidationMessage(type, context), ...(context ? { context } : {}) }];
    });
    return safe.length ? safe : undefined;
  }
  if (typeof detail !== "string") return undefined;
  const overflow = /^Laya context overflow: (\d+) formatted tokens exceeds (\d+); input was not truncated$/.exec(detail);
  if (overflow) {
    const formattedTokens = Number(overflow[1]);
    const maxFormattedTokens = Number(overflow[2]);
    return [{
      path: ["body", "state"],
      type: "laya_context_overflow",
      message: detail,
      context: { formattedTokens, maxFormattedTokens },
    }];
  }
  if (detail === "Laya would shorten instructions/options or replace a literal mask token; input was not truncated or altered") {
    return [{ path: ["body", "state"], type: "laya_input_would_be_altered", message: detail }];
  }
  return undefined;
}

function requireChoiceAnswer(answer: z.infer<typeof LayaTypedAnswerSchema>, question: Extract<z.infer<typeof LayaQuestionSchema>, { type: "choice" }>): void {
  if (answer.type !== "choice" || typeof answer.choice !== "string" || Array.isArray(answer.probabilities)) throw new Error("provider_response_choice_schema_invalid");
  requireExactKeys(answer.probabilities, Object.keys(question.criteria), "provider_response_choice_out_of_schema");
  if (!Object.hasOwn(question.criteria, answer.choice)) throw new Error("provider_response_choice_out_of_schema");
  requireProbabilityDistribution(Object.values(answer.probabilities), "provider_response_probability_distribution_invalid");
}

function requireScoreAnswer(answer: z.infer<typeof LayaTypedAnswerSchema>, question: Extract<z.infer<typeof LayaQuestionSchema>, { type: "score" }>): void {
  if (answer.type !== "score" || !Array.isArray(answer.probabilities) || !answer.legend) throw new Error("provider_response_score_schema_invalid");
  const levels = Array.from({ length: question.maximum - question.minimum + 1 }, (_, index) => String(question.minimum + index));
  if (answer.probabilities.length !== levels.length || answer.score === undefined || answer.score > levels.length - 1) throw new Error("provider_response_score_out_of_schema");
  requireProbabilityDistribution(answer.probabilities, "provider_response_probability_distribution_invalid");
  requireExactKeys(answer.legend, levels.map((_, index) => String(index)), "provider_response_score_legend_invalid");
  if (levels.some((level, index) => answer.legend?.[String(index)] !== level)) throw new Error("provider_response_score_legend_invalid");
}

function serializeLayaQuestions(questions: z.infer<typeof LayaQuestionsSchema>) {
  return Object.fromEntries(Object.entries(questions).map(([key, question]) => {
    if (question.type !== "score") return [key, question];
    return [key, {
      type: question.type,
      instructions: question.instructions,
      levels: Array.from({ length: question.maximum - question.minimum + 1 }, (_, index) => String(question.minimum + index)),
    }];
  }));
}

function mapTypedAnswer(
  key: string,
  answer: z.infer<typeof LayaAnswersSchema>["answers"][string],
  question?: z.infer<typeof LayaQuestionSchema>,
): Decision {
  const scoreAnswer = answer.type === "score";
  const noulAnswer = answer.type === "noul";
  if (!question) throw new Error("provider_response_answer_key_unexpected");
  if (question.type === "choice") requireChoiceAnswer(answer, question);
  if (question.type === "score") requireScoreAnswer(answer, question);
  if (question.type === "noul" && answer.type !== "noul") throw new Error("provider_response_type_mismatch");
  const levels = Array.isArray(answer.probabilities) ? answer.probabilities.length : 0;
  const normalizedScore = scoreAnswer
    ? answer.score === undefined || levels < 2 ? null : answer.score / (levels - 1)
    : answer.score ?? answer.noul ?? null;
  if (scoreAnswer && normalizedScore === null) throw new Error("provider_response_invalid_score");
  if (normalizedScore !== null && (normalizedScore < 0 || normalizedScore > 1)) throw new Error("provider_response_invalid_score");
  const requestedMinimum = scoreAnswer && question?.type === "score" ? question.minimum : undefined;
  const requestedMaximum = scoreAnswer && question?.type === "score" ? question.maximum : undefined;
  const hasRequestedScale = requestedMinimum !== undefined && requestedMaximum !== undefined;
  if (hasRequestedScale && requestedMaximum - requestedMinimum + 1 !== levels) throw new Error("provider_response_score_scale_mismatch");
  const value = scoreAnswer
    ? answer.score! + (hasRequestedScale ? requestedMinimum : 0)
    : noulAnswer
      ? answer.noul! >= 0.5
      : answer.choice ?? false;
  const probabilities = noulAnswer
    ? { false: 1 - answer.noul!, true: answer.noul! }
    : Array.isArray(answer.probabilities)
      ? Object.fromEntries(answer.probabilities.map((probability, index) => [answer.legend?.[String(index)] ?? String(index + (hasRequestedScale ? requestedMinimum : 0)), probability]))
      : answer.probabilities;
  return {
    key,
    value,
    score: normalizedScore,
    confidence: answer.confidence ?? (answer.noul === undefined ? 0 : Math.max(answer.noul, 1 - answer.noul)),
    probabilities,
    evidence: [],
    metadata: scoreAnswer ? {
      scoreScale: hasRequestedScale
        ? { minimum: requestedMinimum, maximum: requestedMaximum }
        : { minimum: 0, maximum: levels - 1 },
      providerScore: answer.score,
      providerLegend: answer.legend,
    } : {},
  };
}

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
    const questions = LayaQuestionsSchema.parse(request.questions ?? {});
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: request.input, questions: serializeLayaQuestions(questions) }),
      });
    } catch (error) {
      throw Object.assign(new Error("local_service_unavailable"), { retryable: true, cause: error });
    }
    if (!response.ok) {
      const error = new Error(`provider_http_${response.status}`);
      let validation: SafeValidationDetail[] | undefined;
      if (response.status === 422) {
        try {
          validation = sanitizeLayaValidation(await response.json());
        } catch {
          validation = undefined;
        }
      }
      throw Object.assign(error, {
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        status: response.status,
        ...(validation ? { validation } : {}),
      });
    }
    let parsed: {
      model?: string;
      decisions: Decision[];
      usage: { inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null };
      metadata: Record<string, unknown>;
    };
    try {
      const body: unknown = await response.json();
      const answers = LayaAnswersSchema.parse(body);
      requireExactKeys(answers.answers, Object.keys(questions), "provider_response_answer_keys_mismatch");
      const decisions: Decision[] = Object.entries(answers.answers).map(([key, answer]) => mapTypedAnswer(key, answer, questions[key]));
      parsed = { model: answers.model, decisions, usage: {}, metadata: {} };
    } catch (error) {
      throw Object.assign(new Error("provider_response_schema_mismatch"), { retryable: false, cause: error });
    }
    return { ...parsed, latencyMs: performance.now() - startedAt };
  }
}
