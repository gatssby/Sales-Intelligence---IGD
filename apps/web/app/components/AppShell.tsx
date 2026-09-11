import { logoutAction } from "@/app/logout/actions";

export function AppShell({
  user,
  activeRoute,
  title,
  scopeSelector,
  children
}: {
  user: { fullName: string; role?: string };
  activeRoute: string;
  title: string;
  scopeSelector?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo" style={{ marginBottom: '32px' }}>
          <div className="sidebar-logo-icon">1</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Sales Intelligence</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>IGD Workspace</span>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          <a href="/" className={`nav-item ${activeRoute === "overview" ? "active" : ""}`}>Visão Geral</a>
          <a href="/organization" className={`nav-item ${activeRoute === "organization" ? "active" : ""}`}>Organização</a>
          <a href="/people" className={`nav-item ${activeRoute === "people" ? "active" : ""}`}>Pessoas</a>
          <a href="/teams" className={`nav-item ${activeRoute === "teams" ? "active" : ""}`}>Times</a>
          <a href="/calls" className={`nav-item ${activeRoute === "calls" ? "active" : ""}`}>Calls</a>
          
          {user.role === 'PLATFORM_ADMIN' && (
            <>
              <div style={{ padding: '16px 16px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Plataforma
              </div>
              <a href="/admin/users" className={`nav-item ${activeRoute === "settings" ? "active" : ""}`}>Usuários e Acessos</a>
              <a href="/admin/organization-sync" className="nav-item">Sincronização Org.</a>
              <a href="/admin/integrity" className="nav-item">Integridade</a>
              <a href="/admin/ai" className="nav-item">Operações de IA</a>
            </>
          )}
        </nav>
        
        <div className="sidebar-footer sidebar-nav">
          <form action={logoutAction} method="post" style={{ width: "100%" }}>
            <button type="submit" className="nav-item" style={{ width: "100%", justifyContent: "flex-start" }}>Sair ({user.fullName.split(" ")[0]})</button>
          </form>
        </div>
      </aside>
      
      <div className="app-content">
        <header className="top-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--color-accent-subtle)', padding: '6px 12px', borderRadius: '6px' }}>
            <h1 className="page-title" style={{ color: 'var(--color-text-primary)', margin: 0 }}>{title}</h1>
          </div>
          {scopeSelector}
        </header>
        <main className="main-container">
          {children}
        </main>
      </div>
    </div>
  );
}
