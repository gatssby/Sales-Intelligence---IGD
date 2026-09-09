import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/logout/actions";

export default async function ForbiddenPage() {
  const user = await requireUser();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">SI</div>
        <p className="eyebrow">Acesso bloqueado</p>
        <h1>Você não tem permissão para esta área.</h1>
        <p>Conta atual: {user.displayName} · {user.role}</p>
        <div className="access-actions"><a className="button-link" href="/">Voltar ao dashboard</a><form action={logoutAction}><button className="secondary">Sair</button></form></div>
      </section>
    </main>
  );
}
