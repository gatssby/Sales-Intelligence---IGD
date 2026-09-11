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
    <AppShell user={{ fullName: actor.displayName, role: actor.role }} activeRoute="users" title="Usuários e acessos">
      <div className="page-intro"><div><p className="page-kicker">Plataforma</p><h2>Controle de acesso</h2><p>Contas individuais, papéis do sistema e escopo efetivo derivado da organização.</p></div><span className="control-chip"><Icon name="userPlus" size={16} />Acesso administrado</span></div>
      <section className="panel">
        <SectionHeader eyebrow="Segurança" title="Gerenciamento de acessos" description="Papéis, escopos e credenciais individuais. A planilha nunca concede Admin." icon="userPlus" action={<AdminBadge />} />
        <UserAccessManager users={users} teams={options.teams} products={options.products} people={options.people} />
      </section>
    </AppShell>
  );
}
