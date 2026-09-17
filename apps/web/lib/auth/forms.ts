import { isRole, type Role } from "@igd/auth";

export type UserFormInput = {
  email: string;
  displayName: string;
  role: Role;
  personId: string | null;
  teamIds: string[];
  productKeys: string[];
  createManualPerson: boolean;
};

export function parseUserForm(formData: FormData): UserFormInput {
  const roleValue = String(formData.get("role") ?? "");
  if (!isRole(roleValue)) throw new Error("invalid_role");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const rawPersonId = String(formData.get("personId") ?? "").trim();
  if (!email || !email.includes("@") || !displayName) throw new Error("invalid_user_fields");
  return {
    email,
    displayName,
    role: roleValue,
    personId: rawPersonId && rawPersonId !== "__create__" ? rawPersonId : null,
    teamIds: formData.getAll("teamIds").map(String),
    productKeys: formData.getAll("productKeys").map(String),
    createManualPerson: String(formData.get("createManualPerson") ?? "") === "true",
  };
}
