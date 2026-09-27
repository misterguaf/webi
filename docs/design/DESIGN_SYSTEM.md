# Gestió — Design System

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5

---

## 1. Purpose

This document defines the shared visual language of Gestió.

It translates `DESIGN_VISION.md` into reusable rules and tokens.

All Gestió screens must use this system.

Do not create screen-specific colours, spacing scales, shadows, radii or
control styles unless a genuine product requirement justifies it.

The goal is consistency.

---

## 2. Design principles

Gestió should feel:

- native;
- precise;
- calm;
- premium;
- responsive;
- young without looking childish;
- technological without looking futuristic.

Core rule:

80% CLARITY
20% MAGIC

Visual effects must support hierarchy and interaction.

---

# 3. Colour system

Gestió uses the IRIS colour identity.

The interface is predominantly neutral.

Iris is used as an accent, not as the background language of the whole
application.

Never hardcode colour values directly inside components.

Use semantic design tokens.

---

## 3.1 Light mode

### Neutral surfaces

--bg-primary:       #F6F7FB
--surface-primary:  #FFFFFF
--surface-elevated: #EFF0F6
--border-default:   #D9DBE7

### Text

--text-primary:     #171821
--text-secondary:   #6D7080

### Iris

--iris-primary:     #6E5CF5
--iris-strong:      #5946E8
--iris-soft:        #EDEAFF
--iris-glass-tint:  #F4F2FF

---

## 3.2 Dark mode

Dark mode uses graphite surfaces rather than pure black.

### Neutral surfaces

--bg-primary:       #0E0F13
--surface-primary:  #161821
--surface-elevated: #1D202B
--border-default:   #303343

### Text

--text-primary:     #F6F7FB
--text-secondary:   #A7AABC

### Iris

--iris-primary:     #8E7DFF
--iris-strong:      #A394FF
--iris-soft:        #292347
--iris-glass-tint:  #1A1B24

---

## 3.3 Semantic colours

Semantic colours communicate meaning.

They are not decorative branding colours.

### Light

--success: #2F9E73
--warning: #D4932E
--danger:  #D45B66
--info:    #4A78E8

### Dark

--success: #55C79B
--warning: #F0B85A
--danger:  #FF7C88
--info:    #75A0FF

Meaning must never depend on colour alone.

Use text, labels, icons or other state indicators as well.

---

# 4. Typography

Gestió uses a system-first typography stack.

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "SF Pro Text",
  "Inter",
  "Segoe UI",
  sans-serif;
```

Do not bundle proprietary Apple font files.

macOS should naturally render Gestió using the system San Francisco family.

---

## 4.1 Typography scale

### Display

Large dashboard greeting or exceptional page title.

Font size: 32px
Line height: 38px
Weight: 650

Use sparingly.

### Page title

Font size: 26px
Line height: 32px
Weight: 650

### Section title

Font size: 20px
Line height: 26px
Weight: 600

### Card title

Font size: 15px
Line height: 20px
Weight: 600

### Body

Font size: 14px
Line height: 20px
Weight: 400

### Small body

Font size: 13px
Line height: 18px
Weight: 400

### Label

Font size: 12px
Line height: 16px
Weight: 550

### Metadata

Font size: 11px
Line height: 15px
Weight: 500

---

## 4.2 Typography rules

Avoid excessive bold text.

Use hierarchy through:

- size;
- spacing;
- colour;
- position;

before increasing font weight.

Do not use uppercase headings for normal interface hierarchy.

Numbers in financial and metric contexts should align cleanly and remain easy
to scan.

---

# 5. Spacing

Gestió uses a 4px base spacing system.

Tokens:

--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
--space-10: 40px
--space-12: 48px
--space-16: 64px

Prefer these values instead of arbitrary spacing.

---

## 5.1 Layout rhythm

Typical component internal padding:

Compact:
12px

Default:
16px

Comfortable:
20px

Large:
24px

Major page sections should normally use 24–40px separation.

Desktop layouts should feel spacious without wasting screen real estate.

---

# 6. Border radius

Gestió uses rounded geometry inspired by modern macOS applications.

Do not make every object excessively rounded.

Tokens:

--radius-small:   8px
--radius-control: 10px
--radius-card:    14px
--radius-large:   18px
--radius-panel:   22px
--radius-pill:    999px

Usage:

8px:
small controls and internal elements

10px:
buttons, inputs, compact interactive controls

14px:
standard cards

18px:
large cards and important containers

22px:
floating panels, command palette and premium surfaces

999px:
badges, segmented indicators and true pill controls

---

# 7. Surface hierarchy

Gestió uses a small number of clearly defined depth levels.

LEVEL 0
Application background

LEVEL 1
Primary content surface

LEVEL 2
Elevated content

LEVEL 3
Floating / glass interface

LEVEL 4
Modal or command surface

Depth should be communicated using a combination of:

- surface tone;
- border;
- blur;
- subtle shadow;
- relative position.

Avoid large dramatic shadows.

---

# 8. Shadows

Shadows must remain soft and realistic.

They should suggest depth rather than decoration.

### Light mode

Low:
0 1px 2px rgba(20, 20, 35, 0.04)

Medium:
0 6px 20px rgba(20, 20, 35, 0.08)

Floating:
0 16px 48px rgba(20, 20, 35, 0.14)

### Dark mode

Dark mode should rely less on conventional shadow.

Use:

- tonal separation;
- soft borders;
- translucency;
- subtle light reflections.

Strong black drop-shadows should be avoided.

---

# 9. Glass material

Glass is a premium interface layer.

It must not become the default material for all content.

---

## 9.1 Preferred uses

Strong glass:

- sidebar;
- command palette;
- popovers;
- contextual floating controls;
- selected overlays;
- modal surfaces;
- floating drawers.

Subtle glass:

- selected dashboard metrics;
- important quick actions;
- special transient states.

Prefer solid surfaces for:

- tables;
- long forms;
- dense lists;
- financial records;
- large reading surfaces.

---

## 9.2 Glass characteristics

Glass may combine:

- translucent background;
- backdrop blur;
- subtle saturation;
- 1px translucent border;
- very soft internal highlight;
- restrained Iris tint.

Avoid:

- excessive blur;
- strong gradients;
- permanent glow;
- visually noisy transparency.

Content behind glass must never reduce readability.

---

# 10. Focus and selection

Focus must be obvious but elegant.

Primary keyboard focus should use an Iris focus ring.

Suggested behaviour:

2px ring
+
small external offset

Focus must never rely only on a background colour change.

Selected navigation should combine:

- Iris tint;
- icon state;
- text emphasis;
- optional subtle material change.

---

# 11. Buttons

There are four main button categories.

PRIMARY

Use Iris.

For the most important action in the current context.

Examples:

Guardar
Confirmar pagament
Publicar activitat

Do not place multiple competing primary buttons together.

SECONDARY

Neutral surface with border.

Used for normal alternative actions.

TERTIARY

Minimal or transparent.

Used for low-priority actions.

DESTRUCTIVE

Uses semantic danger colour.

Never use Iris for destructive actions.

---

## 11.1 Button behaviour

Buttons must define:

- default;
- hover;
- active;
- focus;
- disabled;
- loading.

Typical desktop height:

36px

Compact control:

30–32px

Important action:

40px

Do not use oversized marketing-style buttons inside Gestió.

---

# 12. Inputs

Inputs should feel native and compact.

Default height:

36–40px

They should use:

- clear label;
- subtle border;
- neutral surface;
- Iris focus state;
- readable validation feedback.

Do not depend exclusively on placeholders.

Errors should explain what needs correction.

---

# 13. Cards

Cards are containers, not decoration.

Every card should represent a coherent unit of information or action.

Avoid dashboard layouts made entirely from unnecessary cards.

---

## 13.1 Standard card

Radius:
14px

Padding:
16–20px

Surface:
solid or nearly solid

Border:
subtle

Shadow:
none or low

---

## 13.2 Interactive card

Interactive cards may:

- lift very slightly;
- change border;
- reveal quick actions;
- transition into a detail view.

Hover motion should remain restrained.

---

## 13.3 Metric card

Metric cards should prioritise:

1. value;
2. meaning;
3. relevant change/context.

Do not overload them with decoration.

Selected high-value metrics may use subtle Iris material or glass.

---

# 14. Tables and dense data

Tables are important in Gestió.

Do not replace useful desktop tables with cards simply for visual style.

Tables should support:

- clear row hierarchy;
- comfortable scanning;
- sticky headers when appropriate;
- compact status indicators;
- contextual row actions;
- selected state;
- keyboard accessibility.

Rows should not feel boxed individually unless required.

Use whitespace and subtle separators.

On mobile, tables may transform into structured cards when horizontal
compression would damage usability.

---

# 15. Status badges

Statuses should use compact badges.

Examples:

PAGAT
PENDENT
PARCIAL
INCIDÈNCIA

Badges should combine:

- semantic colour;
- text;
- optional icon.

Do not use bright solid backgrounds unnecessarily.

Prefer soft tinted surfaces.

---

# 16. Icons

Gestió should use a single coherent icon language.

Desired qualities:

- simple;
- geometric;
- precise;
- slightly soft;
- visually compatible with macOS.

Icons should generally use strokes rather than heavy fills.

Standard sizes:

16px
18px
20px
24px

Avoid mixing unrelated icon libraries without visual normalization.

A custom Gestió icon subset may be created later.

---

# 17. Sidebar

The sidebar is a signature Gestió surface.

It should feel integrated with the application rather than attached to it.

Desktop characteristics:

- translucent/glass material;
- compact;
- collapsible;
- clear selected state;
- persistent icon identity;
- tooltip support when collapsed.

It must not become visually dominant over the content.

Exact behaviour belongs in `screens/SHELL.md`.

---

# 18. Command palette

The command palette is a premium interaction surface.

It may use stronger glass and depth than normal content.

It should feel:

- instant;
- focused;
- keyboard-first;
- elegant.

Opening it should visibly shift the application into a temporary search mode.

Exact motion belongs in `MOTION_SYSTEM.md`.

---

# 19. Light / dark relationship

Light and dark are two expressions of the same product.

They share:

- hierarchy;
- spacing;
- geometry;
- typography;
- components;
- interaction rules.

They may differ in:

- perceived depth;
- transparency;
- reflections;
- shadow strategy;
- intensity of Iris material.

Dark mode may be more visually dramatic.

It must remain equally professional.

---

# 20. Responsive system

Gestió is desktop-first and mobile-complete.

Suggested layout ranges:

Desktop:
>= 1180px

Compact desktop / tablet landscape:
768–1179px

Mobile:
< 768px

Breakpoints are implementation guidance, not absolute visual rules.

Use content behaviour to determine final transitions.

---

## 20.1 Mobile principles

Do not simply shrink desktop.

On mobile:

- multi-column layouts may become sequential;
- tables may become structured cards;
- sidebar may become compact navigation;
- drawers may become full-height sheets;
- actions must remain touch-accessible.

Minimum interactive touch target should generally approach 44px where mobile
context requires it.

All important workflows must remain possible.

---

# 21. Accessibility

Minimum expectations:

- keyboard navigation;
- visible focus;
- sufficient contrast;
- semantic status beyond colour;
- readable text sizes;
- appropriate touch targets;
- reduced motion;
- reduced transparency where supported.

Visual polish never overrides accessibility.

---

# 22. Implementation rules

Do not:

- hardcode arbitrary colours;
- invent new spacing values without reason;
- create one-off radii;
- create screen-specific shadows;
- introduce unrelated visual systems;
- use gradients as decoration by default;
- use glass everywhere;
- recreate existing shared components unnecessarily.

Prefer reusable tokens.

---

# 23. Current system status

Version 0.1 is intentionally not frozen.

The first implementation of the Gestió shell will validate:

- Iris in real UI;
- surface hierarchy;
- typography scale;
- sidebar material;
- light/dark relationship;
- spacing density;
- radius scale.

Minor token adjustments after visual testing are expected.

Major changes to the design language should update this document first.
