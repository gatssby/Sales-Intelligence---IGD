import { PostgresAuthRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { UserAccessManager } from "./UserAccessManager";
import { AdminBadge } from "@/app/components/AdminBadge";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireCapability("users:manage");
  const repository = new PostgresAuthRepository(getSql());
  const [users, options] = await Promise.all([repository.listUsers(actor), repository.listScopeOptions(actor)]);
  
  return (
    <AppShell user={{ fullName: actor.displayName, role: actor.role }} activeRoute="settings" title="Usuários e Acessos">
      <section className="panel">
        <div style={{ marginBottom: '24px' }}>
          <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Gerenciamento de Acessos <AdminBadge /></h2>
          <p className="td-secondary">Papéis, escopos e credenciais individuais.</p>
        </div>
        <UserAccessManager users={users} teams={options.teams} products={options.products} people={options.people} />
      </section>
    </AppShell>
  );
}
