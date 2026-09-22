import { NextRequest, NextResponse } from "next/server";
import { authenticatePocWorker } from "../auth";
import { getSql } from "@/lib/database";
import { failPocJob } from "../../../../../lib/poc-db";
import { parsePocFailRequest } from "../../../../../lib/poc-request-validation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authError = authenticatePocWorker(req);
  if (authError) return authError;

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const input = parsePocFailRequest(body);
  if (!input) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const sql = getSql();

  try {
    const success = await failPocJob(sql, input.workerId, input.jobId, input.errorCode, input.retryable);
    if (!success) {
      return NextResponse.json({ error: "job_not_owned_or_invalid_state" }, { status: 403 });
    }

    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("POC Fail error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
