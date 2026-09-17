import type { AuthorizationContext, SelectedOrganizationScope } from "@igd/auth";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function key(value: string): string | undefined {
  const normalized = value.toLowerCase();
  return /^[a-z0-9-]{1,120}$/.test(normalized) ? normalized : undefined;
}

function id(value: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

export function parseOrganizationSelection(params: SearchParams): SelectedOrganizationScope {
  const productKey = key(first(params.product));
  const frontKey = key(first(params.front));
  const teamId = id(first(params.team));
  const personId = id(first(params.person));
  return {
    ...(productKey ? { productKey } : {}),
    ...(frontKey ? { frontKey } : {}),
    ...(teamId ? { teamId } : {}),
    ...(personId ? { personId } : {}),
  };
}

export function parseOrganizationAsOf(params: SearchParams): { date: Date; start: Date | undefined; value: string | undefined } {
  const value = first(params.at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: new Date(),start: undefined,value: undefined };
  const start = new Date(`${value}T00:00:00.000-03:00`);
  const date = new Date(`${value}T23:59:59.999-03:00`);
  return Number.isNaN(date.getTime()) || Number.isNaN(start.getTime())
    ? { date: new Date(),start: undefined,value: undefined }
    : { date,start,value };
}

export function defaultOrganizationSelection(context: AuthorizationContext): SelectedOrganizationScope {
  if (context.scope.kind === "GLOBAL") return {};
  if (context.scope.kind === "PRODUCTS") return context.scope.productKeys.length === 1 ? { productKey: context.scope.productKeys[0] } : {};
  if (context.scope.kind === "TEAMS") return context.scope.teamIds.length === 1 ? { teamId: context.scope.teamIds[0] } : {};
  if (context.scope.productKeys.length > 0 && context.scope.teamIds.length > 0) return {};
  if (context.scope.productKeys.length === 1) return { productKey: context.scope.productKeys[0] };
  if (context.scope.productKeys.length > 1) return {};
  if (context.scope.teamIds.length === 1) return { teamId: context.scope.teamIds[0] };
  if (context.scope.teamIds.length > 1) return {};
  if (context.scope.personIds.length === 1) return { personId: context.scope.personIds[0] };
  return {};
}

export function scopeHref(pathname: string, selected: SelectedOrganizationScope, additional: Record<string, string | number | undefined> = {}): string {
  const query = new URLSearchParams();
  if (selected.productKey) query.set("product", selected.productKey);
  if (selected.frontKey) query.set("front", selected.frontKey);
  if (selected.teamId) query.set("team", selected.teamId);
  if (selected.personId) query.set("person", selected.personId);
  for (const [name, value] of Object.entries(additional)) if (value !== undefined) query.set(name, String(value));
  const encoded = query.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}
