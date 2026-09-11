import { NextResponse } from "next/server";
import { hasCapability } from "@igd/auth";
import { parseOrganizationSheet, safeOrganizationSyncError } from "@igd/core";
import { PostgresOrganizationRepository } from "@igd/db";
import { GoogleOAuthRefreshTokenProvider, GoogleSheetsOrganizationClient } from "@igd/google";
import { getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export const dynamic = "force-dynamic";

async function admin() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (user.mustChangePassword || !hasCapability(user, "settings:manage")) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const authorization = await admin();
  if ("response" in authorization) return authorization.response;
  const runs = await new PostgresOrganizationRepository(getSql()).getSyncStatus(authorization.user, 20);
  return NextResponse.json(runs, { headers: { "cache-control": "private, no-store" } });
}

export async function POST() {
  const authorization = await admin();
  if ("response" in authorization) return authorization.response;
  const spreadsheetId = process.env.ORGANIZATION_SPREADSHEET_ID?.trim();
  const sheetId = Number(process.env.ORGANIZATION_SHEET_ID);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
  if (!spreadsheetId || !Number.isInteger(sheetId) || sheetId < 0 || !clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({ error: "organization_sync_configuration_incomplete" }, { status: 503 });
  }
  const observedAt = new Date().toISOString();
  const repository = new PostgresOrganizationRepository(getSql());
  try {
    const sheet = await new GoogleSheetsOrganizationClient(new GoogleOAuthRefreshTokenProvider({ clientId, clientSecret, refreshToken }))
      .readOrganizationSheet({ spreadsheetId, sheetId });
    const candidate = parseOrganizationSheet({ values: sheet.values, observedAt });
    const result = await repository.publishCandidate({
      candidate,
      triggeredByUserId: authorization.user.userId,
      source: { spreadsheetId, sheetId, revision: sheet.revision, modifiedTime: sheet.modifiedTime },
    });
    return NextResponse.json(result, { status: result.status === "rejected" ? 422 : 200, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const errorCode = safeOrganizationSyncError(error);
    await repository.recordFailure({
      observedAt,
      errorCode,
      source: { spreadsheetId, sheetId, revision: null, modifiedTime: null },
    }).catch(() => undefined);
    return NextResponse.json({ error: errorCode }, { status: 502, headers: { "cache-control": "private, no-store" } });
  }
}
