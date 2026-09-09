import { NextResponse, type NextRequest } from "next/server";
import { hasCapability } from "@igd/auth";
import { ScopedSalesRepository } from "@igd/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password_change_required" }, { status: 403 });
  if (!hasCapability(user, "calls:read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const call = await new ScopedSalesRepository(getSql()).getCallById(user, (await context.params).id);
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    call: {
      id: call.id,
      customerName: call.customer_name,
      sellerName: call.seller_name,
      teamName: call.team_name,
      productKey: call.product_key,
      startedAt: call.started_at,
      durationSeconds: call.duration_seconds,
      score: Number(call.score),
      analysis: call.result_json,
      transcript: call.normalized_text,
    },
  });
}
