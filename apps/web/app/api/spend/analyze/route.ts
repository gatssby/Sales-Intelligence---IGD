import { NextResponse } from "next/server";
import { executeSpendGuarded } from "@igd/auth";
import { PostgresAuthRepository } from "@igd/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password_change_required" }, { status: 403 });
  const repository = new PostgresAuthRepository(getSql());
  const result = await executeSpendGuarded(user, {
    onDenied: () => repository.recordBlockedSpend(user, "analysis.http"),
    // The dashboard does not enqueue analysis yet. Keeping this boundary explicit
    // prevents an authorized-looking placeholder from creating a paid job.
    execute: () => ({ error: "not_implemented" as const }),
  });
  return result.allowed
    ? NextResponse.json(result.value, { status: 501 })
    : NextResponse.json({ error: "forbidden" }, { status: 403 });
}
