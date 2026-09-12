export const organizationalAccessRoles = ["CLOSER", "SDR", "LEADER", "LEADER_IN_TRAINING", "SUPERVISOR", "ADMIN"] as const;
export type OrganizationalAccessRole = (typeof organizationalAccessRoles)[number];
export const manualAccessRoles = organizationalAccessRoles;
export type ManualAccessRole = OrganizationalAccessRole;

export const roles = ["PLATFORM_ADMIN", "ORGANIZATION", ...manualAccessRoles, "USER", "SALES_OPS"] as const;
export type Role = (typeof roles)[number];

export const accessOrigins = ["ORGANIZATION", "MANUAL", "SYSTEM", "REVIEW"] as const;
export type AccessOrigin = (typeof accessOrigins)[number];
export type AccessRole = "PLATFORM_ADMIN" | OrganizationalAccessRole | "USER" | "SALES_OPS";

export const previewRoles = ["ADMIN", "SUPERVISOR", "LEADER", "LEADER_IN_TRAINING", "CLOSER", "SDR"] as const;
export type PreviewRole = (typeof previewRoles)[number];

export const capabilities = [
  "users:manage",
  "settings:manage",
  "calls:read",
  "analytics:read",
  "spend:execute",
  "platform:observe",
  "platform:operate",
  "preview:use",
] as const;
export type Capability = (typeof capabilities)[number];

export type DataScope =
  | { kind: "GLOBAL" }
  | { kind: "TEAMS"; teamIds: readonly string[] }
  | { kind: "PRODUCTS"; productKeys: readonly string[] }
  | { kind: "ORGANIZATION"; teamIds: readonly string[]; productKeys: readonly string[]; personIds: readonly string[] };

export type SelectedOrganizationScope = {
  productKey?: string | null;
  frontKey?: string | null;
  teamId?: string | null;
  personId?: string | null;
};

export type PreviewMode = {
  kind: PreviewRole;
  subjectPersonId: string | null;
  subjectUserId: string | null;
  subjectCode: string | null;
  subjectDisplayName: string;
  readOnly: true;
};

export type AuthorizationContext = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  accessRole: AccessRole;
  capabilities: ReadonlySet<Capability>;
  scope: DataScope;
  mustChangePassword: boolean;
  preview: PreviewMode | null;
};

const readCapabilities = new Set<Capability>(["calls:read", "analytics:read"]);
const commercialAdminCapabilities = new Set<Capability>(["users:manage", "settings:manage", "calls:read", "analytics:read"]);

function capabilitiesForAccess(role: AccessRole): ReadonlySet<Capability> {
  if (role === "PLATFORM_ADMIN") return new Set(capabilities);
  if (role === "ADMIN") return new Set(commercialAdminCapabilities);
  return new Set(readCapabilities);
}

function scopeForAccess(input: {
  role: AccessRole;
  teamIds: readonly string[];
  productKeys: readonly string[];
  personIds: readonly string[];
}): DataScope {
  if (input.role === "PLATFORM_ADMIN" || input.role === "ADMIN" || input.role === "SALES_OPS") return { kind: "GLOBAL" };
  if (input.role === "LEADER" || input.role === "LEADER_IN_TRAINING") return { kind: "TEAMS", teamIds: input.teamIds };
  if (input.role === "SUPERVISOR") return { kind: "PRODUCTS", productKeys: input.productKeys };
  return { kind: "ORGANIZATION", teamIds: [], productKeys: [], personIds: input.personIds };
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(readonly capability?: Capability) {
    super("forbidden");
  }
}

export function capabilitiesForRole(role: Role, accessRole?: AccessRole): ReadonlySet<Capability> {
  if (role === "PLATFORM_ADMIN") return new Set(capabilities);
  return capabilitiesForAccess(accessRole ?? (role === "ORGANIZATION" ? "USER" : role));
}

export function buildAuthorizationContext(input: {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  accessRole?: AccessRole;
  teamIds?: readonly string[];
  productKeys?: readonly string[];
  personIds?: readonly string[];
  mustChangePassword?: boolean;
}): AuthorizationContext {
  const teamIds = [...new Set(input.teamIds ?? [])];
  const productKeys = [...new Set((input.productKeys ?? []).map((key) => key.trim().toLowerCase()))];
  const personIds = [...new Set(input.personIds ?? [])];
  const accessRole = input.role === "PLATFORM_ADMIN"
    ? "PLATFORM_ADMIN"
    : input.accessRole ?? (input.role === "ORGANIZATION" ? "USER" : input.role);

  return {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    accessRole,
    capabilities: capabilitiesForRole(input.role, accessRole),
    scope: scopeForAccess({ role: accessRole, teamIds, productKeys, personIds }),
    mustChangePassword: input.mustChangePassword ?? false,
    preview: null,
  };
}

export function buildPreviewAuthorizationContext(
  actor: AuthorizationContext,
  input: {
    kind: PreviewRole;
    subjectPersonId: string | null;
    subjectUserId?: string | null;
    subjectCode: string | null;
    subjectDisplayName: string;
    teamIds?: readonly string[];
    productKeys?: readonly string[];
    personIds?: readonly string[];
  },
): AuthorizationContext {
  if (actor.role !== "PLATFORM_ADMIN") throw new AuthorizationError("preview:use");
  const teamIds = [...new Set(input.teamIds ?? [])];
  const productKeys = [...new Set((input.productKeys ?? []).map((key) => key.trim().toLowerCase()))];
  const personIds = [...new Set(input.personIds ?? [])];
  return {
    ...actor,
    accessRole: input.kind,
    capabilities: capabilitiesForAccess(input.kind),
    scope: scopeForAccess({ role: input.kind, teamIds, productKeys, personIds }),
    preview: {
      kind: input.kind,
      subjectPersonId: input.subjectPersonId,
      subjectUserId: input.subjectUserId ?? null,
      subjectCode: input.subjectCode,
      subjectDisplayName: input.subjectDisplayName,
      readOnly: true,
    },
  };
}

export function buildDevelopmentAuthBypass(input: {
  nodeEnv: string | undefined;
  enabled: string | undefined;
}): AuthorizationContext | null {
  if (input.nodeEnv !== "development" || input.enabled !== "true") return null;
  return buildAuthorizationContext({
    userId: "dev-auth-bypass",
    email: "dev-auth-bypass@example.invalid",
    displayName: "Administrador local",
    role: "ADMIN",
  });
}

export function hasCapability(context: AuthorizationContext, capability: Capability): boolean {
  return context.capabilities.has(capability);
}

export function assertCapability(context: AuthorizationContext, capability: Capability): void {
  if (!hasCapability(context, capability)) throw new AuthorizationError(capability);
}

export function assertMutationAllowed(context: AuthorizationContext): void {
  if (context.preview) throw new Error("preview_read_only");
}

export function isPreviewRole(value: string): value is PreviewRole {
  return previewRoles.includes(value as PreviewRole);
}

export async function executeSpendGuarded<T>(
  context: AuthorizationContext,
  operations: { onDenied: () => Promise<void> | void; execute: () => Promise<T> | T },
): Promise<{ allowed: false } | { allowed: true; value: T }> {
  if (context.preview || !hasCapability(context, "spend:execute")) {
    await operations.onDenied();
    return { allowed: false };
  }
  return { allowed: true, value: await operations.execute() };
}

export function canAccessData(
  context: AuthorizationContext,
  resource: { teamId?: string | null; productKey: string; personId?: string | null },
): boolean {
  if (context.scope.kind === "GLOBAL") return true;
  if (context.scope.kind === "TEAMS") return Boolean(resource.teamId && context.scope.teamIds.includes(resource.teamId));
  if (context.scope.kind === "PRODUCTS") return context.scope.productKeys.includes(resource.productKey.trim().toLowerCase());
  return Boolean(resource.personId && context.scope.personIds.includes(resource.personId));
}

export function validateRoleScopes(input: {
  role: Role;
  personId?: string | null;
  teamIds?: readonly string[];
  productKeys?: readonly string[];
}): void {
  const teamCount = new Set(input.teamIds ?? []).size;
  const productCount = new Set(input.productKeys ?? []).size;
  if (input.role === "PLATFORM_ADMIN") throw new Error("platform_admin_requires_internal_grant");
  if (input.role === "ORGANIZATION") {
    if (!input.personId) throw new Error("organization_account_requires_person_link");
    if (teamCount > 0 || productCount > 0) throw new Error("organization_scope_is_derived_from_person");
    return;
  }
  if (input.role === "CLOSER" || input.role === "SDR") {
    if (!input.personId) throw new Error("manual_self_role_requires_person");
    if (teamCount > 0 || productCount > 0) throw new Error("manual_self_scope_is_person_only");
    return;
  }
  if (input.role === "LEADER" || input.role === "LEADER_IN_TRAINING") {
    if (input.personId || teamCount === 0 || productCount > 0) throw new Error("leader_requires_one_or_more_teams_only");
    return;
  }
  if (input.role === "SUPERVISOR") {
    if (input.personId || productCount !== 1 || teamCount > 0) throw new Error("supervisor_requires_exactly_one_product_only");
    return;
  }
  if (input.role === "ADMIN" || input.role === "SALES_OPS") {
    if (input.personId || teamCount > 0 || productCount > 0) throw new Error("global_role_cannot_have_scopes");
    return;
  }
  if (input.role === "USER" && (teamCount > 0 || productCount > 0)) throw new Error("user_scope_is_derived_from_person");
}

export function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}

export function isAccessOrigin(value: string): value is AccessOrigin {
  return accessOrigins.includes(value as AccessOrigin);
}

export function isAccessRole(value: string): value is AccessRole {
  return value === "PLATFORM_ADMIN" || value === "USER" || value === "SALES_OPS"
    || organizationalAccessRoles.includes(value as OrganizationalAccessRole);
}
