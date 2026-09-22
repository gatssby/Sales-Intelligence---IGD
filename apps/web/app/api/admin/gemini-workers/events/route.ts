import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { getGeminiPocEvents } from "@/lib/gemini-poc-events";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireCapability("platform:observe");
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const afterText = request.nextUrl.searchParams.get("after") ?? "0";
  const after = Number(afterText);
  if (!/^\d+$/.test(afterText) || !Number.isSafeInteger(after)) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getGeminiPocEvents(getSql(), after), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Gemini event API error:", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
