import { requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">SI</div>
        <p className="eyebrow">Primeiro acesso</p>
        <h1>{user.mustChangePassword ? "Crie sua senha" : "Alterar senha"}</h1>
        <p>A senha temporária deixa de funcionar assim que a troca for concluída.</p>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
