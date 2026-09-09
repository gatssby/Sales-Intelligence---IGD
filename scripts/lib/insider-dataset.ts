import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { extractGoogleFileId, parseHistoricalCallDate } from "@igd/core";

const RawRecordSchema = z.object({
  transcript_file_id: z.string(),
  transcript_url: z.string(),
  seller_code: z.string().regex(/^V\d+$/),
  seller_name: z.string().min(1),
  date: z.string(),
  customer_name: z.string(),
  customer_email: z.string(),
  status: z.string(),
  origin: z.string(),
  recording_url: z.string(),
  source_type: z.literal("manual_crm_import"),
  source_workbook: z.string().min(1),
  source_sheet: z.string().min(1),
  source_row: z.number().int().positive(),
  source_count: z.number().int().positive(),
  sources: z.string().min(1),
});

export type RawInsiderRecord = z.infer<typeof RawRecordSchema>;

export type ParsedCrmSource = {
  workbook: string;
  sheet: string;
  row: number;
  sellerCode: string | null;
  externalId: string;
};

export type ValidInsiderRecord = {
  line: number;
  raw: RawInsiderRecord;
  transcriptFileId: string;
  parsedDate: ReturnType<typeof parseHistoricalCallDate>;
  sources: ParsedCrmSource[];
  sellerAssociationNeedsReview: boolean;
  dateNeedsReview: boolean;
};

export type DatasetIssue = { line: number; code: string };

export function parseCrmSources(value: string, sourceType = "manual_crm_import"): ParsedCrmSource[] {
  return value.split(" | ").map((entry) => {
    const parts = entry.split(" :: ");
    if (parts.length !== 3) throw new Error("invalid_source_entry");
    const rowMatch = parts[2].match(/(\d+)$/);
    if (!rowMatch) throw new Error("invalid_source_row");
    const workbook = parts[0].trim();
    const sheet = parts[1].trim();
    const sellerMatch = sheet.match(/-\s*(V\d+)$/i);
    const row = Number(rowMatch[1]);
    const digest = createHash("sha256").update(`${sourceType}\0${workbook}\0${sheet}\0${row}`).digest("hex");
    return { workbook, sheet, row, sellerCode: sellerMatch?.[1].toUpperCase() ?? null, externalId: `crm:${digest}` };
  });
}

export async function loadInsiderDataset(file: string): Promise<{
  totalLines: number;
  valid: ValidInsiderRecord[];
  issues: DatasetIssue[];
}> {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const valid: ValidInsiderRecord[] = [];
  const issues: DatasetIssue[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    let raw: RawInsiderRecord;
    try {
      raw = RawRecordSchema.parse(JSON.parse(lines[index]));
    } catch {
      issues.push({ line, code: "invalid_json_or_shape" });
      continue;
    }
    const explicitId = extractGoogleFileId(raw.transcript_file_id);
    const urlContainsExplicitId = raw.transcript_url.includes(`/d/${explicitId}`);
    if (!explicitId || explicitId !== raw.transcript_file_id || !urlContainsExplicitId) {
      issues.push({ line, code: "invalid_or_mismatched_transcript_identity" });
      continue;
    }
    if (seen.has(explicitId)) {
      issues.push({ line, code: "duplicate_transcript_file_id" });
      continue;
    }
    seen.add(explicitId);
    let sources: ParsedCrmSource[];
    try {
      sources = parseCrmSources(raw.sources, raw.source_type);
    } catch {
      issues.push({ line, code: "invalid_sources" });
      continue;
    }
    if (sources.length !== raw.source_count) {
      issues.push({ line, code: "source_count_mismatch" });
      continue;
    }
    const sourceSellers = new Set(sources.map((source) => source.sellerCode).filter(Boolean));
    valid.push({
      line,
      raw,
      transcriptFileId: explicitId,
      parsedDate: parseHistoricalCallDate(raw.date),
      sources,
      sellerAssociationNeedsReview: sourceSellers.size !== 1 || !sourceSellers.has(raw.seller_code),
      dateNeedsReview: Boolean(raw.date.trim()) && !parseHistoricalCallDate(raw.date),
    });
  }
  return { totalLines: lines.length, valid, issues };
}
