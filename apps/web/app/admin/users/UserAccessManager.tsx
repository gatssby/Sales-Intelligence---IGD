"use client";

import { useActionState, useState } from "react";
import type { ManagedUser, ScopeOption } from "@igd/db";
import type { Role } from "@igd/auth";
import { createUserAction, resetPasswordAction, toggleUserAction, updateUserAction, type AccessActionState } from "./actions";

const emptyAccessState: AccessActionState = { error: null, message: null, temporaryPassword: null };
const roleLabels: Record<Role, string> = {
  ADMIN: "Admin do sistema", USER: "Usuário vinculado", LEADER: "Leader legado",
  SUPERVISOR: "Supervisor legado", SALES_OPS: "Sales Ops",
};

function ResultMessage({ state }: { state: AccessActionState }) {
  return <>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.message ? <p className="form-success" role="status">{state.message}</p> : null}{state.temporaryPassword ? <div className="temporary-password" role="status"><strong>Senha temporária — exibida somente agora</strong><code>{state.temporaryPassword}</code></div> : null}</>;
}

function RoleSelect({ value, onChange, includeLegacy = true }: { value: Role; onChange: (role: Role) => void; includeLegacy?: boolean }) {
  const options = (Object.keys(roleLabels) as Role[]).filter((role) => includeLegacy || !["LEADER", "SUPERVISOR"].includes(role));
  return <label>Papel de sistema<select name="role" value={value} onChange={(event) => onChange(event.target.value as Role)}>{options.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>;
}

function PersonSelect({ people, value, required }: { people: ScopeOption[]; value?: string | null; required: boolean }) {
  return <label>Pessoa vinculada<select name="personId" defaultValue={value ?? ""} required={required}><option value="">Sem vínculo</option>{people.map((person) => <option key={person.id} value={person.id}>{person.code} · {person.label}</option>)}</select></label>;
}

function EffectiveScope({ user, teams, products }: { user: ManagedUser; teams: ScopeOption[]; products: ScopeOption[] }) {
  const teamNames = user.teamIds.map((id) => teams.find((team) => team.id === id)?.label ?? id);
  const productNames = user.productKeys.map((key) => products.find((product) => product.id === key)?.label ?? key);
  const hasSelf = user.personIds.length > 0;
  const roles = [...productNames.map((product) => `Supervisor: ${product}`), ...teamNames.map((team) => `Líder: ${team}`), ...(hasSelf ? ["Pessoa: self"] : [])];
  return <div className="scope-review"><strong>Papel organizacional calculado:</strong> {user.role === "ADMIN" ? "Admin sempre global" : roles.join(" · ") || "Sem escopo derivado"}.<br /><strong>Effective scope:</strong> {user.role === "ADMIN" || user.role === "SALES_OPS" ? "IGD inteira" : [...productNames, ...teamNames, ...(hasSelf ? ["própria pessoa"] : [])].join(" ∪ ") || "nenhum"}.</div>;
}

function CreateUser({ people }: { people: ScopeOption[] }) {
  const [role, setRole] = useState<Role>("USER");
  const [state, action, pending] = useActionState(createUserAction, emptyAccessState);
  return <form action={action} className="access-form panel"><div className="section-title"><div><p className="eyebrow">Novo acesso</p><h2>Criar conta vinculada</h2></div></div><div className="form-grid"><label>Nome<input name="displayName" required /></label><label>E-mail<input name="email" type="email" required /></label><RoleSelect value={role} onChange={setRole} includeLegacy={false} /><PersonSelect people={people} required={role === "USER"} /></div><p className="scope-review">Produto, frente, time, liderança e supervisão são derivados da organização publicada. A planilha nunca concede Admin.</p><ResultMessage state={state} /><button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar e emitir senha temporária"}</button></form>;
}

function ManagedUserCard({ user, people, teams, products }: { user: ManagedUser; people: ScopeOption[]; teams: ScopeOption[]; products: ScopeOption[] }) {
  const [role, setRole] = useState<Role>(user.role);
  const [updateState, updateAction, updating] = useActionState(updateUserAction, emptyAccessState);
  const [toggleState, toggleAction, toggling] = useActionState(toggleUserAction, emptyAccessState);
  const [resetState, resetAction, resetting] = useActionState(resetPasswordAction, emptyAccessState);
  const linked = people.find((person) => person.id === user.personId);
  return <article className="panel user-card"><div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `${linked.code} ${linked.label}` : "sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Ativo" : "Inativo"}</span></div><form action={updateAction} className="access-form compact"><input type="hidden" name="userId" value={user.id} />{!user.personId ? user.teamIds.map((id) => <input key={id} type="hidden" name="teamIds" value={id} />) : null}{!user.personId ? user.productKeys.map((key) => <input key={key} type="hidden" name="productKeys" value={key} />) : null}<div className="form-grid"><label>Nome<input name="displayName" defaultValue={user.displayName} required /></label><label>E-mail<input name="email" type="email" defaultValue={user.email} required /></label><RoleSelect value={role} onChange={setRole} /><PersonSelect people={people} value={user.personId} required={role === "USER"} /></div><EffectiveScope user={user} teams={teams} products={products} /><ResultMessage state={updateState} /><button type="submit" disabled={updating}>{updating ? "Salvando…" : "Salvar conta e vínculo"}</button></form><div className="access-actions"><form action={toggleAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={String(!user.active)} /><button className="secondary" type="submit" disabled={toggling}>{user.active ? "Desativar conta" : "Reativar conta"}</button></form><form action={resetAction}><input type="hidden" name="userId" value={user.id} /><button className="secondary" type="submit" disabled={resetting}>Emitir nova senha temporária</button></form></div><ResultMessage state={toggleState} /><ResultMessage state={resetState} /><small>Último login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("pt-BR") : "nunca"}</small></article>;
}

export function UserAccessManager({ users, teams, products, people }: { users: ManagedUser[]; teams: ScopeOption[]; products: ScopeOption[]; people: ScopeOption[] }) {
  return <><CreateUser people={people} /><section className="user-list">{users.map((user) => <ManagedUserCard key={user.id} user={user} people={people} teams={teams} products={products} />)}</section></>;
}
