export type OrganizationSheetRead = {
  spreadsheetId: string;
  title: string;
  sheetId: number;
  tabTitle: string;
  modifiedTime: string | null;
  revision: string | null;
  rowCount: number | null;
  columnCount: number | null;
  values: unknown[][];
};

type AccessTokenProvider = {
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<string>;
};

type SpreadsheetMetadata = {
  spreadsheetId?: unknown;
  properties?: { title?: unknown };
  sheets?: Array<{ properties?: { sheetId?: unknown; title?: unknown; gridProperties?: { rowCount?: unknown; columnCount?: unknown } } }>;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class GoogleSheetsOrganizationClient {
  constructor(
    private readonly tokenProvider: AccessTokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async readOrganizationSheet(input: { spreadsheetId: string; sheetId: number }): Promise<OrganizationSheetRead> {
    if (!input.spreadsheetId.trim()) throw new Error("google_spreadsheet_id_required");
    if (!Number.isInteger(input.sheetId) || input.sheetId < 0) throw new Error("google_sheet_id_invalid");

    const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}`);
    metadataUrl.searchParams.set("fields", "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))");
    const metadataResponse = await this.authorizedFetch(metadataUrl);
    this.assertResponse(metadataResponse);
    const metadata = await metadataResponse.json() as SpreadsheetMetadata;
    const tab = metadata.sheets?.find((sheet) => sheet.properties?.sheetId === input.sheetId)?.properties;
    const tabTitle = text(tab?.title);
    if (!tabTitle) throw new Error("google_sheet_tab_not_found");

    const range = `'${tabTitle.replaceAll("'", "''")}'!A:N`;
    const valuesUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}`);
    valuesUrl.searchParams.set("majorDimension", "ROWS");
    valuesUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    valuesUrl.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
    const revisionUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.spreadsheetId)}`);
    revisionUrl.searchParams.set("fields", "id,modifiedTime,version");

    const [valuesResponse, revisionResponse] = await Promise.all([
      this.authorizedFetch(valuesUrl),
      this.authorizedFetch(revisionUrl),
    ]);
    this.assertResponse(valuesResponse);
    this.assertResponse(revisionResponse);
    const valuesPayload = await valuesResponse.json() as { values?: unknown };
    const revisionPayload = await revisionResponse.json() as { modifiedTime?: unknown; version?: unknown };
    if (!Array.isArray(valuesPayload.values)) throw new Error("google_sheets_invalid_values_response");

    return {
      spreadsheetId: text(metadata.spreadsheetId) ?? input.spreadsheetId,
      title: text(metadata.properties?.title) ?? "",
      sheetId: input.sheetId,
      tabTitle,
      modifiedTime: text(revisionPayload.modifiedTime),
      revision: text(revisionPayload.version),
      rowCount: typeof tab?.gridProperties?.rowCount === "number" ? tab.gridProperties.rowCount : null,
      columnCount: typeof tab?.gridProperties?.columnCount === "number" ? tab.gridProperties.columnCount : null,
      values: valuesPayload.values as unknown[][],
    };
  }

  private async authorizedFetch(url: URL): Promise<Response> {
    let token = await this.tokenProvider.getAccessToken();
    let response = await this.fetchImplementation(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (response.status !== 401) return response;
    token = await this.tokenProvider.getAccessToken({ forceRefresh: true });
    response = await this.fetchImplementation(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    return response;
  }

  private assertResponse(response: Response): void {
    if (response.status === 401) throw new Error("google_authentication_required");
    if (response.status === 403) throw new Error("google_sheets_access_denied");
    if (response.status === 404) throw new Error("google_spreadsheet_or_tab_not_found");
    if (response.status === 429) throw new Error("google_sheets_rate_limited");
    if (response.status >= 500) throw new Error("google_sheets_provider_unavailable");
    if (!response.ok) throw new Error("google_sheets_read_failed");
  }
}
