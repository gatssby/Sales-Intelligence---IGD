import { NextResponse, type NextRequest } from "next/server";
import { hasCapability } from "@igd/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getCallCatalogPage } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword || !hasCapability(user, "calls:read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? "50") || 50));
  return NextResponse.json(await getCallCatalogPage(user, page, pageSize), { headers: { "cache-control": "private, no-store" } });
}
