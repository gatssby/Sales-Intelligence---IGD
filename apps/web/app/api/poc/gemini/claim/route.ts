import { NextRequest, NextResponse } from "next/server";
import { authenticatePocWorker } from "../auth";
import { getSql } from "@/lib/database";
import { claimPocJob } from "../../../../../lib/poc-db";

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

  const { workerId } = body;
  if (typeof workerId !== "string" || !workerId.trim()) {
    return NextResponse.json({ error: "invalid_worker_id" }, { status: 400 });
  }

  const sql = getSql();
  const leaseSeconds = 300;

  try {
    const result = await claimPocJob(sql, workerId, leaseSeconds);
    if (!result) {
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({
      job: {
        jobId: result.job_id,
        callId: result.call_id,
        transcriptId: result.transcript_id,
        transcript: result.transcript,
        leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
        schemaVersion: "v1",
        promptVersion: "poc-v1",
        rubricVersion: "insider-demo-v0",
      },
    });
  } catch (error: any) {
    console.error("POC Claim error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
