import { requireCapability } from "@/lib/auth/session";
import { getAiSpendData, getProgressData } from "@/lib/data";
import { defaultOrganizationSelection } from "@/lib/organization-scope";
import { LiveProgress } from "@/app/components/LiveProgress";
import { AiSpendPanel } from "@/app/components/AiSpendPanel";
import { AppShell } from "@/app/components/AppShell";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

export default async function AiOperationsPage() {
  const user = await requireCapability("platform:observe");
  const selected = defaultOrganizationSelection(user);
  
  const [progress, aiSpend] = await Promise.all([
    getProgressData(user, selected),
    getAiSpendData(user),
  ]);
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="ai" title="Operações de IA">
      <div className="page-intro">
        <div><p className="page-kicker">Plataforma</p><h2>Pipeline de análise</h2><p>Visão somente leitura de backlog, etapas, worker e consumo técnico.</p></div>
        <span className="control-chip"><Icon name="report" size={16} />Monitoramento operacional</span>
      </div>
      <section className="admin-stack">
        <LiveProgress initialData={progress} technical />
        <AiSpendPanel summary={aiSpend} />
      </section>
    </AppShell>
  );
}
