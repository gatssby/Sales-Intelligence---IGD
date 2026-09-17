import type { AccessRole } from "@igd/auth";

export const accessRoleLabels: Readonly<Record<AccessRole, string>> = {
  PLATFORM_ADMIN: "Administrador da Plataforma",
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  LEADER: "Líder",
  LEADER_IN_TRAINING: "Líder em treinamento",
  CLOSER: "Closer",
  SDR: "SDR",
  USER: "Pessoa sem cargo calculado",
  SALES_OPS: "Acesso anterior sem vínculo",
};

export function accessRoleLabel(role: AccessRole): string {
  return accessRoleLabels[role];
}
