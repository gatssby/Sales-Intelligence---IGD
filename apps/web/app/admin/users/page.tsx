import { PostgresAuthRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { UserAccessManager } from "./UserAccessManager";
import { AdminBadge } from "@/app/components/AdminBadge";
import { AppShell } from "@/app/components/AppShell";
import { SectionHeader } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireCapability("users:manage");
  const repository = new PostgresAuthRepository(getSql());
  const [users, options] = await Promise.all([repository.listUsers(actor), repository.listScopeOptions(actor)]);
  
  return (
    <AppShell user={{ fullName: actor.displayName, role: actor.role, accessRole: actor.accessRole }} activeRoute="users" title="Usuários e acessos">
      <div className="page-intro"><div><p className="page-kicker">Administração</p><h2>Gestão de usuários</h2><p>Crie acessos pela Organização IGD ou administre perfis Manuais para quem não está na fonte oficial.</p></div><span className="control-chip"><Icon name="userPlus" size={16} />Gestão de contas</span></div>
      <section className="panel">
        <SectionHeader eyebrow="Segurança" title="Contas e acessos" description="A origem define se Cargo e abrangência são automáticos ou administrados no Sales Intelligence. Platform Admin não é concedido nesta área." icon="userPlus" action={<AdminBadge label="Administrador" />} />
        <UserAccessManager users={users} teams={options.teams} products={options.products} people={options.people} readOnly={Boolean(actor.preview)} />
      </section>
    </AppShell>
  );
}
