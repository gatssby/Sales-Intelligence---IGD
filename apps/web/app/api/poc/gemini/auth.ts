import { NextRequest, NextResponse } from "next/server";

export function authenticatePocWorker(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "missing_token" }, { status: 401 });
  }

  const token = authHeader.substring(7);
  const expectedToken = process.env.GEMINI_POC_WORKER_TOKEN;

  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  return null; // authentication passed
}
