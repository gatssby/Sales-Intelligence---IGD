import type { SelectedOrganizationScope } from "@igd/auth";
import type { OrganizationTreeRow } from "@igd/db";

function unique<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export function OrganizationScopeSelector({
  pathname,
  selected,
  rows,
  preserved = {},
}: {
  pathname: string;
  selected: SelectedOrganizationScope;
  rows: OrganizationTreeRow[];
  preserved?: Record<string, string | undefined>;
}) {
  const products = unique(rows, (row) => row.product_key);
  const productRows = selected.productKey ? rows.filter((row) => row.product_key === selected.productKey) : rows;
  const fronts = unique(productRows, (row) => row.front_key);
  const frontRows = selected.frontKey ? productRows.filter((row) => row.front_key === selected.frontKey) : productRows;
  const teams = unique(frontRows, (row) => row.team_id);
  const teamRows = selected.teamId ? frontRows.filter((row) => row.team_id === selected.teamId) : frontRows;
  const people = unique(teamRows.filter((row) => row.person_id), (row) => row.person_id!);
  
  return (
    <form className="global-scope-picker" method="get" action={pathname} aria-label="Escopo organizacional global">
      {Object.entries(preserved).filter(([,value]) => value).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />)}
      
      <div className="scope-node">
        <select name="product" defaultValue={selected.productKey ?? ""}>
          <option value="">{selected.productKey ? "X Limpar Produto" : "Todos os Produtos"}</option>
          {products.map((row) => <option key={row.product_key} value={row.product_key}>{row.product_name}</option>)}
        </select>
      </div>
      
      <span className="scope-divider">›</span>
      <div className="scope-node">
        <select name="front" defaultValue={selected.frontKey ?? ""}>
          <option value="">Todas as Frentes</option>
          {fronts.map((row) => <option key={row.front_key} value={row.front_key}>{row.front_name}</option>)}
        </select>
      </div>
      
      <span className="scope-divider">›</span>
      <div className="scope-node">
        <select name="team" defaultValue={selected.teamId ?? ""}>
          <option value="">Todos os Times</option>
          {teams.map((row) => <option key={row.team_id} value={row.team_id}>{row.team_name}</option>)}
        </select>
      </div>
      
      <span className="scope-divider">›</span>
      <div className="scope-node">
        <select name="person" defaultValue={selected.personId ?? ""}>
          <option value="">Pessoas</option>
          {people.map((row) => <option key={row.person_id!} value={row.person_id!}>{row.person_name}</option>)}
        </select>
      </div>
      
      <button type="submit" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12px', marginLeft: '8px', borderRadius: '8px' }}>Aplicar</button>
    </form>
  );
}
