import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { AppShell } from "@/app/components/AppShell";
import { EmptyState, MetricCard, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

const issueLabels: Readonly<Record<string, string>> = {
  missing_person_code: "Pessoa sem código V válido",
  missing_leader_code: "Liderança sem código V",
  unknown_leader: "Liderança não encontrada",
  duplicate_person_code: "Código V repetido",
  conflicting_membership: "Pessoa vinculada a mais de um time",
  conflicting_product: "Pessoa vinculada a mais de um produto",
  conflicting_role_signals: "Cargo com informações conflitantes",
  invalid_boolean: "Campo Sim/Não inválido",
  unmapped_organizational_role: "Cargo não reconhecido",
  malformed_row: "Linha incompleta",
  sync_failed: "Última atualização não publicada",
  closer_unresolved: "Closer não identificado",
  product_unresolved: "Produto não identificado",
  front_unresolved: "Frente não identificada",
  team_unresolved: "Time não identificado",
  needs_attribution_review: "Atribuição precisa de revisão",
};

const issueLabel = (code: string) => issueLabels[code] ?? "Aviso de integridade";

export default async function IntegrityPage() {
  const user = await requireCapability("settings:manage");
  const summary = await new PostgresOrganizationRepository(getSql()).getIntegritySummary(user);
  const organizationCount = summary.organizationWarnings.reduce((total, issue) => total + issue.count, 0);
  const attributionCount = summary.callAttribution.reduce((total, issue) => total + issue.count, 0);

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="integrity" title="Integridade">
      <div className="page-intro"><div><p className="page-kicker">Administração</p><h2>Integridade de dados</h2><p>Pendências da organização e da atribuição de calls, sem alterar a fonte oficial.</p></div><span className="control-chip"><Icon name="analytics" size={16} />Somente consulta</span></div>
      <section className="metrics-grid organization-metrics">
        <MetricCard label="Avisos da organização" value={organizationCount} icon="organization" compact note="última atualização" />
        <MetricCard label="Exceções de atribuição" value={attributionCount} icon="calls" compact note="calls analisadas" />
      </section>
      <div className="two-column integrity-grid">
        <article className="panel"><SectionHeader eyebrow="Organização" title="Avisos da organização" description="Ocorrências agregadas da última atualização." icon="organization" />{summary.organizationWarnings.length ? <div className="issue-list">{summary.organizationWarnings.map((issue) => <div key={issue.code}><StatusBadge tone="warning">{issueLabel(issue.code)}</StatusBadge><span><strong>{issue.count}</strong><small>ocorrências</small></span></div>)}</div> : <EmptyState icon="organization" title="Organização íntegra" description="Sem avisos na atualização organizacional mais recente." />}</article>
        <article className="panel"><SectionHeader eyebrow="Calls" title="Atribuição de calls" description="Pendências que ainda exigem conferência ou contexto." icon="calls" />{summary.callAttribution.length ? <div className="issue-list">{summary.callAttribution.map((issue) => <div key={issue.code}><StatusBadge tone="warning">{issueLabel(issue.code)}</StatusBadge><span><strong>{issue.count}</strong><small>ocorrências</small></span></div>)}</div> : <EmptyState icon="calls" title="Atribuição íntegra" description="Sem exceções pendentes em calls analisadas." />}</article>
      </div>
      <div className="inline-alert info"><Icon name="integrations" size={18} /><div><strong>Painel somente para consulta</strong><p>Esta tela não altera a planilha oficial. Corrija a informação na fonte responsável e aguarde a próxima atualização.</p></div></div>
    </AppShell>
  );
}
