import type { SelectedOrganizationScope } from "@igd/auth";
import type { OrganizationTreeRow } from "@igd/db";
import { Icon } from "./Icon";

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

      <span className="scope-label"><Icon name="organization" size={16} />Escopo global</span>
      <div className="scope-node" title="Produto">
        <Icon name="organization" size={16} />
        <select name="product" aria-label="Produto" defaultValue={selected.productKey ?? ""}>
          <option value="">{selected.productKey ? "Limpar produto" : "Todos os produtos"}</option>
          {products.map((row) => <option key={row.product_key} value={row.product_key}>{row.product_name}</option>)}
        </select>
        <Icon name="chevronDown" size={14} />
      </div>

      <div className="scope-node" title="Frente">
        <Icon name="analytics" size={16} />
        <select name="front" aria-label="Frente" defaultValue={selected.frontKey ?? ""}>
          <option value="">Todas as frentes</option>
          {fronts.map((row) => <option key={row.front_key} value={row.front_key}>{row.front_name}</option>)}
        </select>
        <Icon name="chevronDown" size={14} />
      </div>

      <div className="scope-node" title="Time">
        <Icon name="teams" size={16} />
        <select name="team" aria-label="Time" defaultValue={selected.teamId ?? ""}>
          <option value="">Todos os times</option>
          {teams.map((row) => <option key={row.team_id} value={row.team_id}>{row.team_name}</option>)}
        </select>
        <Icon name="chevronDown" size={14} />
      </div>

      <div className="scope-node" title="Pessoa">
        <Icon name="people" size={16} />
        <select name="person" aria-label="Pessoa" defaultValue={selected.personId ?? ""}>
          <option value="">Todas as pessoas</option>
          {people.map((row) => <option key={row.person_id!} value={row.person_id!}>{row.person_name}</option>)}
        </select>
        <Icon name="chevronDown" size={14} />
      </div>

      <button type="submit" className="btn btn-primary scope-submit">Aplicar</button>
    </form>
  );
}
