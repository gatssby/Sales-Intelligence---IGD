import { NextResponse } from "next/server";
import { hasCapability } from "@igd/auth";
import { PostgresDriveDiscoveryRepository } from "@igd/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword || !hasCapability(user, "settings:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(
    await new PostgresDriveDiscoveryRepository(getSql()).getSnapshot(),
    { headers: { "cache-control": "private, no-store" } },
  );
}
