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
        <div className="sidebar-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="6" fill="var(--accent-primary)"/>
            <path d="M7 17L12 12L17 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7 7L12 12L17 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Sales<span>Intelligence</span>
        </div>
        
        <nav className="sidebar-nav">
          <a href="/" className={`nav-item ${activeRoute === "overview" ? "active" : ""}`}>Visão Geral</a>
          <a href="/organization" className={`nav-item ${activeRoute === "organization" ? "active" : ""}`}>Organização</a>
          <a href="/people" className={`nav-item ${activeRoute === "people" ? "active" : ""}`}>Pessoas</a>
          <a href="/teams" className={`nav-item ${activeRoute === "teams" ? "active" : ""}`}>Times</a>
          <a href="/calls" className={`nav-item ${activeRoute === "calls" ? "active" : ""}`}>Calls</a>
        </nav>
        
        <div className="sidebar-footer sidebar-nav">
          {user.role === 'PLATFORM_ADMIN' && (
            <>
              <div style={{ padding: '16px 16px 8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Plataforma
              </div>
              <a href="/admin/users" className={`nav-item ${activeRoute === "settings" ? "active" : ""}`}>Usuários e Acessos</a>
              <a href="/admin/organization-sync" className="nav-item">Sincronização Org.</a>
              <a href="/admin/integrity" className="nav-item">Integridade</a>
              <a href="/admin/ai" className="nav-item">Operações de IA</a>
            </>
          )}
          <form action={logoutAction} method="post" style={{ width: "100%" }}>
            <button type="submit" className="nav-item" style={{ width: "100%", justifyContent: "flex-start" }}>Sair ({user.fullName.split(" ")[0]})</button>
          </form>
        </div>
      </aside>
      
      <div className="app-content">
        <header className="top-header">
          <h1 className="page-title">{title}</h1>
          {scopeSelector}
        </header>
        <main className="main-container">
          {children}
        </main>
      </div>
    </div>
  );
}
