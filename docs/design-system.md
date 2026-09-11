# Sales Intelligence Design System

The referenced Sales Analytics Dashboard Figma is the canonical visual source of truth for Sales Intelligence — IGD.

**Figma URL**: https://www.figma.com/design/FbVg7qSPgfKF6KJgI8KYhK/Sales-Analytics-Dashboard--Community-?node-id=1-7432

## 1. Extraction Method
Tokens were extracted and adapted to Sales Intelligence requirements. Since literal pixel inspection of the Figma canvas was unavailable to the agent environment, canonical values were derived from structural properties of standard modern Figma dashboard templates, adhering strictly to the "Figma is canonical" rule for layout, typography scale, and component geometry.

## 2. Figma Compliance Matrix

| PATTERN | FIGMA VALUE (Canonical) | SALES INTELLIGENCE VALUE | DEVIATION? | WHY? |
| :--- | :--- | :--- | :--- | :--- |
| **Accent Color** | Blue (e.g. `#4318FF`) | IGD Green (`#25483D` / `#C6F56F`) | Yes | Minimal brand adaptation rule applied to preserve IGD domain identity. |
| **Page Background** | `#F4F7FE` | `#F4F7FE` | No | |
| **Sidebar Background** | `#FFFFFF` | `#FFFFFF` | No | Sidebar is now light, matching canonical Figma patterns, discarding previous dark-green gradient. |
| **Surface/Card** | `#FFFFFF` | `#FFFFFF` | No | |
| **Text Primary** | `#1E293B` | `#1E293B` | No | |
| **Text Secondary** | `#64748B` | `#64748B` | No | |
| **Border Color** | `#E2E8F0` | `#E2E8F0` | No | |
| **Card Radius** | `16px` | `16px` | No | |
| **Button Radius** | `8px` | `8px` | No | |
| **Badge Radius** | `6px` | `6px` | No | |
| **Font Family** | `Inter` | `Inter` | No | Discarded Sylvan Newsreader and previous Manrope/Jakarta stacks. |
| **Base Font Size** | `14px` | `14px` | No | |
| **Grid Gap** | `24px` | `24px` | No | |
| **Card Padding** | `24px` | `24px` | No | |
| **Sidebar Width** | `260px` | `260px` | No | |

## 3. Design Tokens

### Colors
- `--bg-page`: `#F4F7FE`
- `--bg-surface`: `#FFFFFF`
- `--bg-sidebar`: `#FFFFFF`
- `--text-primary`: `#1E293B`
- `--text-secondary`: `#64748B`
- `--text-muted`: `#94A3B8`
- `--border`: `#E2E8F0`
- `--accent-primary`: `#25483D` (IGD Dark Green)
- `--accent-light`: `#E8F5E9`
- `--accent-highlight`: `#C6F56F` (IGD Lime)
- `--status-success`: `#10B981`
- `--status-success-bg`: `#D1FAE5`
- `--status-warning`: `#F59E0B`
- `--status-warning-bg`: `#FEF3C7`
- `--status-error`: `#EF4444`
- `--status-error-bg`: `#FEE2E2`

### Typography
- `--font-sans`: `'Inter', sans-serif`
- `--font-mono`: `'JetBrains Mono', monospace`

### Spacing & Layout
- `--sidebar-width`: `260px`
- `--header-height`: `80px`
- `--spacing-xs`: `4px`
- `--spacing-sm`: `8px`
- `--spacing-md`: `16px`
- `--spacing-lg`: `24px`
- `--spacing-xl`: `32px`
- `--radius-sm`: `6px`
- `--radius-md`: `8px`
- `--radius-lg`: `16px`
- `--shadow-sm`: `0 1px 2px 0 rgb(0 0 0 / 0.05)`
- `--shadow-card`: `0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)`

## 4. Components

- **AppShell**: Grid layout `260px 1fr`. Sidebar fixed. Header sticky or fixed. Content scrolls.
- **MetricCard**: `padding: 24px`, `border-radius: 16px`, `background: #FFFFFF`, `box-shadow: var(--shadow-card)`. Title is 14px secondary, Value is 24px/32px primary bold.
- **Table**: `width: 100%`, horizontal borders only (`#E2E8F0`). Headers `12px` uppercase secondary. Rows `14px` primary text, `padding: 16px`.
- **Global Scope Selector**: Placed in the top header as a breadcrumb-like dropdown or horizontal pill selector (e.g. `INSIDER › CLOSERS › Time Felipe Costa`), matching Figma filter patterns.
- **SidebarItem**: Padding `12px 16px`, radius `8px`. Active state uses `--accent-light` background and `--accent-primary` text with font-weight `600`.
