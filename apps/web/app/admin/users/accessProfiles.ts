import type { Role } from "@igd/auth";

export type AccessProfileContent = {
  label: string;
  description: string;
};

export const accessProfileOrder = ["ADMIN", "SUPERVISOR", "LEADER", "USER", "SALES_OPS"] as const satisfies readonly Role[];

export const accessProfileContent: Readonly<Record<Role, AccessProfileContent>> = {
  ADMIN: {
    label: "Administrador",
    description: "Acesso à operação comercial completa e à gestão de contas.",
  },
  SUPERVISOR: {
    label: "Supervisor",
    description: "Acesso de leitura derivado da pessoa vinculada, incluindo os produtos sob sua supervisão.",
  },
  LEADER: {
    label: "Líder",
    description: "Acesso de leitura derivado da pessoa vinculada, incluindo os times sob sua liderança.",
  },
  USER: {
    label: "Pessoa",
    description: "Acesso de leitura derivado da pessoa vinculada, incluindo os próprios dados e calls.",
  },
  SALES_OPS: {
    label: "Operações comerciais",
    description: "Acesso global de leitura aos dados comerciais, sem gestão de contas.",
  },
};

export function requiresPersonLink(role: Role): boolean {
  return role === "USER" || role === "LEADER" || role === "SUPERVISOR";
}

export function hasCompatibleLegacyScope(role: Role, teamIds: readonly string[], productKeys: readonly string[]): boolean {
  return role === "LEADER" && teamIds.length > 0
    || role === "SUPERVISOR" && productKeys.length > 0;
}
