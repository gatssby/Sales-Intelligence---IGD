# Sylvan Intelligence — Design System

## Brand & Style
This design system establishes an executive-grade, analytical atmosphere. It embodies the precision of institutional asset management with the speed of high-velocity intelligence platforms.

### Aesthetic Foundation
- **Quiet Authority:** Restrained, mature, and unhurried. Relies on sharp typographical hierarchy, immaculate alignment, and subtle tonal nuance to command respect.
- **Architectural Precision:** Every line, margin, and bounding edge aligns mathematically. High data density is balanced by generous micro-spacing.
- **Understated Luxury:** Deep, tailored forest pine contrasts with luminous lime micro-accents and pale chalk substrates.
- **Data Primacy:** Interface scaffolding recedes into the background. Numbers, statuses, signals, and temporal shifts remain the focal point.

## Colors
The color architecture is built around deep organic greens and clean mineral neutrals, illuminated sparingly with an energetic chartreuse-lime spark.

- **Primary Canvas (`#F8FAF9`):** The default operational viewport. An off-white chalk surface that prevents visual fatigue while sustaining high text contrast.
- **Primary Tone (`#102B26`):** Deep Forest Pine. Utilized for dominant executive chrome, primary buttons, high-priority typography, and key data anchor points.
- **Accent Tone (`#C6F56F`):** Luminous Lime. Used exclusively as an intentional micro-accent (1–3% of viewport area): live market indicators, active state flags, positive performance delta pips, and focused states.
- **Muted Green Tint (`#EAF5EE`):** Quiet surface wash for positive alerts, active filters, and subtle table highlight rows.
- **Structural Borders (`#E6ECE8` and `#E2E8F0`):** Whispering dividers. Lines must measure exactly 1px to preserve structural discipline without framing content aggressively.
- **Typography Neutrals:** Headline and metric values render in Slate-900 (`#0F172A`). Secondary intelligence metadata renders in Slate-500 (`#64748B`), and tertiary markers use Slate-400 (`#94A3B8`).

## Typography
- **Newsreader:** Applied exclusively to strategic editorial headlines, brief summary digests, and high-level platform section headers.
- **Plus Jakarta Sans:** The workhorse for interaction, navigation, form elements, table bodies, and relational cards. Provides crisp legibility at small sizes. (Fallback to system sans-serif).
- **JetBrains Mono:** Dedicated strictly to numeric intelligence, deal values, variance percentages, timeline stamps, and tabular figures. (Fallback to monospace).

## Elevation & Depth
- **Surface Level 0 (Canvas):** Base window color `#F8FAF9`.
- **Surface Level 1 (Card & Module Deck):** Solid `#FFFFFF` enclosed by a 1px border (`#E6ECE8`). No drop shadow in resting state.
- **Active Selection Depth:** Active or selected items receive an inner hairline boundary tint of Primary Green (`#102B26`) or a 2px left-hand border accent, rather than surface displacement.

## Components
- **Buttons:** 
  - Primary: Background `#102B26`, text `#F8FAF9`, 1px border `#102B26`.
  - Secondary: Background `#FFFFFF`, text `#102B26`, 1px border `#E6ECE8`.
- **Status Pills:** Height: 22px, padding: 0 8px, border-radius: 9999px. Typography: label-mono.
- **Tabular Grids:** Header rows in uppercase label-mono. Data rows border bottom 1px `#F1F5F3`. Numeric columns right-aligned.
- **Admin Badge:** A quiet micro-pill with low-contrast text and border, visually secondary to commercial KPIs.
