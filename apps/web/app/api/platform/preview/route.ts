import { NextRequest, NextResponse } from "next/server";
import { isPreviewRole } from "@igd/auth";
import { PostgresAuthRepository } from "@igd/db";
import { clearPreviewCookie, getAuthenticatedActor, getCurrentUser, setPreviewCookie } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const actor = await getAuthenticatedActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (actor.role !== "PLATFORM_ADMIN" || actor.mustChangePassword) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { kind?: unknown; subjectPersonId?: unknown; subjectUserId?: unknown } | null;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const subjectPersonId = typeof body?.subjectPersonId === "string" ? body.subjectPersonId : null;
  const subjectUserId = typeof body?.subjectUserId === "string" ? body.subjectUserId : null;
  if (!isPreviewRole(kind)) return NextResponse.json({ error: "invalid_preview" }, { status: 400 });
  const repository = new PostgresAuthRepository(getSql());
  try {
    const previewContext = await repository.resolvePreviewContext(actor, { kind, subjectPersonId, subjectUserId });
    await repository.recordPreviewEvent(actor, "preview.started", previewContext.preview);
    await setPreviewCookie({ kind, subjectPersonId, subjectUserId });
    return NextResponse.json({ ok: true, preview: previewContext.preview }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "invalid_preview" }, { status: 400 });
  }
}

export async function DELETE() {
  const actor = await getAuthenticatedActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (actor.role !== "PLATFORM_ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const current = await getCurrentUser();
  await new PostgresAuthRepository(getSql()).recordPreviewEvent(actor, "preview.ended", current?.preview ?? null);
  await clearPreviewCookie();
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
}
