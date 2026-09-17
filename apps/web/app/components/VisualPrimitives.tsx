import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Avatar({ name, code, size = "md" }: { name: string; code?: string | null; size?: "sm" | "md" | "lg" | "xl" }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SI";
  return <span className={`avatar avatar-${size}`} title={code ? `${code} · ${name}` : name}>{initials}</span>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "error" | "info" | "neutral" }) {
  return <span className={`status-badge status-${tone}`}><i aria-hidden="true" />{children}</span>;
}

export function SectionHeader({ eyebrow, title, description, icon, action }: { eyebrow?: string; title: string; description?: string; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div className="section-heading-copy">
        {icon ? <span className="section-heading-icon"><Icon name={icon} /></span> : null}
        <div>
          {eyebrow ? <p className="panel-eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {action ? <div className="section-heading-action">{action}</div> : null}
    </div>
  );
}

export function MetricCard({ label, value, icon, note, compact = false }: { label: string; value: ReactNode; icon: IconName; note?: ReactNode; compact?: boolean }) {
  return (
    <article className={`panel metric-card ${compact ? "metric-card-compact" : ""}`}>
      <div className="metric-card-top">
        <p className="panel-eyebrow">{label}</p>
        <span className="metric-icon"><Icon name={icon} /></span>
      </div>
      <strong className="metric-value">{value}</strong>
      {note ? <span className="metric-note">{note}</span> : null}
    </article>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-visual" aria-hidden="true">
        <span className="empty-orbit empty-orbit-one" />
        <span className="empty-orbit empty-orbit-two" />
        <span className="empty-state-icon"><Icon name={icon} size={24} /></span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

export function ProgressBar({ value, tone = "accent", label }: { value: number; tone?: "accent" | "success" | "warning" | "error"; label?: string }) {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="progress-visual" aria-label={label ?? `${normalized}%`}>
      <span className="progress-visual-track"><i className={`progress-${tone}`} style={{ "--progress": `${normalized}%` } as CSSProperties} /></span>
    </div>
  );
}

export function ScoreRing({ value, label = "Score" }: { value: number | null; label?: string }) {
  const normalized = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="score-ring" style={{ "--score": `${normalized * 3.6}deg` } as CSSProperties} aria-label={`${label}: ${value ?? "não disponível"}`}>
      <div><strong>{value ?? "—"}</strong><span>{label}</span></div>
    </div>
  );
}

export function MiniBars({ values }: { values: number[] }) {
  const normalized = values.slice(0, 12).map((value) => Math.max(4, Math.min(100, value)));
  return (
    <div className="mini-bars" aria-label="Scores das calls recentes">
      {normalized.map((value, index) => <i key={`${index}-${value}`} style={{ "--bar": `${value}%` } as CSSProperties} />)}
    </div>
  );
}
