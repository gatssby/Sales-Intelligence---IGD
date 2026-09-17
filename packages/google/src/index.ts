import { extractGoogleFileId, type TranscriptFetcher } from "@igd/core";

export * from "./organization-sheets";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_CHANGES_ENDPOINT = "https://www.googleapis.com/drive/v3/changes";

export interface GoogleAccessTokenProvider {
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<string>;
}

export interface GoogleOAuthRefreshTokenConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
}

export interface GoogleDriveFileMetadata {
  id: string;
  mimeType: string | null;
  size: string | null;
}

export type GoogleDriveUser = {
  displayName: string | null;
  emailAddress: string | null;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string | null;
  parents: string[];
  driveId: string | null;
  trashed: boolean;
  createdTime: string | null;
  modifiedTime: string | null;
  sharedWithMeTime: string | null;
  version: string | null;
  webViewLink: string | null;
  resourceKey: string | null;
  shortcutDetails: {
    targetId: string;
    targetMimeType: string | null;
    targetResourceKey: string | null;
  } | null;
  owners: GoogleDriveUser[];
  sharingUser: GoogleDriveUser | null;
  lastModifyingUser: GoogleDriveUser | null;
  capabilities: { canDownload: boolean | null; canListChildren: boolean | null };
};

export type GoogleDriveChange = {
  fileId: string;
  removed: boolean;
  time: string | null;
  driveId: string | null;
  file: GoogleDriveFile | null;
};

const DRIVE_FILE_FIELDS = [
  "id", "name", "mimeType", "parents", "driveId", "trashed", "createdTime", "modifiedTime",
  "sharedWithMeTime", "version", "webViewLink", "resourceKey",
  "shortcutDetails(targetId,targetMimeType,targetResourceKey)",
  "owners(displayName,emailAddress)", "sharingUser(displayName,emailAddress)",
  "lastModifyingUser(displayName,emailAddress)", "capabilities(canDownload,canListChildren)",
].join(",");

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDriveUser(value: unknown): GoogleDriveUser | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return { displayName: nullableString(record.displayName), emailAddress: nullableString(record.emailAddress) };
}

function parseDriveFile(value: unknown): GoogleDriveFile {
  if (!value || typeof value !== "object") throw new Error("google_drive_invalid_file");
  const record = value as Record<string, unknown>;
  const id = nullableString(record.id);
  if (!id) throw new Error("google_drive_invalid_file");
  const shortcut = record.shortcutDetails && typeof record.shortcutDetails === "object"
    ? record.shortcutDetails as Record<string, unknown>
    : null;
  const targetId = nullableString(shortcut?.targetId);
  const capabilities = record.capabilities && typeof record.capabilities === "object"
    ? record.capabilities as Record<string, unknown>
    : {};
  return {
    id,
    name: nullableString(record.name) ?? "",
    mimeType: nullableString(record.mimeType),
    parents: Array.isArray(record.parents) ? record.parents.filter((item): item is string => typeof item === "string") : [],
    driveId: nullableString(record.driveId),
    trashed: record.trashed === true,
    createdTime: nullableString(record.createdTime),
    modifiedTime: nullableString(record.modifiedTime),
    sharedWithMeTime: nullableString(record.sharedWithMeTime),
    version: nullableString(record.version),
    webViewLink: nullableString(record.webViewLink),
    resourceKey: nullableString(record.resourceKey),
    shortcutDetails: targetId ? {
      targetId,
      targetMimeType: nullableString(shortcut?.targetMimeType),
      targetResourceKey: nullableString(shortcut?.targetResourceKey),
    } : null,
    owners: Array.isArray(record.owners) ? record.owners.map(parseDriveUser).filter((item): item is GoogleDriveUser => item !== null) : [],
    sharingUser: parseDriveUser(record.sharingUser),
    lastModifyingUser: parseDriveUser(record.lastModifyingUser),
    capabilities: {
      canDownload: typeof capabilities.canDownload === "boolean" ? capabilities.canDownload : null,
      canListChildren: typeof capabilities.canListChildren === "boolean" ? capabilities.canListChildren : null,
    },
  };
}

export class GoogleDriveDiscoveryClient {
  constructor(
    private readonly tokenProvider: GoogleAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async listSharedWithMe(): Promise<GoogleDriveFile[]> {
    return this.listFiles("sharedWithMe = true and trashed = false");
  }

  async listChildren(folderId: string, resourceKey?: string | null): Promise<GoogleDriveFile[]> {
    const escaped = folderId.replace(/['\\]/g, "\\$&");
    return this.listFiles(
      `'${escaped}' in parents and trashed = false`,
      resourceKey ? { "X-Goog-Drive-Resource-Keys": `${folderId}/${resourceKey}` } : undefined,
    );
  }

  async getFile(fileId: string, resourceKey?: string | null): Promise<GoogleDriveFile> {
    const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`);
    url.searchParams.set("fields", DRIVE_FILE_FIELDS);
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.authorizedFetch(url, resourceKey ? { "X-Goog-Drive-Resource-Keys": `${fileId}/${resourceKey}` } : undefined);
    this.assertDriveResponse(response);
    return parseDriveFile(await response.json());
  }

  async getStartPageToken(): Promise<string> {
    const url = new URL(`${GOOGLE_DRIVE_CHANGES_ENDPOINT}/startPageToken`);
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.authorizedFetch(url);
    this.assertDriveResponse(response);
    const payload = await response.json() as { startPageToken?: unknown };
    const token = nullableString(payload.startPageToken);
    if (!token) throw new Error("google_drive_invalid_start_page_token");
    return token;
  }

  async listChanges(startPageToken: string): Promise<{ changes: GoogleDriveChange[]; newStartPageToken: string }> {
    if (!startPageToken.trim()) throw new Error("google_drive_start_page_token_required");
    const changes: GoogleDriveChange[] = [];
    let pageToken = startPageToken;
    let newStartPageToken: string | null = null;
    do {
      const url = new URL(GOOGLE_DRIVE_CHANGES_ENDPOINT);
      url.searchParams.set("pageToken", pageToken);
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("includeRemoved", "true");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,time,driveId,file(${DRIVE_FILE_FIELDS}))`);
      const response = await this.authorizedFetch(url);
      this.assertDriveResponse(response);
      const payload = await response.json() as { nextPageToken?: unknown; newStartPageToken?: unknown; changes?: unknown };
      if (Array.isArray(payload.changes)) {
        for (const value of payload.changes) {
          if (!value || typeof value !== "object") continue;
          const record = value as Record<string, unknown>;
          const fileId = nullableString(record.fileId);
          if (!fileId) continue;
          changes.push({
            fileId,
            removed: record.removed === true,
            time: nullableString(record.time),
            driveId: nullableString(record.driveId),
            file: record.file ? parseDriveFile(record.file) : null,
          });
        }
      }
      const next = nullableString(payload.nextPageToken);
      if (next) pageToken = next;
      else {
        newStartPageToken = nullableString(payload.newStartPageToken);
        pageToken = "";
      }
    } while (pageToken);
    if (!newStartPageToken) throw new Error("google_drive_missing_new_start_page_token");
    return { changes, newStartPageToken };
  }

  private async listFiles(query: string, extraHeaders: Record<string, string> = {}): Promise<GoogleDriveFile[]> {
    const files: GoogleDriveFile[] = [];
    let pageToken: string | null = null;
    do {
      const url = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("corpora", "user");
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("fields", `nextPageToken,incompleteSearch,files(${DRIVE_FILE_FIELDS})`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.authorizedFetch(url, extraHeaders);
      this.assertDriveResponse(response);
      const payload = await response.json() as { nextPageToken?: unknown; files?: unknown };
      if (Array.isArray(payload.files)) files.push(...payload.files.map(parseDriveFile));
      pageToken = nullableString(payload.nextPageToken);
    } while (pageToken);
    return files;
  }

  private async authorizedFetch(url: URL, extraHeaders: Record<string, string> = {}): Promise<Response> {
    let token = await this.tokenProvider.getAccessToken();
    let response = await this.fetchImplementation(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } });
    if (response.status !== 401) return response;
    token = await this.tokenProvider.getAccessToken({ forceRefresh: true });
    return this.fetchImplementation(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } });
  }

  private assertDriveResponse(response: Response): void {
    if (response.status === 401) throw new Error("google_authentication_required");
    if (response.status === 403) throw new Error("drive_access_denied");
    if (response.status === 404) throw new Error("drive_file_not_found");
    if (response.status === 429) throw new Error("drive_rate_limited");
    if (response.status >= 500) throw new Error("drive_provider_unavailable");
    if (!response.ok) throw new Error("drive_discovery_failed");
  }
}

export interface GoogleDriveTreeClient {
  listChildren(folderId: string, resourceKey?: string | null): Promise<GoogleDriveFile[]>;
  getFile(fileId: string, resourceKey?: string | null): Promise<GoogleDriveFile>;
}

export type GoogleDriveTreeEntry = {
  file: GoogleDriveFile;
  ancestorIds: string[];
  ancestorNames: string[];
  shortcutId: string | null;
};

export type GoogleDriveTreeError = {
  fileId: string;
  errorCode: string;
  shortcutId?: string;
  name?: string;
  mimeType?: string | null;
  ancestorIds?: string[];
  ancestorNames?: string[];
};

export async function discoverGoogleDriveTree(
  client: GoogleDriveTreeClient,
  root: { id: string; name: string; resourceKey?: string | null },
): Promise<{ entries: GoogleDriveTreeEntry[]; errors: GoogleDriveTreeError[] }> {
  const folderMimeType = "application/vnd.google-apps.folder";
  const shortcutMimeType = "application/vnd.google-apps.shortcut";
  const queue: Array<{ id: string; resourceKey: string | null; ancestorIds: string[]; ancestorNames: string[] }> = [
    { id: root.id, resourceKey: root.resourceKey ?? null, ancestorIds: [root.id], ancestorNames: [root.name] },
  ];
  const visitedFolders = new Set<string>();
  const seenEntries = new Set<string>();
  const entries: GoogleDriveTreeEntry[] = [];
  const errors: GoogleDriveTreeError[] = [];

  const pushEntry = (entry: GoogleDriveTreeEntry) => {
    const occurrenceKey = `${entry.file.id}:${entry.shortcutId ?? "direct"}`;
    if (seenEntries.has(occurrenceKey)) return;
    seenEntries.add(occurrenceKey);
    entries.push(entry);
  };

  while (queue.length) {
    const folder = queue.shift()!;
    if (visitedFolders.has(folder.id)) continue;
    visitedFolders.add(folder.id);
    let children: GoogleDriveFile[];
    try {
      children = await client.listChildren(folder.id, folder.resourceKey);
    } catch (error) {
      errors.push({ fileId: folder.id, errorCode: error instanceof Error ? error.message : "drive_list_children_failed" });
      continue;
    }
    for (const child of children) {
      if (child.trashed) continue;
      let canonical = child;
      let shortcutId: string | null = null;
      if (child.mimeType === shortcutMimeType && child.shortcutDetails) {
        shortcutId = child.id;
        try {
          canonical = await client.getFile(child.shortcutDetails.targetId, child.shortcutDetails.targetResourceKey);
        } catch (error) {
          errors.push({
            fileId: child.shortcutDetails.targetId,
            shortcutId: child.id,
            name: child.name,
            mimeType: child.shortcutDetails.targetMimeType,
            ancestorIds: folder.ancestorIds,
            ancestorNames: folder.ancestorNames,
            errorCode: error instanceof Error ? error.message : "drive_shortcut_target_failed",
          });
          continue;
        }
      }
      const entry = { file: canonical, ancestorIds: folder.ancestorIds, ancestorNames: folder.ancestorNames, shortcutId };
      pushEntry(entry);
      if (canonical.mimeType === folderMimeType) {
        queue.push({
          id: canonical.id,
          resourceKey: canonical.resourceKey ?? child.shortcutDetails?.targetResourceKey ?? null,
          ancestorIds: [...folder.ancestorIds, canonical.id],
          ancestorNames: [...folder.ancestorNames, canonical.name],
        });
      }
    }
  }
  return { entries, errors };
}

export class GoogleOAuthRefreshTokenProvider implements GoogleAccessTokenProvider {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private refreshInFlight: Promise<string> | null = null;

  constructor(private readonly config: GoogleOAuthRefreshTokenConfig) {
    if (!config.clientId.trim() || !config.clientSecret.trim() || !config.refreshToken.trim()) {
      throw new Error("google_oauth_configuration_incomplete");
    }
    this.fetchImplementation = config.fetchImplementation ?? fetch;
    this.now = config.now ?? Date.now;
    this.refreshSkewMs = config.refreshSkewMs ?? 60_000;
  }

  async getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    if (!options.forceRefresh && this.cachedToken && this.cachedToken.expiresAt - this.refreshSkewMs > this.now()) {
      return this.cachedToken.value;
    }
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = this.refresh();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
    });
    const response = await this.fetchImplementation(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error("google_oauth_refresh_failed");

    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== "string" || !payload.access_token.trim()) {
      throw new Error("google_oauth_refresh_invalid_response");
    }
    const expiresInSeconds = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? Math.max(0, payload.expires_in)
      : 3_600;
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: this.now() + expiresInSeconds * 1_000,
    };
    return payload.access_token;
  }
}

export class GoogleDriveTranscriptFetcher implements TranscriptFetcher {
  constructor(
    private readonly tokenProvider: GoogleAccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async getMetadata(transcriptFileId: string, transcriptUrl?: string): Promise<GoogleDriveFileMetadata> {
    const fileId = this.resolveFileId(transcriptFileId, transcriptUrl);
    const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`);
    url.searchParams.set("fields", "id,mimeType,size");
    const response = await this.authorizedFetch(url);
    this.assertDriveResponse(response);
    const payload = await response.json() as { id?: unknown; mimeType?: unknown; size?: unknown };
    return {
      id: typeof payload.id === "string" ? payload.id : fileId,
      mimeType: typeof payload.mimeType === "string" ? payload.mimeType : null,
      size: typeof payload.size === "string" ? payload.size : null,
    };
  }

  async fetch(transcriptFileId: string, transcriptUrl?: string): Promise<string> {
    const fileId = this.resolveFileId(transcriptFileId, transcriptUrl);
    const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}/export`);
    url.searchParams.set("mimeType", "text/plain");
    const response = await this.authorizedFetch(url);
    this.assertDriveResponse(response);
    const text = await response.text();
    if (!text.trim()) throw new Error("transcript_empty");
    return text;
  }

  async fetchByMimeType(transcriptFileId: string, mimeType: string | null, resourceKey?: string | null): Promise<string> {
    const fileId = this.resolveFileId(transcriptFileId);
    const googleDocument = mimeType === "application/vnd.google-apps.document";
    if (!googleDocument && mimeType !== "text/plain" && mimeType !== "text/vtt") {
      throw new Error("transcript_unsupported_content_type");
    }
    const url = new URL(`${GOOGLE_DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}${googleDocument ? "/export" : ""}`);
    if (googleDocument) url.searchParams.set("mimeType", "text/plain");
    else url.searchParams.set("alt", "media");
    const headers = resourceKey ? { "X-Goog-Drive-Resource-Keys": `${fileId}/${resourceKey}` } : undefined;
    const response = await this.authorizedFetch(url, headers);
    this.assertDriveResponse(response);
    const text = await response.text();
    if (!text.trim()) throw new Error("transcript_empty");
    return text;
  }

  private resolveFileId(transcriptFileId: string, transcriptUrl?: string): string {
    const fileId = extractGoogleFileId(transcriptFileId) ?? extractGoogleFileId(transcriptUrl);
    if (!fileId) throw new Error("invalid_transcript_file_id");
    return fileId;
  }

  private async authorizedFetch(url: URL, extraHeaders: Record<string, string> = {}): Promise<Response> {
    let accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.fetchImplementation(url, {
      headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
    });
    if (response.status !== 401) return response;

    accessToken = await this.tokenProvider.getAccessToken({ forceRefresh: true });
    response = await this.fetchImplementation(url, {
      headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
    });
    return response;
  }

  private assertDriveResponse(response: Response): void {
    if (response.status === 401) throw new Error("google_authentication_required");
    if (response.status === 403) throw new Error("transcript_access_denied");
    if (response.status === 404) throw new Error("transcript_not_found");
    if (response.status === 429) throw new Error("transcript_rate_limited");
    if (response.status >= 500) throw new Error("transcript_provider_unavailable");
    if (!response.ok) throw new Error("transcript_fetch_failed");
  }
}

export function createGoogleDriveTranscriptFetcherFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch,
): GoogleDriveTranscriptFetcher | null {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = environment.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() ?? "";
  const configured = [clientId, clientSecret, refreshToken].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) throw new Error("google_oauth_configuration_incomplete");
  return new GoogleDriveTranscriptFetcher(new GoogleOAuthRefreshTokenProvider({
    clientId,
    clientSecret,
    refreshToken,
    fetchImplementation,
  }), fetchImplementation);
}

export function createGoogleDriveDiscoveryClientFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch,
): GoogleDriveDiscoveryClient | null {
  const clientId = environment.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = environment.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = environment.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() ?? "";
  const configured = [clientId, clientSecret, refreshToken].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) throw new Error("google_oauth_configuration_incomplete");
  return new GoogleDriveDiscoveryClient(new GoogleOAuthRefreshTokenProvider({
    clientId,
    clientSecret,
    refreshToken,
    fetchImplementation,
  }), fetchImplementation);
}
