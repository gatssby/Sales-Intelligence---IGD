import { extractGoogleFileId, type TranscriptFetcher } from "@igd/core";

export class GoogleDriveTranscriptFetcher implements TranscriptFetcher {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!accessToken.trim()) throw new Error("google_access_token_required");
  }

  async fetch(transcriptFileId: string, transcriptUrl?: string): Promise<string> {
    const fileId = extractGoogleFileId(transcriptFileId) ?? extractGoogleFileId(transcriptUrl);
    if (!fileId) throw new Error("invalid_transcript_file_id");

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`);
    url.searchParams.set("mimeType", "text/plain");
    const response = await this.fetchImplementation(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (response.status === 401 || response.status === 403) throw new Error("transcript_access_denied");
    if (response.status === 404) throw new Error("transcript_not_found");
    if (!response.ok) throw new Error("transcript_fetch_failed");
    const text = await response.text();
    if (!text.trim()) throw new Error("transcript_empty");
    return text;
  }
}
