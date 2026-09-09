import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/");
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">SI</div>
        <p className="eyebrow">IGD Sales Intelligence</p>
        <h1>Acesse sua conta</h1>
        <p>Use o acesso individual fornecido pelo administrador.</p>
        <LoginForm />
      </section>
    </main>
  );
}
