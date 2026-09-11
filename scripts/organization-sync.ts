import { parseOrganizationSheet, safeOrganizationSyncError } from "@igd/core";
import { PostgresOrganizationRepository, type OrganizationSourceReference } from "@igd/db";
import { GoogleOAuthRefreshTokenProvider, GoogleSheetsOrganizationClient } from "@igd/google";
import postgres from "postgres";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name.toLowerCase()}_required`);
  return value;
}

function positiveInteger(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`invalid_${name.toLowerCase()}`);
  return value;
}

const apply = process.argv.includes("--apply");
const plan = process.argv.includes("--plan");
const daemon = process.argv.includes("--daemon");
if (daemon && !apply) throw new Error("organization_sync_daemon_requires_apply");
if (apply && plan) throw new Error("organization_sync_mode_conflict");

const spreadsheetId = required("ORGANIZATION_SPREADSHEET_ID");
const sheetId = positiveInteger("ORGANIZATION_SHEET_ID", -1, 0);
const intervalMs = positiveInteger("ORGANIZATION_SYNC_INTERVAL_MS", 300_000, 60_000);
const oauth = new GoogleOAuthRefreshTokenProvider({
  clientId: required("GOOGLE_OAUTH_CLIENT_ID"),
  clientSecret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
  refreshToken: required("GOOGLE_OAUTH_REFRESH_TOKEN"),
});
const sheets = new GoogleSheetsOrganizationClient(oauth);
const databaseUrl = apply || plan ? required("DATABASE_URL") : null;
const sql = databaseUrl
  ? postgres(databaseUrl, { max: 2, ssl: process.env.DATABASE_SSL === "require" ? "require" : false })
  : null;
const repository = sql ? new PostgresOrganizationRepository(sql) : null;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

function warningCounts(warnings: Array<{ code: string }>): Record<string, number> {
  return warnings.reduce<Record<string, number>>((counts, warning) => {
    counts[warning.code] = (counts[warning.code] ?? 0) + 1;
    return counts;
  }, {});
}

async function cycle(): Promise<void> {
  const observedAt = new Date().toISOString();
  let source: OrganizationSourceReference = { spreadsheetId, sheetId, revision: null, modifiedTime: null };
  try {
    const sheet = await sheets.readOrganizationSheet({ spreadsheetId, sheetId });
    source = { spreadsheetId, sheetId, revision: sheet.revision, modifiedTime: sheet.modifiedTime };
    const candidate = parseOrganizationSheet({ values: sheet.values, observedAt });
    const report = {
      mode: apply ? "apply" : plan ? "plan" : "read_only",
      oauthRefresh: "OK",
      sheetsApiAccess: "OK",
      spreadsheetMetadata: "OK",
      tabRead: "OK",
      headerValidation: candidate.rejectionReasons.some((reason) => reason.startsWith("missing_required_header")) ? "FAIL" : "OK",
      organizationParse: candidate.accepted ? "OK" : "FAIL",
      spreadsheetTitle: sheet.title,
      tabTitle: sheet.tabTitle,
      revision: sheet.revision,
      modifiedTime: sheet.modifiedTime,
      rows: candidate.rowCount,
      people: candidate.people.length,
      activePeople: candidate.people.filter((person) => person.active).length,
      inactivePeople: candidate.people.filter((person) => !person.active).length,
      products: candidate.products.length,
      fronts: candidate.fronts.length,
      teams: candidate.teams.length,
      leaders: new Set(candidate.leaderships.map((item) => item.leaderCode)).size,
      supervisors: candidate.supervisors.length,
      leadersInTraining: candidate.people.filter((person) => person.leaderInTraining).length,
      warnings: warningCounts(candidate.warnings),
      writes: false,
      aiRequests: 0,
    };
    if (!repository) {
      console.log(JSON.stringify(report));
      return;
    }
    if (plan) {
      console.log(JSON.stringify({ ...report, preview: await repository.previewCandidate(candidate) }));
      return;
    }
    const result = await repository.publishCandidate({ candidate, source });
    console.log(JSON.stringify({ ...report, writes: true, publish: result }));
  } catch (error) {
    const errorCode = safeOrganizationSyncError(error);
    if (repository) await repository.recordFailure({ source, observedAt, errorCode }).catch(() => undefined);
    console.error(JSON.stringify({
      mode: apply ? "apply" : plan ? "plan" : "read_only",
      status: "failed",
      errorCode,
      writes: apply,
      aiRequests: 0,
    }));
    if (!daemon) throw error;
  }
}

try {
  do {
    await cycle();
    if (!daemon || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (!stopping);
} finally {
  if (sql) await sql.end();
}
