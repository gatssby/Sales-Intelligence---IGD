# Canonical Reference

Figma URL: https://www.figma.com/design/FbVg7qSPgfKF6KJgI8KYhK/Sales-Analytics-Dashboard--Community-?node-id=1-7432&t=t2P7mBZIHvVDW9TG-1
File key: FbVg7qSPgfKF6KJgI8KYhK
Node ID: 1:7432

## Visual authority

The repository defines what Sales Intelligence does. The canonical Figma defines what Sales Intelligence looks like.

Before introducing or changing frontend visual patterns:

1. read this document;
2. inspect the canonical Figma through Figma MCP when visual behavior is uncertain;
3. reuse the existing tokens, icons and primitives before adding a new pattern;
4. do not introduce a parallel visual language for an individual page.

Do not use the former Sylvan styling, generic SaaS conventions or IGD green as visual authority. When Figma MCP is available, verify the source rather than approximating dimensions or tokens from memory.

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
- header identity radius: `6px`
- sidebar workspace avatar: `36px` with `23px` radius
- top-header account avatar: `24px` with `23px` radius
- `--space-card-padding`: `16px`
- `--space-grid-gap`: `24px`
- `--sidebar-width`: `256px`
- `--header-height`: `56px`
- sidebar/header/navigation icons: `20px`
- sidebar navigation row: `32px`
- analytics table header: `40px`
- analytics table row: `44px`
- canonical dashboard content frame: `1110px`

## 4. Components

- **AppShell**: Grid with exactly `256px` sidebar. White background page. Top header exactly `56px` tall with a bottom border of `rgba(0,0,0,0.1)`.
- **SidebarItem**: Inactive state is `#f6f6f6` with text `#5b5b5b`. Active state has background `rgba(67,117,255,0.1)` and text `#000000`.
- **Card**: White surface with `1px solid rgba(0,0,0,0.1)` border. Radius `8px`. Padding `16px`. NO SHADOW.
- **Table**: Row height `44px`. Border bottom `rgba(0,0,0,0.1)`. Headers are `12px Medium #7c7c7c`. Data rows are `13px Medium #000000`.
- **Global Scope Selector**: Styled as a compact inline filter bar inside the top header, analogous to Figma filter buttons, utilizing `--radius-control` (4px).
- **Icons**: Use the single exported Figma-compatible family in `apps/web/public/icons/figma/` through the shared `Icon` component. Active navigation retains the same glyph and changes treatment through the selected surface; do not mix unrelated icon families or Unicode symbols.
- **Interaction states**: Hover and focus may increase border/accent contrast or move a control by at most one pixel. Selected navigation uses the canonical blue wash. Motion remains short and functional; no decorative page animation.
- **Charts**: Use canonical blue for the primary series, pale neutral tracks/grid, compact labels and direct values. Charts must be backed by real read-model data; do not synthesize points to fill space.

## 5. Classification of implementation values

### EXACT

- Base colors, borders, typography sizes, sidebar/header dimensions, component radii, 20px icon sizing, 16px card padding and 24px analytical gaps above were extracted directly from nodes `1:7432`, `1:7433`, `1:13096`, `1:7563`, `1:7568`, and `1:13282` with Figma MCP.
- Navigation glyphs in `apps/web/public/icons/figma/` are the exported vector assets from the canonical sidebar/header, committed locally because MCP asset URLs expire.
- Selected navigation uses the reference blue tint; analytical surfaces use white, hairline black-alpha borders and no heavy card shadow.

### DERIVED

- Status success, warning and error colors are restrained semantic extensions for operational states not represented by the commerce dashboard. They use pale surfaces, compact geometry and low saturation so blue remains the only primary product accent.
- Avatar initials are derived from already-authorized person names because the current read model does not provide profile photos.
- Horizontal score bars and recent-call mini bars are rendered from existing PostgreSQL scores. They borrow the Figma chart grid/accent treatment without fabricating time-series values.

### DELIBERATE DEVIATION

- The Figma has commerce-specific product thumbnails and a world map. Sales Intelligence replaces these with organization avatars, score bars and real call tables because equivalent media/geography is not present in the product data.
- The canonical 44px table row grows slightly when a row needs a 28px avatar plus two lines of identity; high-density call rows remain compact and horizontally scroll at narrow desktop widths.
- At 1024px and below, the fixed 256px sidebar narrows to 232px and scope fields compress so the real four-level selector remains usable. At the primary 1280–1920 targets, the canonical 256px sidebar is preserved.
- Metric cards add a small Figma-family icon container and faint circular ornament. This applies the reference icon/shape grammar to Sales Intelligence entities while keeping the exact card border, radius, spacing and primary type scale.

## 6. Safe local visual review

The dashboard requires the existing loopback PostgreSQL tunnel. The authentication bypass is development-only and is ignored whenever `NODE_ENV=production`.

Terminal 1:

```bash
ssh -N -L 5433:127.0.0.1:5432 oracle-vps
```

Terminal 2:

```bash
cd "/Users/gatsby/Workspace/Sales Intelligence - IGD" && DEV_AUTH_BYPASS=true npm run dev
```

Then open `http://localhost:3000`. Never configure `DEV_AUTH_BYPASS=true` in production.
