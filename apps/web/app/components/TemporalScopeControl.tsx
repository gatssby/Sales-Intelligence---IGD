import type { SelectedOrganizationScope } from "@igd/auth";
import { Icon } from "./Icon";

export function TemporalScopeControl({ action, selected, value, label = "Estrutura vigente em" }: { action: string; selected: SelectedOrganizationScope; value?: string; label?: string }) {
  return (
    <form method="get" action={action} className="temporal-control">
      <input type="hidden" name="product" value={selected.productKey ?? ""} />
      <input type="hidden" name="front" value={selected.frontKey ?? ""} />
      <input type="hidden" name="team" value={selected.teamId ?? ""} />
      <input type="hidden" name="person" value={selected.personId ?? ""} />
      <label><Icon name="calendar" size={16} /><span>{label}</span><input type="date" name="at" defaultValue={value} /></label>
      <button type="submit" className="btn btn-outline">Aplicar</button>
    </form>
  );
}
