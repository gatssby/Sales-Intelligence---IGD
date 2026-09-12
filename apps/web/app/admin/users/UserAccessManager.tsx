"use client";

import { useActionState, useState } from "react";
import type { ManagedUser, ScopeOption } from "@igd/db";
import { createUserAction, resetPasswordAction, toggleUserAction, updateUserAction, type AccessActionState } from "./actions";
import { accessRoleLabel } from "./accessProfiles";

const emptyAccessState: AccessActionState = { error: null, message: null, temporaryPassword: null };
const lastLoginFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function ResultMessage({ state }: { state: AccessActionState }) {
  return <>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.message ? <p className="form-success" role="status">{state.message}</p> : null}{state.temporaryPassword ? <div className="temporary-password" role="status"><strong>Senha temporária — exibida somente agora</strong><code>{state.temporaryPassword}</code></div> : null}</>;
}

function PersonSelect({
  people,
  value,
  onChange,
}: {
  people: ScopeOption[];
  value: string;
  onChange: (personId: string) => void;
}) {
  return <label>Pessoa vinculada<select name="personId" value={value} required onChange={(event) => onChange(event.target.value)}><option value="">Selecione uma pessoa</option>{people.map((person) => <option key={person.id} value={person.id}>{person.code} · {person.label}</option>)}</select><span className="field-help">A organização define Cargo, Abrangência e acesso.</span></label>;
}

function AccessSummary({
  user,
  selectedPerson,
  teams,
  products,
  pendingRecalculation = false,
}: {
  user?: ManagedUser;
  selectedPerson?: ScopeOption;
  teams: ScopeOption[];
  products: ScopeOption[];
  pendingRecalculation?: boolean;
}) {
  const role = selectedPerson?.accessRole ?? user?.accessRole ?? "USER";
  const teamNames = (user?.teamIds ?? []).map((teamId) => teams.find((team) => team.id === teamId)?.label ?? "Time indisponível");
  const productNames = (user?.productKeys ?? []).map((productKey) => products.find((product) => product.id === productKey)?.label ?? productKey.toUpperCase());
  const coverage = pendingRecalculation
    ? "Será recalculada pela organização após salvar"
    : role === "PLATFORM_ADMIN"
      ? "Toda a operação comercial e a camada técnica da Plataforma"
      : role === "ADMIN" || role === "SALES_OPS"
        ? "Toda a operação comercial"
        : role === "SUPERVISOR"
          ? productNames.length ? `Produto: ${productNames.join(", ")}` : "Produto definido pela organização"
          : role === "LEADER" || role === "LEADER_IN_TRAINING"
            ? teamNames.length ? `Time: ${teamNames.join(", ")}` : "Time definido pela organização"
            : "Dados da própria pessoa";
  return <div className="scope-review"><strong>Cargo:</strong> {accessRoleLabel(role)}.<br /><strong>Abrangência:</strong> {coverage}.<br /><strong>Acesso:</strong> {role === "PLATFORM_ADMIN" ? "Concedido internamente" : "Definido automaticamente pela organização"}.</div>;
}

function ReadOnlyNotice() {
  return <section className="panel"><p className="eyebrow">Visualização ativa</p><h2>Gestão de acessos somente para consulta</h2><p>Criação, alteração, senha temporária e desativação ficam bloqueadas durante a visualização.</p></section>;
}

function CreateUser({ people, teams, products, readOnly }: { people: ScopeOption[]; teams: ScopeOption[]; products: ScopeOption[]; readOnly: boolean }) {
  const [personId, setPersonId] = useState("");
  const [state, action, pending] = useActionState(createUserAction, emptyAccessState);
  const selectedPerson = people.find((person) => person.id === personId);
  if (readOnly) return <ReadOnlyNotice />;
  return <form action={action} className="access-form panel">
    <input type="hidden" name="role" value="ORGANIZATION" />
    <div className="section-title"><div><p className="eyebrow">Nova conta</p><h2>Criar conta vinculada</h2></div></div>
    <div className="form-grid"><label>Nome<input name="displayName" required /></label><label>E-mail<input name="email" type="email" required /></label><PersonSelect people={people} value={personId} onChange={setPersonId} /></div>
    <AccessSummary selectedPerson={selectedPerson} teams={teams} products={products} pendingRecalculation={Boolean(personId)} />
    <p className="scope-review">O Administrador da Plataforma não é concedido nesta área nem pela planilha.</p>
    <ResultMessage state={state} />
    <button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar conta e gerar senha temporária"}</button>
  </form>;
}

function ManagedUserCard({
  user,
  people,
  teams,
  products,
  readOnly,
}: {
  user: ManagedUser;
  people: ScopeOption[];
  teams: ScopeOption[];
  products: ScopeOption[];
  readOnly: boolean;
}) {
  const [personId, setPersonId] = useState(user.personId ?? "");
  const [updateState, updateAction, updating] = useActionState(updateUserAction, emptyAccessState);
  const [toggleState, toggleAction, toggling] = useActionState(toggleUserAction, emptyAccessState);
  const [resetState, resetAction, resetting] = useActionState(resetPasswordAction, emptyAccessState);
  const linked = people.find((person) => person.id === user.personId);
  const selectedPerson = people.find((person) => person.id === personId);
  const personChanged = personId !== (user.personId ?? "");
  const protectedPlatform = user.role === "PLATFORM_ADMIN";

  if (readOnly || protectedPlatform) return <article className="panel user-card">
    <div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `Pessoa vinculada: ${linked.code} · ${linked.label}` : "Sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Conta ativa" : "Conta inativa"}</span></div>
    <AccessSummary user={user} teams={teams} products={products} />
    <p className="scope-review">{protectedPlatform ? "Privilégio protegido por configuração interna; esta área comercial não concede, remove ou desativa esse acesso." : "A visualização está ativa. As alterações desta conta estão bloqueadas."}</p>
  </article>;

  const commercialAdmin = user.role === "ADMIN";
  return <article className="panel user-card">
    <div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `Pessoa vinculada: ${linked.code} · ${linked.label}` : "Sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Conta ativa" : "Conta inativa"}</span></div>
    <form action={updateAction} className="access-form compact">
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="role" value={commercialAdmin ? "ADMIN" : "ORGANIZATION"} />
      <div className="form-grid"><label>Nome<input name="displayName" defaultValue={user.displayName} required /></label><label>E-mail<input name="email" type="email" defaultValue={user.email} required /></label>{commercialAdmin ? null : <PersonSelect people={people} value={personId} onChange={setPersonId} />}</div>
      {!commercialAdmin && !user.personId ? <p className="inline-alert warning">Esta conta ainda não tem uma Pessoa vinculada. Vincule-a para que o acesso acompanhe a organização automaticamente.</p> : null}
      <AccessSummary user={user} selectedPerson={selectedPerson} teams={teams} products={products} pendingRecalculation={personChanged} />
      <ResultMessage state={updateState} />
      <button type="submit" disabled={updating}>{updating ? "Salvando…" : "Salvar conta e vínculo"}</button>
    </form>
    <div className="access-actions"><form action={toggleAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={String(!user.active)} /><button className="secondary" type="submit" disabled={toggling}>{user.active ? "Desativar conta" : "Reativar conta"}</button></form><form action={resetAction}><input type="hidden" name="userId" value={user.id} /><button className="secondary" type="submit" disabled={resetting}>Gerar nova senha temporária</button></form></div>
    <ResultMessage state={toggleState} /><ResultMessage state={resetState} />
    <small>Último acesso: {user.lastLoginAt ? lastLoginFormatter.format(new Date(user.lastLoginAt)) : "nunca"}</small>
  </article>;
}

export function UserAccessManager({
  users,
  teams,
  products,
  people,
  readOnly = false,
}: {
  users: ManagedUser[];
  teams: ScopeOption[];
  products: ScopeOption[];
  people: ScopeOption[];
  readOnly?: boolean;
}) {
  return <><CreateUser people={people} teams={teams} products={products} readOnly={readOnly} /><section className="user-list">{users.map((user) => <ManagedUserCard key={user.id} user={user} people={people} teams={teams} products={products} readOnly={readOnly} />)}</section></>;
}
