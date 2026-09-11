import { PostgresDriveDiscoveryRepository, PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";

export const dynamic = "force-dynamic";

export default async function IntegrityPage() {
  const user = await requireCapability("settings:manage");
  const [summary, drive] = await Promise.all([
    new PostgresOrganizationRepository(getSql()).getIntegritySummary(user),
    new PostgresDriveDiscoveryRepository(getSql()).getSnapshot(),
  ]);
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Admin · Integridade</p><h1>Exceções</h1><p>Problemas organizacionais e de atribuição sem detalhes de infraestrutura.</p></div><div className="admin-header-actions"><a href="/admin/organization-sync">Sincronização</a><a href="/">Visão Geral</a></div></header><section className="two-column"><article className="panel"><h2>Organização</h2>{summary.organizationWarnings.length ? <ul>{summary.organizationWarnings.map((issue) => <li key={issue.code}><strong>{issue.count}</strong> {issue.code}</li>)}</ul> : <p>Sem warnings no sync mais recente.</p>}</article><article className="panel"><h2>Atribuição de calls</h2>{summary.callAttribution.length ? <ul>{summary.callAttribution.map((issue) => <li key={issue.code}><strong>{issue.count}</strong> {issue.code}</li>)}</ul> : <p>Sem exceções de atribuição.</p>}</article></section><section className="panel"><h2>Documentos para revisão operacional</h2><div className="backlog-grid"><span><b>{drive.needsAttributionReview}</b>Revisão de atribuição</span><span><b>{drive.closerUnresolved}</b>Sem closer</span><span><b>{drive.productUnresolved}</b>Sem produto</span><span><b>{drive.frontUnresolved}</b>Sem frente</span><span><b>{drive.teamUnresolved}</b>Sem time</span><span><b>{drive.inaccessible}</b>Inacessíveis</span></div></section><section className="panel"><p>Correções manuais só serão habilitadas onde o fluxo de provenance e auditoria estiver implementado. Este painel nunca escreve na planilha oficial.</p></section></main>;
}
