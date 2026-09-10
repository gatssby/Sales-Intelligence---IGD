import { PostgresAuthRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { logoutAction } from "@/app/logout/actions";
import { UserAccessManager } from "./UserAccessManager";
import { AdminBadge } from "@/app/components/AdminBadge";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireCapability("users:manage");
  const repository = new PostgresAuthRepository(getSql());
  const [users, options] = await Promise.all([repository.listUsers(actor), repository.listScopeOptions(actor)]);
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="eyebrow">Administração</p><h1>Usuários e acessos <AdminBadge /></h1><p>Papéis, escopos e credenciais individuais.</p></div>
        <div className="admin-header-actions"><a href="/">Voltar ao dashboard</a><form action={logoutAction}><button className="secondary">Sair</button></form></div>
      </header>
      <UserAccessManager users={users} teams={options.teams} products={options.products} />
    </main>
  );
}
