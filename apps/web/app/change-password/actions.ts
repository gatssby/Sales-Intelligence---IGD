"use server";

import { redirect } from "next/navigation";
import { PostgresAuthRepository } from "@igd/db";
import { assertMutationAllowed } from "@igd/auth";
import { getSql } from "@/lib/database";
import { clearSessionCookie, requireUser } from "@/lib/auth/session";

export type ChangePasswordState = { error: string | null };

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser({ allowPasswordChange: true });
  assertMutationAllowed(user);
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const nextPassword = String(formData.get("nextPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (nextPassword !== confirmation) return { error: "A confirmação da nova senha não confere." };
  try {
    await new PostgresAuthRepository(getSql()).changeOwnPassword(user.userId, currentPassword, nextPassword);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "current_password_invalid") return { error: "A senha atual não confere." };
    if (code.startsWith("password_")) return { error: "Use ao menos 12 caracteres, com maiúscula, minúscula e número." };
    throw error;
  }
  await clearSessionCookie();
  redirect("/login?password=changed");
}
