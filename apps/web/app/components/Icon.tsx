import type { CSSProperties } from "react";

const iconPaths = {
  overview: "/icons/figma/overview.svg",
  organization: "/icons/figma/organization.svg",
  people: "/icons/figma/people.svg",
  teams: "/icons/figma/teams.svg",
  calls: "/icons/figma/calls.svg",
  analytics: "/icons/figma/analytics.svg",
  integrations: "/icons/figma/integrations.svg",
  report: "/icons/figma/report.svg",
  calendar: "/icons/figma/calendar.svg",
  search: "/icons/figma/search.svg",
  command: "/icons/figma/command.svg",
  userPlus: "/icons/figma/user-plus.svg",
  chevronDown: "/icons/figma/chevron-down.svg",
} as const;

export type IconName = keyof typeof iconPaths;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`ui-icon ${className}`}
      style={{ "--icon-size": `${size}px` } as CSSProperties}
    >
      <img src={iconPaths[name]} alt="" width={size} height={size} />
    </span>
  );
}
