export function AdminBadge({ label = "ADMIN" }: { label?: string }) {
  return <span className="admin-badge" aria-label="Recurso administrativo">{label}</span>;
}
