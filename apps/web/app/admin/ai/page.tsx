import { requireCapability } from "@/lib/auth/session";
import { getAiSpendData, getProgressData } from "@/lib/data";
import { defaultOrganizationSelection } from "@/lib/organization-scope";
import { LiveProgress } from "@/app/components/LiveProgress";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AiOperationsPage() {
  const user = await requireCapability("settings:manage");
  const selected = defaultOrganizationSelection(user);
  
  const [progress, aiSpend] = await Promise.all([
    getProgressData(user, selected),
    getAiSpendData(user),
  ]);
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="settings" title="Operações de IA">
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h2 className="panel-title">Observabilidade da Pipeline de Análise</h2>
          <p className="td-secondary">Monitoramento de jobs, workers, tokens e custos em tempo real.</p>
        </div>
        
        <LiveProgress initialData={progress} initialAiSpend={aiSpend} />
      </section>
    </AppShell>
  );
}
