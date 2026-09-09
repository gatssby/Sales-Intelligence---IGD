import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { generateText, Output } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { AnalysisOutputSchema, type AnalysisOutput } from "./schema";
import { ModelGatewayError, type ModelGateway, type ModelExecution } from "./analysis-engine";

export type AnalysisInput = {
  transcript: string;
  rubric: string;
  promptVersion: string;
};

export interface CallAnalyzer {
  analyze(input: AnalysisInput): Promise<AnalysisOutput>;
}

export type AnalysisExecution = {
  output: AnalysisOutput;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  latencyMs: number;
};

export class OpenAIResponsesAnalyzer implements CallAnalyzer {
  constructor(
    private readonly client = new OpenAI(),
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-6-astra",
    private readonly maxOutputTokens = Number(process.env.AI_ANALYSIS_MAX_OUTPUT_TOKENS ?? "5000"),
  ) {}

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    return (await this.analyzeWithMetrics(input)).output;
  }

  async analyzeWithMetrics(input: AnalysisInput): Promise<AnalysisExecution> {
    const started = performance.now();
    const { data: response } = await this.client.responses.parse({
      model: this.model,
      store: false,
      max_output_tokens: this.maxOutputTokens,
      input: [
        {
          role: "system",
          content: `Você audita calls de vendas com rigor. Separe qualidade da oportunidade de qualidade da condução. Use somente evidências presentes na transcrição. Rubrica: ${input.rubric}`,
        },
        {
          role: "user",
          content: `Versão do prompt: ${input.promptVersion}\n\nTRANSCRIÇÃO:\n${input.transcript}`,
        },
      ],
      text: { format: zodTextFormat(AnalysisOutputSchema, "sales_call_analysis") },
    }).withResponse();

    if (!response.output_parsed) throw new Error("The model did not return a parsed analysis.");
    return {
      output: response.output_parsed,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export function createVercelAiGatewayAnalyzer(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} = {}): OpenAIResponsesAnalyzer {
  const apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required to run analysis");

  const client = new OpenAI({
    apiKey,
    baseURL: options.baseUrl ?? process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  });
  const model = options.model ?? process.env.AI_GATEWAY_MODEL ?? "openai/gpt-5.4";
  return new OpenAIResponsesAnalyzer(client, model);
}

export type GatewayModelPricing = {
  input: number;
  output: number;
  inputCacheRead: number | null;
};

export function parseGatewayModelPricing(pricing: Record<string, string> | undefined): GatewayModelPricing | null {
  if (!pricing?.input || !pricing.output) return null;
  const input = Number(pricing.input);
  const output = Number(pricing.output);
  const inputCacheRead = pricing.input_cache_read ? Number(pricing.input_cache_read) : null;
  if (!Number.isFinite(input) || !Number.isFinite(output) || (inputCacheRead !== null && !Number.isFinite(inputCacheRead))) {
    return null;
  }
  return { input, output, inputCacheRead };
}

export function calculateModelCost(
  usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null },
  pricing: GatewayModelPricing | null,
): number | null {
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  return uncached * pricing.input + cached * (pricing.inputCacheRead ?? pricing.input) + usage.outputTokens * pricing.output;
}

export async function getVercelAiGatewayModelPricing(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} = {}): Promise<GatewayModelPricing | null> {
  const apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required");
  const model = options.model ?? process.env.AI_GATEWAY_MODEL ?? "openai/gpt-5.4";
  const baseUrl = options.baseUrl ?? process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`ai_gateway_models_failed:${response.status}`);
  const payload = await response.json() as { data?: Array<{ id?: string; pricing?: Record<string, string> }> };
  const selected = payload.data?.find((candidate) => candidate.id === model);
  return parseGatewayModelPricing(selected?.pricing);
}

function mapGatewayError(error: unknown, latencyMs: number): ModelGatewayError {
  if (error instanceof Error && /timeout/i.test(`${error.name}:${error.message}`)) {
    return new ModelGatewayError("model_timeout", { retryable: true, latencyMs });
  }
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : null;
  if (status === 401) return new ModelGatewayError("authentication_failed", { retryable: false, latencyMs });
  if (status === 403) return new ModelGatewayError("access_denied", { retryable: false, latencyMs });
  if (status === 408) return new ModelGatewayError("model_timeout", { retryable: true, latencyMs });
  if (status === 429) return new ModelGatewayError("rate_limited", { retryable: true, latencyMs });
  if (status !== null && status >= 500) return new ModelGatewayError("provider_unavailable", { retryable: true, latencyMs });
  return new ModelGatewayError("model_execution_failed", { retryable: false, latencyMs });
}

export function createVercelAiGatewayModelGateway(options: {
  apiKey?: string;
  baseUrl?: string;
} = {}): ModelGateway {
  const apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required to run analysis");
  const baseUrl = options.baseUrl ?? process.env.AI_GATEWAY_PROVIDER_BASE_URL;
  const timeout = Number(process.env.AI_GATEWAY_TIMEOUT_MS ?? "300000");
  if (!Number.isFinite(timeout) || timeout < 1_000) throw new Error("AI_GATEWAY_TIMEOUT_MS must be at least 1000");
  const gateway = createGateway({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    headers: { "http-referer": "https://sales-igd.com.br", "x-title": "IGD Sales Intelligence" },
  });
  const pricingByModel = new Map<string, GatewayModelPricing | null>();

  return {
    async analyze(request): Promise<ModelExecution> {
      const started = performance.now();
      const requestedAt = new Date().toISOString();
      const captured: {
        usage?: { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } };
        gatewayMetadata?: Record<string, unknown>;
      } = {};
      try {
        const maxOutputTokens = Number(process.env.AI_ANALYSIS_MAX_OUTPUT_TOKENS ?? "5000");
        const result = await generateText({
          model: gateway(request.model),
          system: `Você audita calls de vendas com rigor. Separe qualidade da oportunidade de qualidade da condução. Use somente evidências presentes na transcrição. Rubrica: ${request.rubric}`,
          prompt: `Versão do prompt: ${request.promptVersion}\n\nTRANSCRIÇÃO:\n${request.transcript}`,
          output: Output.object({ schema: AnalysisOutputSchema, name: "sales_call_analysis" }),
          maxOutputTokens,
          maxRetries: 0,
          timeout,
          providerOptions: {
            gateway: {
              tags: ["sales-intelligence", request.purpose, request.role, `model:${request.model}`],
            },
          },
          onStepFinish(step) {
            captured.usage = step.usage;
            captured.gatewayMetadata = step.providerMetadata?.gateway as Record<string, unknown> | undefined;
          },
        });
        const gatewayMetadata = result.finalStep.providerMetadata?.gateway as Record<string, unknown> | undefined;
        const actualValue = gatewayMetadata?.cost;
        const gatewayActualCostUsd = typeof actualValue === "number"
          ? actualValue
          : typeof actualValue === "string" && Number.isFinite(Number(actualValue)) ? Number(actualValue) : null;
        const routedValue = gatewayMetadata?.provider;
        const provider = typeof routedValue === "string" ? routedValue : request.model.split("/")[0] ?? "unknown";
        const execution = {
          output: result.output,
          provider,
          inputTokens: result.totalUsage.inputTokens ?? null,
          outputTokens: result.totalUsage.outputTokens ?? null,
          cachedInputTokens: result.totalUsage.inputTokenDetails.cacheReadTokens ?? null,
          latencyMs: Math.round(performance.now() - started),
          requestedAt,
        };
        let pricing = pricingByModel.get(request.model);
        if (pricing === undefined) {
          try {
            pricing = await getVercelAiGatewayModelPricing({ apiKey, model: request.model });
          } catch {
            pricing = null;
          }
          pricingByModel.set(request.model, pricing);
        }
        const estimatedCostUsd = calculateModelCost(execution, pricing);
        return {
          ...execution,
          gatewayActualCostUsd,
          estimatedCostUsd,
          costUsd: gatewayActualCostUsd ?? estimatedCostUsd,
          costSource: gatewayActualCostUsd !== null ? "gateway_actual" : estimatedCostUsd !== null ? "estimated" : "unavailable",
        };
      } catch (error) {
        if (error instanceof ModelGatewayError) throw error;
        let pricing = pricingByModel.get(request.model);
        if (pricing === undefined) {
          try { pricing = await getVercelAiGatewayModelPricing({ apiKey, model: request.model }); }
          catch { pricing = null; }
          pricingByModel.set(request.model, pricing);
        }
        const actualValue = captured.gatewayMetadata?.cost;
        const gatewayActualCostUsd = typeof actualValue === "number"
          ? actualValue
          : typeof actualValue === "string" && Number.isFinite(Number(actualValue)) ? Number(actualValue) : null;
        const inputTokens = captured.usage?.inputTokens ?? null;
        const outputTokens = captured.usage?.outputTokens ?? null;
        const cachedInputTokens = captured.usage?.inputTokenDetails?.cacheReadTokens ?? null;
        const estimatedCostUsd = calculateModelCost({ inputTokens, outputTokens, cachedInputTokens }, pricing);
        const routed = captured.gatewayMetadata?.provider;
        const receipt = {
          provider: typeof routed === "string" ? routed : request.model.split("/")[0] ?? "unknown",
          inputTokens,
          outputTokens,
          cachedInputTokens,
          costUsd: gatewayActualCostUsd ?? estimatedCostUsd,
          gatewayActualCostUsd,
          estimatedCostUsd,
          costSource: gatewayActualCostUsd !== null ? "gateway_actual" as const : estimatedCostUsd !== null ? "estimated" as const : "unavailable" as const,
          requestedAt,
        };
        const mapped = mapGatewayError(error, Math.round(performance.now() - started));
        throw new ModelGatewayError(mapped.message, { retryable: mapped.retryable, latencyMs: mapped.latencyMs, receipt });
      }
    },
  };
}
