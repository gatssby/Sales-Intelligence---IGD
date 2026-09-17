import { NextResponse } from "next/server";
import { hasCapability } from "@igd/auth";
import { PostgresPlatformObservabilityRepository } from "@igd/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword || !hasCapability(user, "platform:observe")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const overview = await new PostgresPlatformObservabilityRepository(getSql()).getOverview(user);
  return NextResponse.json(overview, { headers: { "cache-control": "private, no-store" } });
}
