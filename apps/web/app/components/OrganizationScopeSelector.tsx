import type { SelectedOrganizationScope } from "@igd/auth";
import type { OrganizationTreeRow } from "@igd/db";

function unique<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export function OrganizationScopeSelector({
  pathname,
  selected,
  rows,
}: {
  pathname: string;
  selected: SelectedOrganizationScope;
  rows: OrganizationTreeRow[];
}) {
  const products = unique(rows, (row) => row.product_key);
  const productRows = selected.productKey ? rows.filter((row) => row.product_key === selected.productKey) : rows;
  const fronts = unique(productRows, (row) => row.front_key);
  const frontRows = selected.frontKey ? productRows.filter((row) => row.front_key === selected.frontKey) : productRows;
  const teams = unique(frontRows, (row) => row.team_id);
  const teamRows = selected.teamId ? frontRows.filter((row) => row.team_id === selected.teamId) : frontRows;
  const people = unique(teamRows.filter((row) => row.person_id), (row) => row.person_id!);
  return (
    <form className="scope-selector panel" method="get" action={pathname} aria-label="Escopo organizacional global">
      <label>Produto<select name="product" defaultValue={selected.productKey ?? ""}><option value="">Todos os produtos</option>{products.map((row) => <option key={row.product_key} value={row.product_key}>{row.product_name}</option>)}</select></label>
      <label>Frente<select name="front" defaultValue={selected.frontKey ?? ""}><option value="">Todas</option>{fronts.map((row) => <option key={row.front_key} value={row.front_key}>{row.front_name}</option>)}</select></label>
      <label>Time<select name="team" defaultValue={selected.teamId ?? ""}><option value="">Todos</option>{teams.map((row) => <option key={row.team_id} value={row.team_id}>{row.team_name}</option>)}</select></label>
      <label>Pessoa<select name="person" defaultValue={selected.personId ?? ""}><option value="">Todas</option>{people.map((row) => <option key={row.person_id!} value={row.person_id!}>{row.person_code} · {row.person_name}</option>)}</select></label>
      <button type="submit">Aplicar escopo</button>
    </form>
  );
}
