"use client";

import { useActionState, useState } from "react";
import type { ManagedUser, ScopeOption } from "@igd/db";
import type { Role } from "@igd/auth";
import {
  createUserAction,
  resetPasswordAction,
  toggleUserAction,
  updateUserAction,
  type AccessActionState,
} from "./actions";

const emptyAccessState: AccessActionState = { error: null, message: null, temporaryPassword: null };

const roleLabels: Record<Role, string> = {
  ADMIN: "Admin",
  LEADER: "Leader",
  SUPERVISOR: "Supervisor",
  SALES_OPS: "Sales Ops",
};

function ResultMessage({ state }: { state: AccessActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="form-success" role="status">{state.message}</p> : null}
      {state.temporaryPassword ? (
        <div className="temporary-password" role="status">
          <strong>Senha temporária — exibida somente agora</strong>
          <code>{state.temporaryPassword}</code>
        </div>
      ) : null}
    </>
  );
}

function ScopeFields({
  role,
  teams,
  products,
  selectedTeams = [],
  selectedProducts = [],
}: {
  role: Role;
  teams: ScopeOption[];
  products: ScopeOption[];
  selectedTeams?: string[];
  selectedProducts?: string[];
}) {
  const isLeader = role === "LEADER";
  const isSupervisor = role === "SUPERVISOR";
  return (
    <div className="scope-grid">
      <fieldset disabled={!isLeader}>
        <legend>Times do líder</legend>
        {teams.map((team) => (
          <label className="check-row" key={team.id}>
            <input name="teamIds" type="checkbox" value={team.id} defaultChecked={selectedTeams.includes(team.id)} />
            <span>{team.label}<small>{team.productKey}</small></span>
          </label>
        ))}
        {!teams.length ? <small>Nenhum time cadastrado.</small> : null}
      </fieldset>
      <fieldset disabled={!isSupervisor}>
        <legend>Produtos do supervisor</legend>
        {products.map((product) => (
          <label className="check-row" key={product.id}>
            <input name="productKeys" type="checkbox" value={product.id} defaultChecked={selectedProducts.includes(product.id)} />
            <span>{product.label}</span>
          </label>
        ))}
        {!products.length ? <small>Nenhum produto cadastrado.</small> : null}
      </fieldset>
      <p className="scope-review">
        <strong>Escopo antes de salvar:</strong>{" "}
        {role === "ADMIN" || role === "SALES_OPS"
          ? "leitura global, sem associações específicas"
          : role === "LEADER"
            ? "somente os times marcados"
            : "todos os times dos produtos marcados"}.
        {role === "ADMIN" ? " Inclui ações com custo." : " Conta somente leitura; ações com custo permanecem bloqueadas."}
      </p>
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <label>
      Papel
      <select name="role" value={value} onChange={(event) => onChange(event.target.value as Role)}>
        {(Object.keys(roleLabels) as Role[]).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
      </select>
    </label>
  );
}

function CreateUser({ teams, products }: { teams: ScopeOption[]; products: ScopeOption[] }) {
  const [role, setRole] = useState<Role>("LEADER");
  const [state, action, pending] = useActionState(createUserAction, emptyAccessState);
  return (
    <form action={action} className="access-form panel">
      <div className="section-title"><div><p className="eyebrow">Novo acesso</p><h2>Criar usuário</h2></div></div>
      <div className="form-grid">
        <label>Nome<input name="displayName" required /></label>
        <label>E-mail<input name="email" type="email" required /></label>
        <RoleSelect value={role} onChange={setRole} />
      </div>
      <ScopeFields role={role} teams={teams} products={products} />
      <ResultMessage state={state} />
      <button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar e emitir senha temporária"}</button>
    </form>
  );
}

function ManagedUserCard({ user, teams, products }: { user: ManagedUser; teams: ScopeOption[]; products: ScopeOption[] }) {
  const [role, setRole] = useState<Role>(user.role);
  const [updateState, updateAction, updating] = useActionState(updateUserAction, emptyAccessState);
  const [toggleState, toggleAction, toggling] = useActionState(toggleUserAction, emptyAccessState);
  const [resetState, resetAction, resetting] = useActionState(resetPasswordAction, emptyAccessState);
  return (
    <article className="panel user-card">
      <div className="user-card-heading">
        <div><h3>{user.displayName}</h3><p>{user.email}</p></div>
        <span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Ativo" : "Inativo"}</span>
      </div>
      <form action={updateAction} className="access-form compact">
        <input type="hidden" name="userId" value={user.id} />
        <div className="form-grid">
          <label>Nome<input name="displayName" defaultValue={user.displayName} required /></label>
          <label>E-mail<input name="email" type="email" defaultValue={user.email} required /></label>
          <RoleSelect value={role} onChange={setRole} />
        </div>
        <ScopeFields role={role} teams={teams} products={products} selectedTeams={user.teamIds} selectedProducts={user.productKeys} />
        <ResultMessage state={updateState} />
        <button type="submit" disabled={updating}>{updating ? "Salvando…" : "Salvar papel e escopo"}</button>
      </form>
      <div className="access-actions">
        <form action={toggleAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="active" value={String(!user.active)} />
          <button className="secondary" type="submit" disabled={toggling}>{user.active ? "Desativar conta" : "Reativar conta"}</button>
        </form>
        <form action={resetAction}>
          <input type="hidden" name="userId" value={user.id} />
          <button className="secondary" type="submit" disabled={resetting}>Emitir nova senha temporária</button>
        </form>
      </div>
      <ResultMessage state={toggleState} />
      <ResultMessage state={resetState} />
      <small>Último login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("pt-BR") : "nunca"}</small>
    </article>
  );
}

export function UserAccessManager({ users, teams, products }: { users: ManagedUser[]; teams: ScopeOption[]; products: ScopeOption[] }) {
  return (
    <>
      <CreateUser teams={teams} products={products} />
      <section className="user-list">
        {users.map((user) => <ManagedUserCard key={user.id} user={user} teams={teams} products={products} />)}
      </section>
    </>
  );
}
