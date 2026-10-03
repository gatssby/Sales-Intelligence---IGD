import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizationContext } from "@igd/auth";
import { ScopedSalesRepository } from "../src/access";
import { legacyAnalysisRunPredicate } from "../src/analysis-run-schema";

function fakeSql() {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((result, part, index) => `${result}${part}${index < values.length ? "[value]" : ""}`, "");
    queries.push(text);
    if (text.includes("information_schema.columns")) return Promise.resolve([{ present: false }]);
    if (text.includes("with scoped_calls as")) {
      return Promise.resolve([{
        analyzed_calls: 0,
        transcript_calls: 0,
        seller_count: 0,
        average_score: 0,
        top_opportunity_label: "Não disponível",
      }]);
    }
    return { text };
  }) as unknown as { (strings: TemplateStringsArray, ...values: unknown[]): unknown; unsafe: (value: string) => unknown };
  sql.unsafe = (value: string) => ({ text: value });
  return { sql, queries };
}

test("dashboard summary remains readable without migration 014 column", async () => {
  const { sql, queries } = fakeSql();
  const repository = new ScopedSalesRepository(sql as never);
  const context = buildAuthorizationContext({
    userId: "schema-compat-synthetic",
    email: "schema-compat@example.invalid",
    displayName: "Schema Compatibility",
    role: "ADMIN",
  });

  const summary = await repository.getDashboardSummary(context);

  assert.equal(summary.analyzed_calls, 0);
  const dashboardQuery = queries.find((query) => query.includes("with scoped_calls as"));
  assert.ok(dashboardQuery);
  assert.doesNotMatch(dashboardQuery, /ar\.engine_family/);
});

test("missing engine_family uses a composable TRUE SQL predicate", async () => {
  const { sql } = fakeSql();
  const predicate = await legacyAnalysisRunPredicate(sql as never, "ar");
  assert.equal((predicate as unknown as { text: string }).text, "TRUE");
});
