import { NextRequest, NextResponse } from "next/server";
import { authenticatePocWorker } from "../auth";
import { getSql } from "@/lib/database";
import { completePocJob } from "../../../../../lib/poc-db";

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

  const { workerId, jobId, result, rawResponse, latencyMs } = body;
  if (typeof workerId !== "string" || !workerId.trim() || typeof jobId !== "string" || !jobId.trim()) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const sql = getSql();

  try {
    const outcome = await completePocJob(sql, workerId, jobId, result, rawResponse, latencyMs);

    if (!outcome.success) {
      if (outcome.error === "schema_validation_failed") {
        return NextResponse.json({ error: outcome.error, details: outcome.details }, { status: 400 });
      }
      return NextResponse.json({ error: outcome.error }, { status: 403 });
    }

    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("POC Complete error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
