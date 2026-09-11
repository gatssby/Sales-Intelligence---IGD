export const roles = ["PLATFORM_ADMIN", "ADMIN", "USER", "LEADER", "SUPERVISOR", "SALES_OPS"] as const;
export type Role = (typeof roles)[number];

export const previewRoles = ["ADMIN", "SUPERVISOR", "LEADER", "PERSON"] as const;
export type PreviewRole = (typeof previewRoles)[number];
export type AccessRole = Role | "PERSON";

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

export type PreviewMode = {
  kind: PreviewRole;
  subjectPersonId: string | null;
  subjectCode: string | null;
  subjectDisplayName: string;
  readOnly: true;
};

const roleCapabilities: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  PLATFORM_ADMIN: new Set(capabilities),
  ADMIN: new Set(["users:manage", "settings:manage", "calls:read", "analytics:read", "spend:execute"]),
  USER: new Set(["calls:read", "analytics:read"]),
  LEADER: new Set(["calls:read", "analytics:read"]),
  SUPERVISOR: new Set(["calls:read", "analytics:read"]),
  SALES_OPS: new Set(["calls:read", "analytics:read"]),
};

const commercialAdminCapabilities = new Set<Capability>([
  "users:manage",
  "settings:manage",
  "calls:read",
  "analytics:read",
  "spend:execute",
]);

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(readonly capability?: Capability) {
    super("forbidden");
  }
}

export function capabilitiesForRole(role: Role): ReadonlySet<Capability> {
  return new Set(roleCapabilities[role]);
}

export function buildAuthorizationContext(input: {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  teamIds?: readonly string[];
  productKeys?: readonly string[];
  personIds?: readonly string[];
  mustChangePassword?: boolean;
}): AuthorizationContext {
  const teamIds = [...new Set(input.teamIds ?? [])];
  const productKeys = [...new Set((input.productKeys ?? []).map((key) => key.trim().toLowerCase()))];
  const personIds = [...new Set(input.personIds ?? [])];
  const scope: DataScope =
    input.role === "PLATFORM_ADMIN" || input.role === "ADMIN" || input.role === "SALES_OPS"
      ? { kind: "GLOBAL" }
      : input.role === "LEADER" && personIds.length === 0 && productKeys.length === 0
      ? { kind: "TEAMS", teamIds }
      : input.role === "SUPERVISOR" && personIds.length === 0 && teamIds.length === 0
        ? { kind: "PRODUCTS", productKeys }
        : { kind: "ORGANIZATION", teamIds, productKeys, personIds };

  return {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    accessRole: input.role === "USER" ? "PERSON" : input.role,
    capabilities: capabilitiesForRole(input.role),
    scope,
    mustChangePassword: input.mustChangePassword ?? false,
    preview: null,
  };
}

export function buildPreviewAuthorizationContext(
  actor: AuthorizationContext,
  input: {
    kind: PreviewRole;
    subjectPersonId: string | null;
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
  const isAdminPreview = input.kind === "ADMIN";

  return {
    ...actor,
    accessRole: input.kind,
    capabilities: isAdminPreview
      ? new Set(commercialAdminCapabilities)
      : new Set<Capability>(["calls:read", "analytics:read"]),
    scope: isAdminPreview ? { kind: "GLOBAL" } : { kind: "ORGANIZATION", teamIds, productKeys, personIds },
    preview: {
      kind: input.kind,
      subjectPersonId: input.subjectPersonId,
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
  if (input.nodeEnv === "production" || input.enabled !== "true") return null;

  const context = buildAuthorizationContext({
    userId: "dev-auth-bypass",
    email: "dev-auth-bypass@example.invalid",
    displayName: "Local Development Admin",
    role: "ADMIN",
  });

  return {
    ...context,
    capabilities: new Set([...context.capabilities].filter((capability) => capability !== "spend:execute")),
  };
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
  if (context.scope.kind === "TEAMS") {
    return Boolean(resource.teamId && context.scope.teamIds.includes(resource.teamId));
  }
  if (context.scope.kind === "PRODUCTS") return context.scope.productKeys.includes(resource.productKey.trim().toLowerCase());
  return context.scope.productKeys.includes(resource.productKey.trim().toLowerCase())
    || Boolean(resource.teamId && context.scope.teamIds.includes(resource.teamId))
    || Boolean(resource.personId && context.scope.personIds.includes(resource.personId));
}

export function validateRoleScopes(input: {
  role: Role;
  personId?: string | null;
  teamIds?: readonly string[];
  productKeys?: readonly string[];
}): void {
  const teamCount = new Set(input.teamIds ?? []).size;
  const productCount = new Set(input.productKeys ?? []).size;
  if (input.personId) return;
  if (input.role === "LEADER" && (teamCount === 0 || productCount > 0)) {
    throw new Error("leader_requires_one_or_more_teams_only");
  }
  if (input.role === "SUPERVISOR" && (productCount === 0 || teamCount > 0)) {
    throw new Error("supervisor_requires_one_or_more_products_only");
  }
  if ((input.role === "PLATFORM_ADMIN" || input.role === "ADMIN" || input.role === "SALES_OPS") && (teamCount > 0 || productCount > 0)) {
    throw new Error("global_role_cannot_have_scopes");
  }
  if (input.role === "USER" && (teamCount > 0 || productCount > 0)) throw new Error("user_scope_is_derived_from_person");
}

export function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}
