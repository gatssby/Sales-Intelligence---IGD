import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { getGeminiPocMonitorData } from "@/lib/gemini-poc-monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireCapability("platform:observe");
  } catch (err) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  try {
    const sql = getSql();
    const data = await getGeminiPocMonitorData(sql);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Monitor API Error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
