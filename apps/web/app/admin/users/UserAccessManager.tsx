"use client";

import { useActionState, useState } from "react";
import type { ManagedUser, ScopeOption } from "@igd/db";
import type { Role } from "@igd/auth";
import { createUserAction, resetPasswordAction, toggleUserAction, updateUserAction, type AccessActionState } from "./actions";
import { accessProfileContent, accessProfileOrder, hasCompatibleLegacyScope, requiresPersonLink } from "./accessProfiles";

const emptyAccessState: AccessActionState = { error: null, message: null, temporaryPassword: null };

const lastLoginFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function ResultMessage({ state }: { state: AccessActionState }) {
  return <>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.message ? <p className="form-success" role="status">{state.message}</p> : null}{state.temporaryPassword ? <div className="temporary-password" role="status"><strong>Senha temporária — exibida somente agora</strong><code>{state.temporaryPassword}</code></div> : null}</>;
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  const profile = accessProfileContent[value];
  return <label>Perfil de acesso<select name="role" value={value} onChange={(event) => onChange(event.target.value as Role)}>{accessProfileOrder.map((role) => <option key={role} value={role}>{accessProfileContent[role].label}</option>)}</select><span className="field-help">{profile.description}</span></label>;
}

function PersonSelect({ people, value, required, onChange }: { people: ScopeOption[]; value: string; required: boolean; onChange: (personId: string) => void }) {
  return <label>Pessoa vinculada<select name="personId" value={value} required={required} onChange={(event) => onChange(event.target.value)}><option value="">Sem vínculo</option>{people.map((person) => <option key={person.id} value={person.id}>{person.code} · {person.label}</option>)}</select><span className="field-help">Identidade usada para calcular o acesso à organização.</span></label>;
}

function EffectiveScope({ user, teams, products, pendingRecalculation = false }: { user: ManagedUser; teams: ScopeOption[]; products: ScopeOption[]; pendingRecalculation?: boolean }) {
  const teamNames = user.teamIds.map((id) => teams.find((team) => team.id === id)?.label ?? id);
  const productNames = user.productKeys.map((key) => products.find((product) => product.id === key)?.label ?? key);
  const hasSelf = user.personIds.length > 0;
  const organizationAccess = [
    ...productNames.map((product) => `Produtos: ${product}`),
    ...teamNames.map((team) => `Times: ${team}`),
    ...(hasSelf ? ["Dados da própria pessoa"] : []),
  ];
  const coverage = pendingRecalculation && user.role !== "ADMIN" && user.role !== "SALES_OPS"
    ? "Será recalculada pela organização após salvar"
    : user.role === "ADMIN"
    ? "Toda a operação comercial, com gestão de contas"
    : user.role === "SALES_OPS"
      ? "Toda a operação comercial, somente para consulta"
      : organizationAccess.join(" · ") || "Nenhum acesso derivado da organização";
  return <div className="scope-review"><strong>Perfil de acesso:</strong> {accessProfileContent[user.role].label}.<br /><strong>Abrangência:</strong> {coverage}.</div>;
}

function CreateUser({ people, readOnly }: { people: ScopeOption[]; readOnly: boolean }) {
  const [role, setRole] = useState<Role>("USER");
  const [personId, setPersonId] = useState("");
  const [state, action, pending] = useActionState(createUserAction, emptyAccessState);
  if (readOnly) return <section className="panel"><p className="eyebrow">Visualização ativa</p><h2>Gestão de acessos somente para consulta</h2><p>Criação, alteração, senha temporária e desativação ficam bloqueadas durante a visualização.</p></section>;
  return <form action={action} className="access-form panel"><div className="section-title"><div><p className="eyebrow">Nova conta</p><h2>Criar conta</h2></div></div><div className="form-grid"><label>Nome<input name="displayName" required /></label><label>E-mail<input name="email" type="email" required /></label><RoleSelect value={role} onChange={setRole} /><PersonSelect people={people} value={personId} required={requiresPersonLink(role)} onChange={setPersonId} /></div><p className="scope-review">O acesso a produtos, frentes e times é calculado a partir da Pessoa vinculada. Não é necessário preencher permissões manualmente. O perfil Administrador da Plataforma não está disponível nesta área comercial.</p><ResultMessage state={state} /><button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar conta e gerar senha temporária"}</button></form>;
}

function ManagedUserCard({ user, people, teams, products, readOnly }: { user: ManagedUser; people: ScopeOption[]; teams: ScopeOption[]; products: ScopeOption[]; readOnly: boolean }) {
  const [role, setRole] = useState<Role>(user.role);
  const [personId, setPersonId] = useState(user.personId ?? "");
  const [updateState, updateAction, updating] = useActionState(updateUserAction, emptyAccessState);
  const [toggleState, toggleAction, toggling] = useActionState(toggleUserAction, emptyAccessState);
  const [resetState, resetAction, resetting] = useActionState(resetPasswordAction, emptyAccessState);
  const linked = people.find((person) => person.id === user.personId);
  if (readOnly || user.role === "PLATFORM_ADMIN") return <article className="panel user-card"><div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `Pessoa vinculada: ${linked.code} · ${linked.label}` : "Sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Conta ativa" : "Conta inativa"}</span></div><EffectiveScope user={user} teams={teams} products={products} /><p className="scope-review">{user.role === "PLATFORM_ADMIN" ? "Privilégio protegido por configuração interna; esta área comercial não concede nem remove esse acesso." : "A visualização está ativa. As alterações desta conta estão bloqueadas."}</p></article>;
  const personChanged = personId !== (user.personId ?? "");
  const keepLegacyTeams = !personId && !user.personId && role === "LEADER";
  const keepLegacyProducts = !personId && !user.personId && role === "SUPERVISOR";
  const hasLegacyScope = !personId && !user.personId && hasCompatibleLegacyScope(role, user.teamIds, user.productKeys);
  const personRequired = requiresPersonLink(role) && !hasLegacyScope;
  const scopePreviewUser = personId
    ? { ...user, role }
    : { ...user, role, teamIds: keepLegacyTeams ? user.teamIds : [], productKeys: keepLegacyProducts ? user.productKeys : [] };
  return <article className="panel user-card"><div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `Pessoa vinculada: ${linked.code} · ${linked.label}` : "Sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Conta ativa" : "Conta inativa"}</span></div><form action={updateAction} className="access-form compact"><input type="hidden" name="userId" value={user.id} />{keepLegacyTeams ? user.teamIds.map((id) => <input key={id} type="hidden" name="teamIds" value={id} />) : null}{keepLegacyProducts ? user.productKeys.map((key) => <input key={key} type="hidden" name="productKeys" value={key} />) : null}<div className="form-grid"><label>Nome<input name="displayName" defaultValue={user.displayName} required /></label><label>E-mail<input name="email" type="email" defaultValue={user.email} required /></label><RoleSelect value={role} onChange={setRole} /><PersonSelect people={people} value={personId} required={personRequired} onChange={setPersonId} /></div><EffectiveScope user={scopePreviewUser} teams={teams} products={products} pendingRecalculation={personChanged} /><ResultMessage state={updateState} /><button type="submit" disabled={updating}>{updating ? "Salvando…" : "Salvar alterações"}</button></form><div className="access-actions"><form action={toggleAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={String(!user.active)} /><button className="secondary" type="submit" disabled={toggling}>{user.active ? "Desativar conta" : "Reativar conta"}</button></form><form action={resetAction}><input type="hidden" name="userId" value={user.id} /><button className="secondary" type="submit" disabled={resetting}>Gerar nova senha temporária</button></form></div><ResultMessage state={toggleState} /><ResultMessage state={resetState} /><small>Último acesso: {user.lastLoginAt ? lastLoginFormatter.format(new Date(user.lastLoginAt)) : "nunca"}</small></article>;
}

export function UserAccessManager({ users, teams, products, people, readOnly = false }: { users: ManagedUser[]; teams: ScopeOption[]; products: ScopeOption[]; people: ScopeOption[]; readOnly?: boolean }) {
  return <><CreateUser people={people} readOnly={readOnly} /><section className="user-list">{users.map((user) => <ManagedUserCard key={user.id} user={user} people={people} teams={teams} products={products} readOnly={readOnly} />)}</section></>;
}
