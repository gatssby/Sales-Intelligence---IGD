"use client";

import { useActionState, useMemo, useState } from "react";
import type { ManualAccessRole } from "@igd/auth";
import type { ManagedUser, ScopeOption } from "@igd/db";
import { createUserAction, resetPasswordAction, toggleUserAction, updateUserAction, type AccessActionState } from "./actions";
import { accessRoleLabel } from "./accessProfiles";

const emptyAccessState: AccessActionState = { error: null, message: null, temporaryPassword: null };
const manualRoles: readonly ManualAccessRole[] = ["CLOSER", "SDR", "LEADER", "LEADER_IN_TRAINING", "SUPERVISOR", "ADMIN"];
const lastLoginFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function ResultMessage({ state }: { state: AccessActionState }) {
  return <>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.message ? <p className="form-success" role="status">{state.message}</p> : null}{state.temporaryPassword ? <div className="temporary-password" role="status"><strong>Senha temporária — exibida somente agora</strong><code>{state.temporaryPassword}</code></div> : null}</>;
}

function personLabel(person: ScopeOption): string {
  return `${person.code ? `${person.code} · ` : ""}${person.label}`;
}

function PersonSelect({
  people,
  value,
  onChange,
  required = true,
  allowCreate = false,
}: {
  people: ScopeOption[];
  value: string;
  onChange: (personId: string) => void;
  required?: boolean;
  allowCreate?: boolean;
}) {
  return <label>Pessoa vinculada<select name="personId" value={value} required={required} onChange={(event) => onChange(event.target.value)}><option value="">Selecione uma pessoa</option>{allowCreate ? <option value="__create__">Criar identidade analítica com o nome da conta</option> : null}{people.map((person) => <option key={person.id} value={person.id}>{personLabel(person)}</option>)}</select></label>;
}

function TeamSelect({ teams, value, onChange }: { teams: ScopeOption[]; value: string[]; onChange: (teamIds: string[]) => void }) {
  return <label>Times<select name="teamIds" multiple required value={value} onChange={(event) => onChange([...event.currentTarget.selectedOptions].map((option) => option.value))}>{teams.map((team) => <option key={team.id} value={team.id}>{team.productKey?.toUpperCase()} · {team.label}</option>)}</select><span className="field-help">Selecione um ou mais Times.</span></label>;
}

function ProductSelect({ products, value, onChange }: { products: ScopeOption[]; value: string; onChange: (productKey: string) => void }) {
  return <label>Produto<select name="productKeys" required value={value} onChange={(event) => onChange(event.target.value)}><option value="">Selecione um Produto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}</select></label>;
}

function ManualRoleSelect({ value, onChange }: { value: ManualAccessRole | ""; onChange: (role: ManualAccessRole) => void }) {
  return <label>Perfil de acesso<select value={value} required onChange={(event) => onChange(event.target.value as ManualAccessRole)}><option value="">Selecione um perfil</option>{manualRoles.map((role) => <option key={role} value={role}>{accessRoleLabel(role)}</option>)}</select></label>;
}

function AccessSummary({
  origin,
  role,
  person,
  teamIds = [],
  productKeys = [],
  teams,
  products,
  organizationProducts = [],
  organizationFronts = [],
  organizationTeams = [],
  pendingOrganization = false,
}: {
  origin: ManagedUser["accessOrigin"];
  role: ManagedUser["accessRole"];
  person?: ScopeOption;
  teamIds?: string[];
  productKeys?: string[];
  teams: ScopeOption[];
  products: ScopeOption[];
  organizationProducts?: string[];
  organizationFronts?: string[];
  organizationTeams?: string[];
  pendingOrganization?: boolean;
}) {
  const teamNames = teamIds.map((teamId) => teams.find((team) => team.id === teamId)?.label ?? "Time indisponível");
  const productNames = productKeys.map((productKey) => products.find((product) => product.id === productKey)?.label ?? productKey.toUpperCase());
  const coverage = pendingOrganization
    ? "Será calculada pela organização ao salvar"
    : role === "PLATFORM_ADMIN"
      ? "Toda a operação comercial e a camada técnica da Plataforma"
      : role === "ADMIN" || role === "SALES_OPS"
        ? "Toda a operação comercial"
        : role === "SUPERVISOR"
          ? productNames.length ? `Produto: ${productNames.join(", ")}` : "Produto ainda não definido"
          : role === "LEADER" || role === "LEADER_IN_TRAINING"
            ? teamNames.length ? `Times: ${teamNames.join(", ")}` : "Times ainda não definidos"
            : person ? `Dados de ${personLabel(person)}` : "Pessoa ainda não definida";
  const originLabel = origin === "ORGANIZATION" ? "Organização IGD" : origin === "MANUAL" ? "Manual" : origin === "SYSTEM" ? "Sistema" : "Precisa de revisão";
  const roleLabel = origin === "ORGANIZATION" ? "Cargo" : "Perfil de acesso";
  return <div className="scope-review">
    <strong>Origem do acesso:</strong> {originLabel}.<br />
    <strong>{roleLabel}:</strong> {accessRoleLabel(role)}.<br />
    {origin === "ORGANIZATION" && organizationProducts.length ? <><strong>Produto:</strong> {organizationProducts.join(", ")}.<br /></> : null}
    {origin === "ORGANIZATION" && organizationFronts.length ? <><strong>Frente:</strong> {organizationFronts.join(", ")}.<br /></> : null}
    {origin === "ORGANIZATION" && organizationTeams.length ? <><strong>Time:</strong> {organizationTeams.join(", ")}.<br /></> : null}
    <strong>Abrangência:</strong> {coverage}.<br />
    <strong>Atualização:</strong> {origin === "ORGANIZATION" ? "Automática pela organização" : origin === "MANUAL" ? "Administrada no Sales Intelligence" : origin === "SYSTEM" ? "Concedida internamente" : "Aguardando revisão administrativa"}.
  </div>;
}

function ReadOnlyNotice() {
  return <section className="panel"><p className="eyebrow">Visualização ativa</p><h2>Gestão de acessos somente para consulta</h2><p>Criação, alteração, senha temporária e desativação ficam bloqueadas durante a visualização.</p></section>;
}

function CreateUser({ people, teams, products, readOnly }: { people: ScopeOption[]; teams: ScopeOption[]; products: ScopeOption[]; readOnly: boolean }) {
  const [origin, setOrigin] = useState<"ORGANIZATION" | "MANUAL">("ORGANIZATION");
  const [manualRole, setManualRole] = useState<ManualAccessRole>("ADMIN");
  const [personId, setPersonId] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [productKey, setProductKey] = useState("");
  const [state, action, pending] = useActionState(createUserAction, emptyAccessState);
  const organizationPeople = useMemo(() => people.filter((person) => person.organizationManaged), [people]);
  const manualPeople = useMemo(() => people.filter((person) => !person.organizationManaged), [people]);
  const selectedPerson = people.find((person) => person.id === personId);
  const selectedRole = origin === "ORGANIZATION" ? selectedPerson?.accessRole ?? "USER" : manualRole;
  if (readOnly) return <ReadOnlyNotice />;
  return <form action={action} className="access-form panel">
    <input type="hidden" name="role" value={origin === "ORGANIZATION" ? "ORGANIZATION" : manualRole} />
    {origin === "MANUAL" && (manualRole === "CLOSER" || manualRole === "SDR") ? <input type="hidden" name="createManualPerson" value={String(personId === "__create__")} /> : null}
    <div className="section-title"><div><p className="eyebrow">Nova conta</p><h2>Criar conta</h2></div></div>
    <div className="form-grid">
      <label>Nome<input name="displayName" required /></label>
      <label>E-mail<input name="email" type="email" required /></label>
      <label>Origem do acesso<select value={origin} onChange={(event) => { setOrigin(event.target.value as typeof origin); setPersonId(""); setTeamIds([]); setProductKey(""); }}><option value="ORGANIZATION">Organização IGD</option><option value="MANUAL">Manual</option></select></label>
      {origin === "ORGANIZATION" ? <PersonSelect people={organizationPeople} value={personId} onChange={setPersonId} /> : <ManualRoleSelect value={manualRole} onChange={(role) => { setManualRole(role); setPersonId(""); setTeamIds([]); setProductKey(""); }} />}
      {origin === "MANUAL" && (manualRole === "CLOSER" || manualRole === "SDR") ? <PersonSelect people={manualPeople} value={personId} onChange={setPersonId} allowCreate /> : null}
      {origin === "MANUAL" && (manualRole === "LEADER" || manualRole === "LEADER_IN_TRAINING") ? <TeamSelect teams={teams} value={teamIds} onChange={setTeamIds} /> : null}
      {origin === "MANUAL" && manualRole === "SUPERVISOR" ? <ProductSelect products={products} value={productKey} onChange={setProductKey} /> : null}
    </div>
    <AccessSummary origin={origin} role={selectedRole} person={selectedPerson} teamIds={teamIds} productKeys={productKey ? [productKey] : []} teams={teams} products={products} pendingOrganization={origin === "ORGANIZATION" && Boolean(personId)} />
    {origin === "ORGANIZATION" ? <p className="scope-review">Cargo, Produto, Frente, Time e liderança são derivados da organização oficial.</p> : <p className="scope-review">O acesso Manual permanece sob gestão do Sales Intelligence e não é alterado pela sincronização.</p>}
    <p className="scope-review">O Administrador da Plataforma não é concedido nesta área nem pela planilha.</p>
    <ResultMessage state={state} />
    <button type="submit" disabled={pending}>{pending ? "Criando…" : "Criar conta e gerar senha temporária"}</button>
  </form>;
}

function OrganizationMatchNotice({ user }: { user: ManagedUser }) {
  const [state, action, pending] = useActionState(updateUserAction, emptyAccessState);
  if (!user.organizationMatch) return null;
  return <div className="inline-alert warning">
    <strong>Vínculo organizacional disponível</strong>
    <p>Esta pessoa agora aparece na organização oficial da IGD como {accessRoleLabel(user.organizationMatch.accessRole)}. A conversão substitui o perfil e a abrangência manuais pelos dados da organização.</p>
    <form action={action}>
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="email" value={user.email} />
      <input type="hidden" name="displayName" value={user.displayName} />
      <input type="hidden" name="role" value="ORGANIZATION" />
      <input type="hidden" name="personId" value={user.organizationMatch.personId} />
      <button type="submit" className="secondary" disabled={pending}>{pending ? "Convertendo…" : "Usar organização IGD"}</button>
    </form>
    <ResultMessage state={state} />
  </div>;
}

function ManagedUserCard({ user, people, teams, products, readOnly }: { user: ManagedUser; people: ScopeOption[]; teams: ScopeOption[]; products: ScopeOption[]; readOnly: boolean }) {
  const initialManualRole = manualRoles.includes(user.role as ManualAccessRole) ? user.role as ManualAccessRole : "";
  const [manualRole, setManualRole] = useState<ManualAccessRole | "">(initialManualRole);
  const [personId, setPersonId] = useState(user.personId ?? "");
  const [teamIds, setTeamIds] = useState(user.teamIds);
  const [productKey, setProductKey] = useState(user.productKeys[0] ?? "");
  const [updateState, updateAction, updating] = useActionState(updateUserAction, emptyAccessState);
  const [toggleState, toggleAction, toggling] = useActionState(toggleUserAction, emptyAccessState);
  const [resetState, resetAction, resetting] = useActionState(resetPasswordAction, emptyAccessState);
  const linked = people.find((person) => person.id === user.personId);
  const selectedPerson = people.find((person) => person.id === personId);
  const protectedPlatform = user.role === "PLATFORM_ADMIN";
  const organizationAccount = user.accessOrigin === "ORGANIZATION";
  const editableRole = organizationAccount ? "ORGANIZATION" : manualRole;
  const displayedRole = organizationAccount ? user.accessRole : manualRole || user.accessRole;
  const manualPeople = people.filter((person) => !person.organizationManaged || person.id === user.personId);

  if (readOnly || protectedPlatform) return <article className="panel user-card">
    <div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `Pessoa vinculada: ${personLabel(linked)}` : "Sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Conta ativa" : "Conta inativa"}</span></div>
    <AccessSummary origin={user.accessOrigin} role={user.accessRole} person={linked} teamIds={user.teamIds} productKeys={user.productKeys} teams={teams} products={products} organizationProducts={user.organizationProductNames} organizationFronts={user.organizationFrontNames} organizationTeams={user.organizationTeamNames} />
    <p className="scope-review">{protectedPlatform ? "Privilégio protegido por configuração interna; esta área comercial não concede, remove ou desativa esse acesso." : "A visualização está ativa. As alterações desta conta estão bloqueadas."}</p>
  </article>;

  return <article className="panel user-card">
    <div className="user-card-heading"><div><h3>{user.displayName}</h3><p>{user.email} · {linked ? `Pessoa vinculada: ${personLabel(linked)}` : "Sem pessoa vinculada"}</p></div><span className={`status-pill ${user.active ? "" : "inactive"}`}>{user.active ? "Conta ativa" : "Conta inativa"}</span></div>
    <OrganizationMatchNotice user={user} />
    {user.accessOrigin === "REVIEW" ? <p className="inline-alert warning">Este acesso anterior precisa de revisão. Escolha um perfil Manual válido para preservá-lo no modelo atual.</p> : null}
    <form action={updateAction} className="access-form compact">
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="role" value={editableRole} />
      <div className="form-grid">
        <label>Nome<input name="displayName" defaultValue={user.displayName} required /></label>
        <label>E-mail<input name="email" type="email" defaultValue={user.email} required /></label>
        {organizationAccount ? <PersonSelect people={people.filter((person) => person.organizationManaged)} value={personId} onChange={setPersonId} /> : <ManualRoleSelect value={manualRole} onChange={(role) => { setManualRole(role); setPersonId(""); setTeamIds([]); setProductKey(""); }} />}
        {!organizationAccount && (manualRole === "CLOSER" || manualRole === "SDR") ? <PersonSelect people={manualPeople} value={personId} onChange={setPersonId} /> : null}
        {!organizationAccount && (manualRole === "LEADER" || manualRole === "LEADER_IN_TRAINING") ? <TeamSelect teams={teams} value={teamIds} onChange={setTeamIds} /> : null}
        {!organizationAccount && manualRole === "SUPERVISOR" ? <ProductSelect products={products} value={productKey} onChange={setProductKey} /> : null}
      </div>
      <AccessSummary origin={organizationAccount ? "ORGANIZATION" : user.accessOrigin === "REVIEW" ? "REVIEW" : "MANUAL"} role={displayedRole} person={selectedPerson} teamIds={teamIds} productKeys={productKey ? [productKey] : []} teams={teams} products={products} organizationProducts={user.organizationProductNames} organizationFronts={user.organizationFrontNames} organizationTeams={user.organizationTeamNames} pendingOrganization={organizationAccount && personId !== user.personId} />
      <ResultMessage state={updateState} />
      <button type="submit" disabled={updating || !editableRole}>{updating ? "Salvando…" : organizationAccount ? "Salvar conta e vínculo" : "Salvar acesso Manual"}</button>
    </form>
    <div className="access-actions"><form action={toggleAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={String(!user.active)} /><button className="secondary" type="submit" disabled={toggling}>{user.active ? "Desativar conta" : "Reativar conta"}</button></form><form action={resetAction}><input type="hidden" name="userId" value={user.id} /><button className="secondary" type="submit" disabled={resetting}>Gerar senha temporária</button></form></div>
    <ResultMessage state={toggleState} /><ResultMessage state={resetState} />
    <small>Último acesso: {user.lastLoginAt ? lastLoginFormatter.format(new Date(user.lastLoginAt)) : "nunca"}</small>
  </article>;
}

export function UserAccessManager({ users, teams, products, people, readOnly = false }: { users: ManagedUser[]; teams: ScopeOption[]; products: ScopeOption[]; people: ScopeOption[]; readOnly?: boolean }) {
  return <><CreateUser people={people} teams={teams} products={products} readOnly={readOnly} /><section className="user-list">{users.map((user) => <ManagedUserCard key={user.id} user={user} people={people} teams={teams} products={products} readOnly={readOnly} />)}</section></>;
}
