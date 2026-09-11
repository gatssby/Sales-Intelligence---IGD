import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { AppShell } from "@/app/components/AppShell";
import { EmptyState, MetricCard, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

export default async function IntegrityPage() {
  const user = await requireCapability("settings:manage");
  const summary = await new PostgresOrganizationRepository(getSql()).getIntegritySummary(user);
  const organizationCount = summary.organizationWarnings.reduce((total, issue) => total + issue.count, 0);
  const attributionCount = summary.callAttribution.reduce((total, issue) => total + issue.count, 0);

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="integrity" title="Integridade">
      <div className="page-intro"><div><p className="page-kicker">Plataforma</p><h2>Integridade de dados</h2><p>Exceções organizacionais e de atribuição expostas sem alterar a fonte oficial.</p></div><span className="control-chip"><Icon name="analytics" size={16} />Leitura segura</span></div>
      <section className="metrics-grid organization-metrics">
        <MetricCard label="Warnings da organização" value={organizationCount} icon="organization" compact note="sync mais recente" />
        <MetricCard label="Exceções de atribuição" value={attributionCount} icon="calls" compact note="calls analisadas" />
      </section>
      <div className="two-column integrity-grid">
        <article className="panel"><SectionHeader eyebrow="Organization Sync" title="Avisos da organização" description="Ocorrências agregadas do último candidate publicado." icon="organization" />{summary.organizationWarnings.length ? <div className="issue-list">{summary.organizationWarnings.map((issue) => <div key={issue.code}><StatusBadge tone="warning">{issue.code}</StatusBadge><span><strong>{issue.count}</strong><small>ocorrências</small></span></div>)}</div> : <EmptyState icon="organization" title="Organização íntegra" description="Sem warnings no sync organizacional mais recente." />}</article>
        <article className="panel"><SectionHeader eyebrow="Call attribution" title="Atribuição de calls" description="Exceções que ainda exigem reconciliação ou contexto." icon="calls" />{summary.callAttribution.length ? <div className="issue-list">{summary.callAttribution.map((issue) => <div key={issue.code}><StatusBadge tone="warning">{issue.code}</StatusBadge><span><strong>{issue.count}</strong><small>ocorrências</small></span></div>)}</div> : <EmptyState icon="calls" title="Atribuição íntegra" description="Sem exceções pendentes em calls analisadas." />}</article>
      </div>
      <div className="inline-alert info"><Icon name="integrations" size={18} /><div><strong>Painel estritamente observacional</strong><p>Correções manuais só serão habilitadas quando provenance e auditoria estiverem implementadas. Esta tela nunca escreve na planilha oficial.</p></div></div>
    </AppShell>
  );
}
