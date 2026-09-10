export type VercelKeySpend = {
  currentSpendUsd: number;
  limitUsd: number;
  active: boolean;
};

export function parseVercelKeySpend(raw: string): VercelKeySpend {
  const payload = JSON.parse(raw) as {
    apiKey?: { activeAt?: string | null; leakedAt?: string | null; quota?: { currentSpend?: number; limitAmount?: number; active?: boolean } };
  };
  const key = payload.apiKey;
  const quota = key?.quota;
  const currentSpendUsd = Number(quota?.currentSpend);
  const limitUsd = Number(quota?.limitAmount);
  const active = quota?.active !== false && !key?.leakedAt;
  if (!Number.isFinite(currentSpendUsd) || currentSpendUsd < 0 || !Number.isFinite(limitUsd) || limitUsd <= 0) {
    throw new Error("vercel_key_spend_invalid");
  }
  return { currentSpendUsd, limitUsd, active };
}

export class VercelApiKeySpendReader {
  constructor(
    private readonly keyId = process.env.VERCEL_AI_GATEWAY_KEY_ID ?? "",
    private readonly token = process.env.VERCEL_TOKEN ?? "",
    private readonly teamId = process.env.VERCEL_TEAM_ID,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!this.keyId.trim() || !this.token.trim()) throw new Error("vercel_spend_reader_credentials_required");
  }

  async read(): Promise<VercelKeySpend> {
    const url = new URL(`https://api.vercel.com/v1/api-keys/${encodeURIComponent(this.keyId)}`);
    if (this.teamId?.trim()) url.searchParams.set("teamId", this.teamId.trim());
    const response = await this.fetchImplementation(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error(`vercel_key_spend_failed:${response.status}`);
    const spend = parseVercelKeySpend(await response.text());
    if (!spend.active) throw new Error("vercel_key_inactive");
    return spend;
  }
}
