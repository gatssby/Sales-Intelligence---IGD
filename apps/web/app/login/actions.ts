"use server";

import { redirect } from "next/navigation";
import { PostgresAuthRepository, GENERIC_LOGIN_ERROR } from "@igd/db";
import { getSql } from "@/lib/database";
import { setSessionCookie } from "@/lib/auth/session";

export type LoginState = { error: string | null };

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const session = await new PostgresAuthRepository(getSql()).authenticate(email, password);
  if (!session) return { error: GENERIC_LOGIN_ERROR };
  await setSessionCookie(session.token);
  redirect(session.context.mustChangePassword ? "/change-password" : "/");
}
