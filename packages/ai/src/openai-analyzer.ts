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

export class OpenAIResponsesAnalyzer implements CallAnalyzer {
  constructor(
    private readonly client = new OpenAI(),
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-6-astra",
  ) {}

  async analyze(input: AnalysisInput): Promise<AnalysisOutput> {
    const response = await this.client.responses.parse({
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
    });

    if (!response.output_parsed) throw new Error("The model did not return a parsed analysis.");
    return response.output_parsed;
  }
}
