import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PostgresAuthRepository } from "@igd/db";
import { buildDevelopmentAuthBypass, hasCapability, type AuthorizationContext, type Capability } from "@igd/auth";
import { getSql } from "@/lib/database";

const DEV_COOKIE = "igd_session";
const PROD_COOKIE = "__Host-igd_session";

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? PROD_COOKIE : DEV_COOKIE;
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
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

export async function getCurrentUser(): Promise<AuthorizationContext | null> {
  const developmentUser = buildDevelopmentAuthBypass({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.DEV_BYPASS_AUTH,
  });
  if (developmentUser) return developmentUser;

  const token = await readSessionToken();
  if (!token) return null;
  return new PostgresAuthRepository(getSql()).getSession(token);
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
