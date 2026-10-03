import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GoogleDriveDiscoveryClient,
  GoogleOAuthRefreshTokenProvider,
  type GoogleDriveFile,
} from "@igd/google";
import {
  buildScopeClosureRecord,
  writeScopeClosureArtifacts,
  type ScopeClosureRecord,
} from "./lib/system-one-scope-closure.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const EXPECTED_CURRENT_ROWS = 5235;
const PRIVATE_OUTPUT_DIRECTORY = resolve("private/system-one");
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const ALLOWED_READ_ONLY_DRIVE_SCOPES = new Set([
  DRIVE_READONLY_SCOPE,
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

type SafetyInput = {
  record_type: "safety";
  current_user: string;
  default_transaction_read_only: string;
  transaction_read_only: string;
  dangerous_role_attributes: boolean;
  migration_014_applied: boolean;
  migration_015_applied: boolean;
};

type CurrentInput = {
  record_type: "current_reference";
  call_id: string;
  file_id: string | null;
};

function outputDirectory(): string {
  const temporary = process.argv.slice(2).find((value) => value.startsWith("--temporary-output-dir="))?.slice("--temporary-output-dir=".length);
  if (!temporary) return PRIVATE_OUTPUT_DIRECTORY;
  const resolved = resolve(temporary);
  if (!resolved.startsWith("/tmp/system-one-scope-closure-")) throw new Error("scope_closure_temporary_output_invalid");
  return resolved;
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "drive_metadata_unavailable";
  if (/drive_file_not_found/.test(message)) return "drive_file_not_found";
  if (/drive_access_denied/.test(message)) return "drive_access_denied";
  if (/drive_authentication_required/.test(message)) return "drive_authentication_required";
  if (/drive_rate_limited/.test(message)) return "drive_rate_limited";
  if (/drive_provider_unavailable/.test(message)) return "drive_provider_unavailable";
  return "drive_metadata_unavailable";
}

function assertReadOnlyDriveScopes(scopes: string[]): void {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (!normalized.includes(DRIVE_READONLY_SCOPE) || normalized.some((scope) => !ALLOWED_READ_ONLY_DRIVE_SCOPES.has(scope))) {
    throw new Error("scope_closure_google_scope_not_read_only");
  }
}

async function retryRead<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = safeErrorCode(error);
      if (!["drive_rate_limited", "drive_provider_unavailable", "drive_metadata_unavailable"].includes(code) || attempt === attempts - 1) throw error;
      await new Promise((wait) => setTimeout(wait, 250 * 2 ** attempt));
    }
  }
  throw new Error("drive_metadata_retry_exhausted");
}

async function mapLimit<T, U>(values: T[], concurrency: number, operation: (value: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(values.length, 1)) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index], index);
    }
  }));
  return results;
}

function parseInput(content: string): { safety: SafetyInput; current: CurrentInput[] } {
  const values = content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
  const safety = values.find((value): value is SafetyInput => Boolean(value && typeof value === "object" && (value as { record_type?: unknown }).record_type === "safety"));
  const current = values.filter((value): value is CurrentInput => Boolean(value && typeof value === "object" && (value as { record_type?: unknown }).record_type === "current_reference"));
  if (!safety
    || safety.current_user !== "system_one_pilot_ro"
    || safety.default_transaction_read_only !== "on"
    || safety.transaction_read_only !== "on"
    || safety.dangerous_role_attributes
    || safety.migration_014_applied
    || safety.migration_015_applied) throw new Error("scope_closure_database_safety_invalid");
  if (current.length !== EXPECTED_CURRENT_ROWS || new Set(current.map((row) => row.call_id)).size !== EXPECTED_CURRENT_ROWS) {
    throw new Error("scope_closure_current_rows_invalid");
  }
  return { safety, current };
}

async function readStandardInput(): Promise<string> {
  let content = "";
  for await (const chunk of process.stdin) content += String(chunk);
  return content;
}

async function canonicalize(input: { drive: GoogleDriveDiscoveryClient; listedFile: GoogleDriveFile | null; fileId: string | null }): Promise<{
  listedFile: GoogleDriveFile | null;
  canonicalFile: GoogleDriveFile | null;
  errorCode: string | null;
}> {
  let listed = input.listedFile;
  try {
    if (!listed) {
      const fileId = input.fileId;
      if (!fileId) return { listedFile: null, canonicalFile: null, errorCode: "drive_metadata_unavailable" };
      listed = await retryRead(() => input.drive.getFile(fileId));
    }
    const resolved = listed;
    const shortcutDetails = resolved?.shortcutDetails;
    if (!resolved || resolved.mimeType !== "application/vnd.google-apps.shortcut" || !shortcutDetails) {
      return { listedFile: resolved, canonicalFile: resolved, errorCode: null };
    }
    const canonical = await retryRead(() => input.drive.getFile(shortcutDetails.targetId, shortcutDetails.targetResourceKey));
    return { listedFile: resolved, canonicalFile: canonical, errorCode: null };
  } catch (error) {
    return { listedFile: listed, canonicalFile: null, errorCode: safeErrorCode(error) };
  }
}

async function main(): Promise<void> {
  if (process.argv.some((value) => ["--apply", "--write-db", "--execute-provider", "--traverse-folders"].includes(value))) {
    throw new Error("scope_closure_read_only_metadata_only");
  }
  const inputPath = process.argv.slice(2).find((value) => value.startsWith("--input-jsonl="))?.slice("--input-jsonl=".length);
  const readsStdin = process.argv.includes("--input-stdin");
  if ((inputPath ? 1 : 0) + (readsStdin ? 1 : 0) !== 1) throw new Error("scope_closure_input_required");
  const input = readsStdin ? await readStandardInput() : await readFile(resolve(inputPath!), "utf8");
  const { current } = parseInput(input);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) throw new Error("scope_closure_google_oauth_incomplete");

  const oauth = new GoogleOAuthRefreshTokenProvider({ clientId, clientSecret, refreshToken });
  const token = await oauth.getAccessToken();
  const tokenInfo = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!tokenInfo.ok) throw new Error("scope_closure_google_scope_unavailable");
  const tokenPayload = await tokenInfo.json() as { scope?: unknown };
  assertReadOnlyDriveScopes(String(tokenPayload.scope ?? "").split(/\s+/).filter(Boolean));

  const drive = new GoogleDriveDiscoveryClient(oauth);
  const shared = await retryRead(() => drive.listSharedWithMe());
  const directShared = shared.filter((file) => file.mimeType !== FOLDER_MIME_TYPE && !file.trashed);
  const directRecords = await mapLimit(directShared, 12, async (listedFile) => {
    const canonical = await canonicalize({ drive, listedFile, fileId: listedFile.id });
    return buildScopeClosureRecord({
      source: "direct_shared",
      referenceId: listedFile.id,
      currentCallId: null,
      unresolvedAssetId: listedFile.id,
      ...canonical,
    });
  });

  const cache = new Map<string, Promise<{ listedFile: GoogleDriveFile | null; canonicalFile: GoogleDriveFile | null; errorCode: string | null }>>();
  const currentRecords = await mapLimit(current, 12, async (reference) => {
    const operation = reference.file_id
      ? cache.get(reference.file_id) ?? (() => {
        const value = canonicalize({ drive, listedFile: null, fileId: reference.file_id });
        cache.set(reference.file_id!, value);
        return value;
      })()
      : Promise.resolve({ listedFile: null, canonicalFile: null, errorCode: "drive_metadata_unavailable" });
    const canonical = await operation;
    return buildScopeClosureRecord({
      source: "current_reference",
      referenceId: reference.call_id,
      currentCallId: reference.call_id,
      unresolvedAssetId: reference.file_id,
      ...canonical,
    });
  });

  const summary = await writeScopeClosureArtifacts(outputDirectory(), [...directRecords, ...currentRecords] satisfies ScopeClosureRecord[]);
  console.log(JSON.stringify({
    event: "scope_closure_completed",
    ...summary,
    shared_folder_traversals: 0,
    transcript_content_fetches: 0,
    provider_calls: 0,
    drive_writes: 0,
    database_writes: 0,
  }));
}

await main();
