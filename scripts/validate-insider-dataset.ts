import { loadInsiderDataset } from "./lib/insider-dataset.js";

const inputFile = process.env.MANUAL_INGESTION_FILE;
if (!inputFile) throw new Error("MANUAL_INGESTION_FILE is required");
const dataset = await loadInsiderDataset(inputFile);
const fields = ["date", "customer_name", "customer_email", "status", "origin", "recording_url"] as const;
const coverage = Object.fromEntries(fields.map((field) => {
  const count = dataset.valid.filter((item) => item.raw[field].trim()).length;
  return [field, { count, percent: Number((count * 100 / dataset.valid.length).toFixed(2)) }];
}));
const sellers = new Map<string, number>();
const sellerNames = new Map<string, Set<string>>();
for (const item of dataset.valid) sellers.set(item.raw.seller_code, (sellers.get(item.raw.seller_code) ?? 0) + 1);
for (const item of dataset.valid) {
  const names = sellerNames.get(item.raw.seller_code) ?? new Set<string>();
  names.add(item.raw.seller_name.trim());
  sellerNames.set(item.raw.seller_code, names);
}
const dates = dataset.valid.flatMap((item) => item.parsedDate?.date ? [item.parsedDate.date] : []);
const issueCounts = new Map<string, number>();
for (const issue of dataset.issues) issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);

console.log(JSON.stringify({
  objects: dataset.totalLines,
  validCanonicalCalls: dataset.valid.length,
  quarantined: dataset.issues.length,
  issues: Object.fromEntries(issueCounts),
  coverage,
  sellerCount: sellers.size,
  sellerDistribution: [...sellers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([sellerCode, calls]) => ({ sellerCode, calls, nameVariants: sellerNames.get(sellerCode)?.size ?? 0 })),
  dateRange: dates.length ? { min: dates.sort()[0], max: dates.at(-1) } : null,
  sellerAssociationNeedsReview: dataset.valid.filter((item) => item.sellerAssociationNeedsReview).length,
  dateNeedsReview: dataset.valid.filter((item) => item.dateNeedsReview).length,
  invalidNonEmptyEmails: dataset.valid.filter((item) => item.raw.customer_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.raw.customer_email.trim())).length,
  urlsWithMultipleGoogleTargets: dataset.valid.filter((item) => (item.raw.transcript_url.match(/https:\/\//g) ?? []).length > 1).length,
  workbookCountWithCalls: new Set(dataset.valid.map((item) => item.raw.source_workbook)).size,
  workbookSheetPairsWithCalls: new Set(dataset.valid.map((item) => `${item.raw.source_workbook}\0${item.raw.source_sheet}`)).size,
  sourceOccurrences: dataset.valid.reduce((sum, item) => sum + item.sources.length, 0),
  duplicateSourceOccurrences: dataset.valid.reduce((sum, item) => sum + item.sources.length - 1, 0),
}, null, 2));
