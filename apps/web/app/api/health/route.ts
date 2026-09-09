import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getDashboardData();

  if (data.source !== "postgres" || !data.call) {
    return NextResponse.json(
      { status: "unavailable", database: "unavailable", currentAnalysis: false },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok", database: "connected", currentAnalysis: true });
}
