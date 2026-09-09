import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AnalysisOutputSchema, type AnalysisOutput } from "./schema";

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
  latencyMs: number;
};

export class OpenAIResponsesAnalyzer implements CallAnalyzer {
  constructor(
    private readonly client = new OpenAI(),
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-6-astra",
  ) {}

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    return (await this.analyzeWithMetrics(input)).output;
  }

  async analyzeWithMetrics(input: AnalysisInput): Promise<AnalysisExecution> {
    const started = performance.now();
    const { data: response } = await this.client.responses.parse({
      model: this.model,
      store: false,
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
  if (!selected?.pricing?.input || !selected.pricing.output) return null;
  const input = Number(selected.pricing.input);
  const output = Number(selected.pricing.output);
  const inputCacheRead = selected.pricing.input_cache_read ? Number(selected.pricing.input_cache_read) : null;
  if (!Number.isFinite(input) || !Number.isFinite(output) || (inputCacheRead !== null && !Number.isFinite(inputCacheRead))) {
    return null;
  }
  return {
    input,
    output,
    inputCacheRead,
  };
}
