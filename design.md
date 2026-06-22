---
version: alpha
name: AI Image Tool Design System
description: "A calm, work-focused image generation workbench for non-technical users. The UI should feel like a practical desktop tool rather than a marketing page: light neutral canvas, compact but breathable controls, strong operational hierarchy, and image-first feedback. Precision and clarity matter more than decoration."

colors:
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  primary-soft: "#eff6ff"
  on-primary: "#ffffff"
  ink: "#172033"
  ink-muted: "#657085"
  ink-subtle: "#98a2b3"
  canvas: "#f6f7fb"
  surface-1: "#ffffff"
  surface-2: "#f8fafc"
  surface-3: "#eef3f8"
  border: "#d7dee8"
  border-strong: "#bcc7d4"
  focus-ring: "rgba(37,99,235,0.14)"
  success: "#059669"
  success-soft: "#ecfdf5"
  warning: "#d97706"
  warning-soft: "#fff7ed"
  danger: "#dc2626"
  danger-soft: "#fef2f2"
  info: "#0891b2"
  info-soft: "#ecfeff"
  image-stage: "#e8eef6"
  overlay: "rgba(23,32,51,0.08)"

typography:
  display:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0
  heading-lg:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 18px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: 0
  heading-md:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  caption:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  button:
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0

rounded:
  xs: 6px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  section: 48px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 0 14px
    height: 38px
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 0 12px
    height: 38px
    border: "1px solid {colors.border}"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 0 12px
    height: 38px
  icon-button:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: 38px
    border: "1px solid {colors.border}"
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 0 10px
    height: 38px
    border: "1px solid {colors.border}"
  textarea:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
    border: "1px solid {colors.border}"
  select:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 0 10px
    height: 38px
    border: "1px solid {colors.border}"
  panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.border}"
    shadow: "0 10px 30px rgba(23,32,51,0.06)"
    padding: 14px
  panel-soft:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.border}"
    padding: 12px
  upload-zone:
    backgroundColor: "#f9fbff"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    border: "1px dashed {colors.border-strong}"
    minHeight: 64px
    padding: 10px 12px
  timeline-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    borderTop: "1px solid #edf2f7"
    padding: 8px 0
  status-badge:
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    padding: 4px 10px
  image-tile:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    border: "1px solid {colors.border}"
    shadow: "0 8px 24px rgba(23,32,51,0.05)"
  modal:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    border: "1px solid {colors.border}"
    shadow: "0 24px 80px rgba(23,32,51,0.18)"

---

# 1. Visual Theme & Atmosphere

This product is a desktop workbench for image generation, not a showcase site.

The feeling should be:

- calm
- competent
- operational
- image-aware, but not decorative
- friendly to non-technical users

The interface should combine:

- Linear-like precision in spacing and state clarity
- Raycast-like tool discipline and dense utility
- a small amount of creative warmth appropriate for image-making workflows

It should not feel:

- like a SaaS landing page
- like a dark cyberpunk dashboard
- like a colorful creator toy
- like a developer-only control panel

The overall impression is "serious tool, easy to use, visually clean."

# 2. Product-Specific Layout Principles

## First viewport

The first screen must be the actual tool.

No hero.
No marketing introduction.
No oversized tagline block.

The top bar should stay thin and practical:

- product name
- active config switcher
- connection test
- settings

## Main workspace

Desktop main workspace should be two columns:

- left column: prompt, reference images, parameters, primary actions
- right column: current task state, generation details, result preview

Recommended desktop ratio:

- left column: 44% to 47%
- right column: 53% to 56%

Do not make either side visually dominant when empty.

The left column should be sticky on desktop so users can scroll history without losing controls.

## Result behavior

The result area should adapt to realistic usage:

- when 1 image is generated, center it in a strong preview frame
- when 2 images are generated, show a balanced 2-column preview
- when 3-4 images are generated, use a tighter grid

Fresh results should feel larger and more important than gallery history.

## Gallery band

The gallery is a secondary band below the workspace.
It should feel like history storage, not the primary focus.

Make it denser than the fresh result area.

# 3. Color Palette & Roles

## Core palette

- Canvas: pale neutral blue-gray, never pure gray
- Surface: clean white panels
- Ink: deep navy-charcoal, not pure black
- Border: cool low-contrast blue-gray

## Accent usage

Use one main accent:

- primary blue for main actions, focus, selected states, and progress emphasis

Use semantic accents sparingly:

- green for success
- amber for waiting, queueing, or caution
- red for destructive and failed states
- cyan only for informational, non-primary feedback

## Important guardrail

Do not let the UI become a purple-first or navy-first theme.
This product should feel lighter, clearer, and more neutral than typical AI tools.

# 4. Typography Rules

Use a modern system sans stack that renders well in Chinese and English:

- Segoe UI
- PingFang SC
- Microsoft YaHei
- Arial fallback

Typography hierarchy:

- product title: compact, confident, not theatrical
- section title: 16-18px
- body: 14px
- helper and state text: 12-13px

Never use giant display typography inside the working UI.

Keep labels short.
Prefer one-line labels over explanatory paragraphs.

All user-facing primary UI copy should be Simplified Chinese.

# 5. Component Styling Rules

## Inputs

Inputs should feel stable and readable:

- height: 38px standard controls
- radius: 8px to 10px
- subtle border
- stronger focus ring, not thicker border alone

Textareas should be the most visually important control in the left column.

Prompt textarea:

- visually largest input
- minimum height around 150-180px
- generous padding

Negative prompt textarea:

- clearly secondary
- smaller height

## Buttons

Primary button:

- solid blue
- strong text contrast
- slightly heavier weight

Secondary buttons:

- white surface
- visible border
- no ghost-only critical actions

Destructive actions should not look equal to Generate.

## Status chips

Use compact pill badges for:

- preparing
- generating
- queued
- success
- failed
- cancelled

These should read clearly at a glance without dominating the layout.

## Timeline / generation details

The generation detail panel should be factual and compact.

Show real stages such as:

- task created
- submitting request
- waiting for provider
- polling task status
- switching fallback config
- results returned
- cancelled

Do not fake exact percentages unless the provider truly returns them.

## Image tiles

Generated image cards should prioritize the image itself:

- clear aspect-ratio frame
- small metadata area
- compact action row

The image should visually dominate.
The controls should support it, not compete with it.

# 6. Layout Density & Spacing

This tool should be moderately dense.

Target feeling:

- tighter than a marketing site
- looser than a data grid dashboard

Spacing rhythm:

- 8px for micro gaps
- 10-12px for field groups
- 14-16px for panel padding
- 20-24px between larger sections

Avoid large dead zones.
Avoid giant empty preview containers.

# 7. Depth & Elevation

Use low, consistent depth:

- 1px cool border
- soft shadow only on primary panels and modals

Do not stack cards inside cards without reason.

The page should feel layered by panel hierarchy, not by heavy shadows.

# 8. Responsive Behavior

## Desktop

- two-column workspace
- sticky compose panel
- image result sizing adapts by image count

## Tablet

- collapse into one column
- keep result area above gallery
- preserve strong spacing and touch targets

## Mobile

- one-column flow
- top bar controls can wrap
- prompt and generate action stay easy to reach
- timeline collapses naturally into a simple stacked list

Minimum touch target:

- 36px absolute minimum
- 40px preferred for common actions

# 9. Do's

- Do make the prompt area feel like the core action surface.
- Do make results feel valuable but not oversized when only one image exists.
- Do show operational state clearly and honestly.
- Do keep the page bright, neutral, and calm.
- Do prefer icon-plus-label actions where clarity improves.
- Do center fresh results with disciplined spacing.
- Do let reference images feel like a tray, not a giant gallery.
- Do make advanced controls visually quieter than core controls.

# 10. Don'ts

- Don't build a landing page.
- Don't use gradient blobs, neon glows, or decorative background effects.
- Don't make every section look like an isolated floating card.
- Don't use oversized rounded corners.
- Don't make the result panel huge when there is no result.
- Don't rely on long explanatory UI text in the main workspace.
- Don't fake progress percentages.
- Don't use a purple-dominant AI aesthetic.
- Don't overuse dark surfaces in a mostly light productivity tool.

# 11. Screen-by-Screen Intent

## Prompt and parameter panel

This panel should answer:

- what do I want to generate
- what references am I giving
- what model constraints matter
- what do I click next

It should feel focused and stable.

## Current task panel

This panel should answer:

- what is happening right now
- is the task still running
- did the provider accept it
- did it switch config
- did it fail for a clear reason

It should feel truthful, not dramatic.

## Fresh result panel

This panel should answer:

- what just came back
- which image should I keep, retry, or reuse

It should feel more curated than the gallery.

## Gallery history

This panel should answer:

- what have I already generated
- what can I search, download, reuse, or delete

It should feel efficient and slightly denser than the current-result area.

# 12. Agent Prompt Guide

When redesigning or extending this project, use prompts like:

- "Restyle the app to match design.md: calm light productivity workbench, compact controls, image-first result panel, no marketing layout."
- "Refine the prompt sidebar using design.md: stronger textarea hierarchy, tighter field groups, sticky primary actions."
- "Update the result area using design.md: center 1-image results, balanced 2-image layout, denser gallery history below."
- "Apply design.md to status feedback: factual generation timeline, compact stage badges, no fake percentage progress."

Short visual reference:

- mood: calm, precise, operational
- theme: light neutral productivity UI
- accent: one disciplined blue
- density: medium, work-focused
- result treatment: image-first, not oversized
- anti-pattern: no hero, no purple AI gloss, no decorative gradients
