export const roles = ["ADMIN", "LEADER", "SUPERVISOR", "SALES_OPS"] as const;
export type Role = (typeof roles)[number];

export const capabilities = [
  "users:manage",
  "settings:manage",
  "calls:read",
  "analytics:read",
  "spend:execute",
] as const;
export type Capability = (typeof capabilities)[number];

export type DataScope =
  | { kind: "GLOBAL" }
  | { kind: "TEAMS"; teamIds: readonly string[] }
  | { kind: "PRODUCTS"; productKeys: readonly string[] };

export type AuthorizationContext = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  capabilities: ReadonlySet<Capability>;
  scope: DataScope;
  mustChangePassword: boolean;
};

const roleCapabilities: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  ADMIN: new Set(capabilities),
  LEADER: new Set(["calls:read", "analytics:read"]),
  SUPERVISOR: new Set(["calls:read", "analytics:read"]),
  SALES_OPS: new Set(["calls:read", "analytics:read"]),
};

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
  mustChangePassword?: boolean;
}): AuthorizationContext {
  const teamIds = [...new Set(input.teamIds ?? [])];
  const productKeys = [...new Set((input.productKeys ?? []).map((key) => key.trim().toLowerCase()))];
  const scope: DataScope =
    input.role === "LEADER"
      ? { kind: "TEAMS", teamIds }
      : input.role === "SUPERVISOR"
        ? { kind: "PRODUCTS", productKeys }
        : { kind: "GLOBAL" };

  return {
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    capabilities: capabilitiesForRole(input.role),
    scope,
    mustChangePassword: input.mustChangePassword ?? false,
  };
}

export function hasCapability(context: AuthorizationContext, capability: Capability): boolean {
  return context.capabilities.has(capability);
}

export function assertCapability(context: AuthorizationContext, capability: Capability): void {
  if (!hasCapability(context, capability)) throw new AuthorizationError(capability);
}

export async function executeSpendGuarded<T>(
  context: AuthorizationContext,
  operations: { onDenied: () => Promise<void> | void; execute: () => Promise<T> | T },
): Promise<{ allowed: false } | { allowed: true; value: T }> {
  if (!hasCapability(context, "spend:execute")) {
    await operations.onDenied();
    return { allowed: false };
  }
  return { allowed: true, value: await operations.execute() };
}

export function canAccessData(
  context: AuthorizationContext,
  resource: { teamId?: string | null; productKey: string },
): boolean {
  if (context.scope.kind === "GLOBAL") return true;
  if (context.scope.kind === "TEAMS") {
    return Boolean(resource.teamId && context.scope.teamIds.includes(resource.teamId));
  }
  return context.scope.productKeys.includes(resource.productKey.trim().toLowerCase());
}

export function validateRoleScopes(input: {
  role: Role;
  teamIds?: readonly string[];
  productKeys?: readonly string[];
}): void {
  const teamCount = new Set(input.teamIds ?? []).size;
  const productCount = new Set(input.productKeys ?? []).size;
  if (input.role === "LEADER" && (teamCount === 0 || productCount > 0)) {
    throw new Error("leader_requires_one_or_more_teams_only");
  }
  if (input.role === "SUPERVISOR" && (productCount === 0 || teamCount > 0)) {
    throw new Error("supervisor_requires_one_or_more_products_only");
  }
  if ((input.role === "ADMIN" || input.role === "SALES_OPS") && (teamCount > 0 || productCount > 0)) {
    throw new Error("global_role_cannot_have_scopes");
  }
}

export function isRole(value: string): value is Role {
  return roles.includes(value as Role);
}
