import { NextResponse, type NextRequest } from "next/server";
import { hasCapability } from "@igd/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { getCallTranscript } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword || !hasCapability(user, "calls:read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const transcript = await getCallTranscript(user, (await context.params).id);
  if (transcript === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ transcript }, { headers: { "cache-control": "private, no-store" } });
}
