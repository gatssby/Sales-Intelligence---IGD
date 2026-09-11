import { isRole, type Role } from "@igd/auth";

export type UserFormInput = {
  email: string;
  displayName: string;
  role: Role;
  personId: string | null;
  teamIds: string[];
  productKeys: string[];
};

export function parseUserForm(formData: FormData): UserFormInput {
  const roleValue = String(formData.get("role") ?? "");
  if (!isRole(roleValue)) throw new Error("invalid_role");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!email || !email.includes("@") || !displayName) throw new Error("invalid_user_fields");
  return {
    email,
    displayName,
    role: roleValue,
    personId: String(formData.get("personId") ?? "").trim() || null,
    teamIds: formData.getAll("teamIds").map(String),
    productKeys: formData.getAll("productKeys").map(String),
  };
}
