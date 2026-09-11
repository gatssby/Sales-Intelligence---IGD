# Canonical Reference

Figma URL: https://www.figma.com/design/FbVg7qSPgfKF6KJgI8KYhK/Sales-Analytics-Dashboard--Community-?node-id=1-7432&t=t2P7mBZIHvVDW9TG-1
File key: FbVg7qSPgfKF6KJgI8KYhK
Node ID: 1:7432

## Extraction Method

Figma MCP (`figma-dev-mode-mcp-server`) was explicitly used to fetch structural metadata (`get_design_context`), images (`get_screenshot`), and sub-node trees from the canvas. The data below is strictly factual. The previous guesses (such as 16px radius, #F4F7FE background, and IGD green accent) have been removed.

## Figma Compliance Matrix

| Pattern | Figma (Exact) | Sales Intelligence | Match? | Reason if different |
| :--- | :--- | :--- | :--- | :--- |
| Sidebar width | 256px | 256px | MATCH | |
| Header height | 56px | 56px | MATCH | |
| Card radius | 8px | 8px | MATCH | |
| Card border | 1px solid rgba(0,0,0,0.1) | 1px solid rgba(0,0,0,0.1) | MATCH | |
| Card shadow | (none) | (none) | MATCH | |
| Page background | #ffffff | #ffffff | MATCH | |
| Sidebar background | #f6f6f6 | #f6f6f6 | MATCH | |
| Font family | Inter | Inter | MATCH | |
| Table header text | 12px Medium #7c7c7c | 12px Medium #7c7c7c | MATCH | |
| Table row height | 44px | 44px | MATCH | |
| Metric size | 32px Medium #000000 | 32px Medium #000000 | MATCH | |
| Button radius | 4px | 4px | MATCH | |
| Accent color | #4375ff | #4375ff | MATCH | Explicitly abandoning IGD green to match Figma. |

## 1. Colors (Exact)

- `--color-page`: `#ffffff`
- `--color-surface`: `#ffffff`
- `--color-sidebar`: `#f6f6f6`
- `--color-text-primary`: `#000000`
- `--color-text-secondary`: `#7c7c7c`
- `--color-text-muted`: `#5b5b5b`
- `--color-border`: `rgba(0, 0, 0, 0.1)`
- `--color-accent`: `#4375ff`
- `--color-accent-subtle`: `rgba(67, 117, 255, 0.1)`

## 2. Typography (Exact)

- `--font-ui`: `'Inter', sans-serif`
- `--font-mono`: `'JetBrains Mono', monospace` (Derived for technical data)
- `--font-size-metric`: `32px`
- `--font-size-body`: `14px`
- `--font-size-table`: `13px`
- `--font-size-sm`: `12px`

## 3. Shapes & Geometry (Exact)

- `--radius-card`: `8px`
- `--radius-control`: `4px`
- `--space-card-padding`: `16px`
- `--space-grid-gap`: `24px`
- `--sidebar-width`: `256px`
- `--header-height`: `56px`

## 4. Components

- **AppShell**: Grid with exactly `256px` sidebar. White background page. Top header exactly `56px` tall with a bottom border of `rgba(0,0,0,0.1)`.
- **SidebarItem**: Inactive state is `#f6f6f6` with text `#5b5b5b`. Active state has background `rgba(67,117,255,0.1)` and text `#000000`.
- **Card**: White surface with `1px solid rgba(0,0,0,0.1)` border. Radius `8px`. Padding `16px`. NO SHADOW.
- **Table**: Row height `44px`. Border bottom `rgba(0,0,0,0.1)`. Headers are `12px Medium #7c7c7c`. Data rows are `13px Medium #000000`.
- **Global Scope Selector**: Styled as a compact inline filter bar inside the top header, analogous to Figma filter buttons, utilizing `--radius-control` (4px).

