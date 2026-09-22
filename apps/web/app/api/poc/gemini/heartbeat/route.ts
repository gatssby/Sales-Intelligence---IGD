import { NextRequest, NextResponse } from "next/server";
import { authenticatePocWorker } from "../auth";
import { getSql } from "@/lib/database";
import { heartbeatPocJob } from "../../../../../lib/poc-db";

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

  const { workerId, jobId, metrics } = body;
  if (typeof workerId !== "string" || !workerId.trim() || typeof jobId !== "string" || !jobId.trim()) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const sql = getSql();

  try {
    const updated = await heartbeatPocJob(sql, workerId, jobId, metrics);
    if (!updated) {
      return NextResponse.json({ error: "job_not_owned" }, { status: 403 });
    }

    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("POC Heartbeat error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
