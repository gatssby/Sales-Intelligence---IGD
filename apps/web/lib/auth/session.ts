import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PostgresAuthRepository } from "@igd/db";
import { assertMutationAllowed, hasCapability, isPreviewRole, type AuthorizationContext, type Capability, type PreviewRole } from "@igd/auth";
import { getSql } from "@/lib/database";

const DEV_COOKIE = "igd_session";
const PROD_COOKIE = "__Host-igd_session";
const DEV_PREVIEW_COOKIE = "igd_preview";
const PROD_PREVIEW_COOKIE = "__Host-igd_preview";

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? PROD_COOKIE : DEV_COOKIE;
}

export function previewCookieName(): string {
  return process.env.NODE_ENV === "production" ? PROD_PREVIEW_COOKIE : DEV_PREVIEW_COOKIE;
}

export function encodePreviewCookie(input: { kind: PreviewRole; subjectPersonId?: string | null }): string {
  return `${input.kind}:${input.subjectPersonId ?? ""}`;
}

export function decodePreviewCookie(value: string): { kind: PreviewRole; subjectPersonId: string | null } | null {
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const kind = value.slice(0, separator);
  const subjectPersonId = value.slice(separator + 1) || null;
  if (!isPreviewRole(kind)) return null;
  if (kind === "ADMIN" && subjectPersonId) return null;
  if (kind !== "ADMIN" && !subjectPersonId) return null;
  return { kind, subjectPersonId };
}

export async function setPreviewCookie(input: { kind: PreviewRole; subjectPersonId?: string | null }): Promise<void> {
  const jar = await cookies();
  jar.set(previewCookieName(), encodePreviewCookie(input), {
    httpOnly: true,secure: process.env.NODE_ENV === "production",sameSite: "lax",path: "/",maxAge: 60 * 60 * 8,
  });
}

export async function clearPreviewCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(previewCookieName(), "", {
    httpOnly: true,secure: process.env.NODE_ENV === "production",sameSite: "lax",path: "/",maxAge: 0,
  });
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(previewCookieName(), "", {
    httpOnly: true,secure: process.env.NODE_ENV === "production",sameSite: "lax",path: "/",maxAge: 0,
  });
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(previewCookieName(), "", {
    httpOnly: true,secure: process.env.NODE_ENV === "production",sameSite: "lax",path: "/",maxAge: 0,
  });
  jar.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string> {
  return (await cookies()).get(sessionCookieName())?.value ?? "";
}

export async function getAuthenticatedActor(): Promise<AuthorizationContext | null> {
  const token = await readSessionToken();
  if (!token) return null;
  return new PostgresAuthRepository(getSql()).getSession(token);
}

export async function getCurrentUser(): Promise<AuthorizationContext | null> {
  const actor = await getAuthenticatedActor();
  if (!actor || actor.role !== "PLATFORM_ADMIN") return actor;
  const encoded = (await cookies()).get(previewCookieName())?.value ?? "";
  const preview = decodePreviewCookie(encoded);
  if (!preview) return actor;
  try {
    return await new PostgresAuthRepository(getSql()).resolvePreviewContext(actor, preview);
  } catch {
    return actor;
  }
}

export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<AuthorizationContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect("/change-password");
  return user;
}

export async function requireCapability(capability: Capability): Promise<AuthorizationContext> {
  const user = await requireUser();
  if (!hasCapability(user, capability)) redirect("/forbidden");
  return user;
}


export async function requireMutationCapability(capability: Capability): Promise<AuthorizationContext> {
  const user = await requireCapability(capability);
  try {
    assertMutationAllowed(user);
  } catch {
    redirect("/forbidden?reason=preview-read-only");
  }
  return user;
}
