import { NextResponse } from "next/server";
import { hasCapability } from "@igd/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getProgressData } from "@/lib/data";
import { parseOrganizationSelection } from "@/lib/organization-scope";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword || !hasCapability(user, "analytics:read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const selected = parseOrganizationSelection(Object.fromEntries(new URL(request.url).searchParams.entries()));
  return NextResponse.json(await getProgressData(user, selected), { headers: { "cache-control": "private, no-store" } });
}
