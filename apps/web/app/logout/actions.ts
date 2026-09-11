"use server";

import { redirect } from "next/navigation";
import { PostgresAuthRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { clearSessionCookie, readSessionToken } from "@/lib/auth/session";

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await new PostgresAuthRepository(getSql()).revokeSession(token);
  await clearSessionCookie();
  redirect("/login");
}
