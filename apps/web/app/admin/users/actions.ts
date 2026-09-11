"use server";

import { revalidatePath } from "next/cache";
import { PostgresAuthRepository } from "@igd/db";
import { parseUserForm } from "@/lib/auth/forms";
import { requireMutationCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export type AccessActionState = {
  error: string | null;
  message: string | null;
  temporaryPassword: string | null;
};

function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("leader_requires")) return "Associe pelo menos um time e nenhum produto ao líder.";
  if (message.includes("supervisor_requires")) return "Associe pelo menos um produto e nenhum time ao supervisor.";
  if (message.includes("global_role")) return "Admin e Sales Ops usam escopo global e não aceitam escopos específicos.";
  if (message.includes("user_requires_person_link")) return "Vincule a conta de usuário a uma pessoa com V-code.";
  if (message.includes("unique") || message.includes("duplicate")) return "Já existe uma conta com esse e-mail.";
  if (message.includes("cannot_deactivate_self")) return "Você não pode desativar a própria conta.";
  if (message.includes("cannot_change_own_role")) return "Você não pode remover o próprio papel de administrador.";
  if (message.includes("cannot_remove_last_admin")) return "Mantenha pelo menos um administrador ativo.";
  return "Não foi possível salvar o acesso. Revise os campos e tente novamente.";
}

export async function createUserAction(
  _previous: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireMutationCapability("users:manage");
  try {
    const result = await new PostgresAuthRepository(getSql()).createUser(actor, parseUserForm(formData));
    revalidatePath("/admin/users");
    return {
      error: null,
      message: `Acesso criado para ${result.user.displayName}. Copie a senha agora.`,
      temporaryPassword: result.temporaryPassword,
    };
  } catch (error) {
    return { error: userFacingError(error), message: null, temporaryPassword: null };
  }
}

export async function updateUserAction(
  _previous: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireMutationCapability("users:manage");
  try {
    const userId = String(formData.get("userId") ?? "");
    await new PostgresAuthRepository(getSql()).updateUser(actor, userId, parseUserForm(formData));
    revalidatePath("/admin/users");
    return { error: null, message: "Conta, vínculo e acesso efetivo atualizados.", temporaryPassword: null };
  } catch (error) {
    return { error: userFacingError(error), message: null, temporaryPassword: null };
  }
}

export async function toggleUserAction(
  _previous: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireMutationCapability("users:manage");
  try {
    const userId = String(formData.get("userId") ?? "");
    const active = String(formData.get("active")) === "true";
    await new PostgresAuthRepository(getSql()).setUserActive(actor, userId, active);
    revalidatePath("/admin/users");
    return { error: null, message: active ? "Conta reativada." : "Conta desativada e sessões revogadas.", temporaryPassword: null };
  } catch (error) {
    return { error: userFacingError(error), message: null, temporaryPassword: null };
  }
}

export async function resetPasswordAction(
  _previous: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const actor = await requireMutationCapability("users:manage");
  try {
    const userId = String(formData.get("userId") ?? "");
    const temporaryPassword = await new PostgresAuthRepository(getSql()).resetPassword(actor, userId);
    revalidatePath("/admin/users");
    return { error: null, message: "Senha redefinida. Copie-a agora.", temporaryPassword };
  } catch (error) {
    return { error: userFacingError(error), message: null, temporaryPassword: null };
  }
}
