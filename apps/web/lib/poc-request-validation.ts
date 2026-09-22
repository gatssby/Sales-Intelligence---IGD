export type PocFailRequest = {
  workerId: string;
  jobId: string;
  errorCode: string;
  retryable: boolean;
};

export function parsePocFailRequest(value: unknown): PocFailRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.workerId !== "string" || !body.workerId.trim()) return null;
  if (typeof body.jobId !== "string" || !body.jobId.trim()) return null;
  if (typeof body.errorCode !== "string" || !body.errorCode.trim() || body.errorCode.length > 80) return null;
  if (typeof body.retryable !== "boolean") return null;
  return {
    workerId: body.workerId.trim(),
    jobId: body.jobId.trim(),
    errorCode: body.errorCode.trim(),
    retryable: body.retryable,
  };
}
