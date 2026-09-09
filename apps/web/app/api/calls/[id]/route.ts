import { NextResponse, type NextRequest } from "next/server";
import { hasCapability } from "@igd/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getCallDetail } from "@/lib/data";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password_change_required" }, { status: 403 });
  if (!hasCapability(user, "calls:read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const call = await getCallDetail(user, (await context.params).id);
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ call }, { headers: { "cache-control": "private, no-store" } });
}
