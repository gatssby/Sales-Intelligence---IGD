import { chmod, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { loadInsiderDataset } from "./lib/insider-dataset.js";

const inputFile = process.env.MANUAL_INGESTION_FILE;
const registryUrl = process.env.SELLER_REGISTRY_CSV_URL;
const outputFile = process.env.SELLER_REGISTRY_FILE;
if (!inputFile || !registryUrl || !outputFile) {
  throw new Error("MANUAL_INGESTION_FILE, SELLER_REGISTRY_CSV_URL and SELLER_REGISTRY_FILE are required");
}

const response = await fetch(registryUrl);
if (!response.ok) throw new Error(`seller_registry_fetch_failed:${response.status}`);
const rows = parse(await response.text(), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
const activeOfficial = new Map(rows
  .filter((row) =>
    row["Produto"]?.trim().toUpperCase() === "INSIDER"
    && row["Frente"]?.trim().toUpperCase() === "CLOSERS"
    && row["Cargo"]?.trim().toUpperCase() === "CLOSER"
    && row["Ativo"]?.trim().toUpperCase() === "TRUE"
    && /^V\d+$/.test(row["Código do integrante"]?.trim() ?? ""))
  .map((row) => [row["Código do integrante"].trim(), row]));

const dataset = await loadInsiderDataset(inputFile);
const historicalNames = new Map<string, string>();
for (const item of dataset.valid) {
  const current = historicalNames.get(item.raw.seller_code);
  if (current && current !== item.raw.seller_name.trim()) throw new Error(`seller_name_conflict:${item.raw.seller_code}`);
  historicalNames.set(item.raw.seller_code, item.raw.seller_name.trim());
}

const allCodes = new Set([...activeOfficial.keys(), ...historicalNames.keys()]);
const sellers = [...allCodes].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((sellerCode) => {
  const official = activeOfficial.get(sellerCode);
  if (official) return {
    seller_code: sellerCode,
    seller_name: official["Nome do integrante"].trim(),
    product: official["Produto"].trim(),
    team_name: official["Nome do time"].trim() || undefined,
    role: official["Cargo"].trim() || undefined,
    seniority: official["Senioridade"].trim() || undefined,
    leader_code: official["Código do líder"].trim() || undefined,
    leader_name: official["Nome do líder"].trim() || undefined,
    active: true,
  };
  return {
    seller_code: sellerCode,
    seller_name: historicalNames.get(sellerCode),
    product: "INSIDER",
    active: false,
  };
});

await writeFile(outputFile, `${JSON.stringify(sellers, null, 2)}\n`, { mode: 0o600 });
await chmod(outputFile, 0o600);
console.log(JSON.stringify({
  outputFile,
  sellers: sellers.length,
  activeOfficial: sellers.filter((seller) => seller.active).length,
  historicalInactive: sellers.filter((seller) => !seller.active).length,
  datasetSellerCodes: historicalNames.size,
}));
