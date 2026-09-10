import { extractGoogleFileId, type TranscriptFetcher } from "@igd/core";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

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

  private resolveFileId(transcriptFileId: string, transcriptUrl?: string): string {
    const fileId = extractGoogleFileId(transcriptFileId) ?? extractGoogleFileId(transcriptUrl);
    if (!fileId) throw new Error("invalid_transcript_file_id");
    return fileId;
  }

  private async authorizedFetch(url: URL): Promise<Response> {
    let accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.fetchImplementation(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 401) return response;

    accessToken = await this.tokenProvider.getAccessToken({ forceRefresh: true });
    response = await this.fetchImplementation(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
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
