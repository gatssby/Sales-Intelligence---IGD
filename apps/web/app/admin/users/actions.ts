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
  if (message.includes("leader_requires")) return "Associe pelo menos um Time e nenhum Produto ao perfil de Líder.";
  if (message.includes("manual_team_scope_invalid")) return "Selecione apenas Times ativos de produtos analíticos.";
  if (message.includes("supervisor_requires") || message.includes("manual_product_scope_invalid")) return "Selecione exatamente um Produto analítico para o Supervisor.";
  if (message.includes("global_role")) return "Administrador tem abrangência comercial global e não usa seleção de Pessoa, Time ou Produto.";
  if (message.includes("manual_self")) return "Closer e SDR precisam de uma Pessoa analítica ativa.";
  if (message.includes("manual_account_cannot_claim")) return "Essa Pessoa já pertence à Organização IGD. Crie uma conta pela origem Organização IGD.";
  if (message.includes("organization_account_requires")) return "Selecione uma Pessoa ativa com Cargo vigente na Organização IGD.";
  if (message.includes("organization_account_origin")) return "Uma conta da Organização IGD não pode ser convertida para Manual por esta edição.";
  if (message.includes("legacy_access_requires_review")) return "Escolha um dos perfis de acesso Manual disponíveis.";
  if (message.includes("unique") || message.includes("duplicate")) return "Já existe uma conta com esse e-mail.";
  if (message.includes("cannot_deactivate_self")) return "Você não pode desativar a própria conta.";
  if (message.includes("cannot_change_own_role")) return "Você não pode remover o próprio perfil de administrador.";
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
      message: `Conta criada para ${result.user.displayName}. Copie a senha agora.`,
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
    return { error: null, message: "Conta e acesso atualizados.", temporaryPassword: null };
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
