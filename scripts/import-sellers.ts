import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
const inputFile = process.env.SELLER_REGISTRY_FILE;
if (!databaseUrl || !inputFile) throw new Error("DATABASE_URL and SELLER_REGISTRY_FILE are required");

const apply = process.argv.includes("--apply");
const SellerSchema = z.object({
  seller_code: z.string().regex(/^V\d+$/),
  seller_name: z.string().min(1),
  product: z.string().min(1).default("INSIDER"),
  team_name: z.string().optional(),
  role: z.string().optional(),
  seniority: z.string().optional(),
  leader_code: z.string().regex(/^V\d+$/).optional(),
  leader_name: z.string().optional(),
  active: z.boolean().default(true),
});

const sellers = z.array(SellerSchema).min(1).max(500).parse(JSON.parse(await readFile(inputFile, "utf8")));
if (new Set(sellers.map((seller) => seller.seller_code)).size !== sellers.length) {
  throw new Error("duplicate_seller_code_in_batch");
}

const repository = new PostgresIngestionRepository(databaseUrl);
try {
  if (!apply) {
    const codes = sellers.map((seller) => seller.seller_code);
    const existing = await repository.sql<{ count: number }[]>`
      select count(*)::integer as count from sellers where seller_code = any(${codes})
    `;
    console.log(JSON.stringify({
      mode: "dry_run",
      sellers: sellers.length,
      existing: existing[0].count,
      toCreate: sellers.length - existing[0].count,
    }));
  } else {
    let created = 0;
    let updated = 0;
    for (const seller of sellers) {
      const result = await repository.upsertSeller({
        sellerCode: seller.seller_code,
        sellerName: seller.seller_name,
        product: seller.product,
        teamName: seller.team_name,
        role: seller.role,
        seniority: seller.seniority,
        leaderCode: seller.leader_code,
        leaderName: seller.leader_name,
        active: seller.active,
      });
      created += Number(result.created);
      updated += Number(!result.created);
    }
    console.log(JSON.stringify({ mode: "apply", sellers: sellers.length, created, updated }));
  }
} finally {
  await repository.close();
}
