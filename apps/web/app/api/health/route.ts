import { NextResponse } from "next/server";
import { getSql } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getSql()`select 1`;
  } catch {
    return NextResponse.json(
      { status: "unavailable", database: "unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: "ok", database: "connected" });
}
