import type { ReactNode } from "react";
import { logoutAction } from "@/app/logout/actions";
import { Icon, type IconName } from "./Icon";
import { Avatar } from "./VisualPrimitives";

type NavItem = { href: string; label: string; route: string; icon: IconName };

const commercialItems: NavItem[] = [
  { href: "/", label: "Visão Geral", route: "overview", icon: "overview" },
  { href: "/organization", label: "Organização", route: "organization", icon: "organization" },
  { href: "/people", label: "Pessoas", route: "people", icon: "people" },
  { href: "/teams", label: "Times", route: "teams", icon: "teams" },
  { href: "/calls", label: "Calls", route: "calls", icon: "calls" },
];

const adminItems: NavItem[] = [
  { href: "/admin/users", label: "Usuários e acessos", route: "users", icon: "userPlus" },
  { href: "/admin/organization-sync", label: "Sincronização", route: "sync", icon: "integrations" },
  { href: "/admin/integrity", label: "Integridade", route: "integrity", icon: "analytics" },
];

const platformItems: NavItem[] = [
  { href: "/platform", label: "Plataforma", route: "platform", icon: "integrations" },
  { href: "/admin/ai", label: "Operações de IA", route: "ai", icon: "report" },
];

const roleLabels: Record<string, string> = {
  PLATFORM_ADMIN: "Administrador da Plataforma",
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  LEADER: "Líder",
  LEADER_IN_TRAINING: "Líder em treinamento",
  CLOSER: "Closer",
  SDR: "SDR",
};

function NavigationItem({ item, activeRoute }: { item: NavItem; activeRoute: string }) {
  const active = activeRoute === item.route || (activeRoute === "settings" && item.route === "users");
  return <a href={item.href} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}><Icon name={item.icon} />{item.label}</a>;
}

export function AppShell({
  user,
  activeRoute,
  title,
  scopeSelector,
  children,
}: {
  user: { fullName: string; role?: string; accessRole?: string };
  activeRoute: string;
  title: string;
  scopeSelector?: ReactNode;
  children: ReactNode;
}) {
  const accessRole = user.accessRole ?? user.role;
  const isAdmin = accessRole === "ADMIN" || accessRole === "PLATFORM_ADMIN";
  const isPlatform = user.role === "PLATFORM_ADMIN" && accessRole === "PLATFORM_ADMIN";
  const currentIcon = [...commercialItems, ...adminItems, ...platformItems].find((item) => item.route === activeRoute)?.icon ?? "overview";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace-identity">
          <div className="sidebar-logo-icon">SI</div>
          <div className="workspace-copy"><strong>Sales Intelligence</strong><span>IGD Workspace</span></div>
          <Icon name="chevronDown" size={16} />
        </div>

        <a className="sidebar-search" href="/calls">
          <span><Icon name="search" />Buscar calls</span>
          <kbd><Icon name="command" size={14} /> K</kbd>
        </a>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          <div className="nav-group">
            {commercialItems.map((item) => <NavigationItem key={item.route} item={item} activeRoute={activeRoute} />)}
          </div>

          {isAdmin ? (
            <div className="nav-group">
              <p className="nav-group-label">Administração</p>
              {adminItems.map((item) => <NavigationItem key={item.route} item={item} activeRoute={activeRoute} />)}
            </div>
          ) : null}
          {isPlatform ? (
            <div className="nav-group">
              <p className="nav-group-label">Plataforma</p>
              {platformItems.map((item) => <NavigationItem key={item.route} item={item} activeRoute={activeRoute} />)}
            </div>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <form action={logoutAction} className="account-row">
            <Avatar name={user.fullName} size="sm" />
            <span><strong>{user.fullName}</strong><small>{roleLabels[accessRole ?? ""] ?? "Acesso comercial"}</small></span>
            <button type="submit">Sair</button>
          </form>
        </div>
      </aside>

      <div className="app-content">
        <header className="top-header">
          <div className="header-page-identity"><Icon name={currentIcon} /><h1 className="page-title">{title}</h1></div>
          <div className="header-actions">
            {scopeSelector}
            <div className="header-account" title={user.fullName}><Avatar name={user.fullName} size="sm" /><Icon name="chevronDown" size={16} /></div>
          </div>
        </header>
        <main className="main-container">{children}</main>
      </div>
    </div>
  );
}
