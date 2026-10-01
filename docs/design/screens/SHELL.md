# Gestió — Application Shell

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5
Depends on:

- ../DESIGN\_VISION.md
- ../DESIGN\_SYSTEM.md
- ../MOTION\_SYSTEM.md
- ../UX\_RULES.md

---

## 1. Purpose

This document defines the shared application shell of Gestió.

The shell includes:

- primary navigation;
- sidebar;
- page frame;
- page header;
- global search access;
- profile and theme access;
- desktop/tablet/mobile behaviour;
- shell-level materials;
- shell-level motion.

It does not define the internal content of individual modules.

All Gestió screens must live inside this shell unless a future workflow has a
strong reason not to.

---

# 2. Core concept

Gestió should feel like a desktop application rather than a website with a
navigation menu.

The shell must feel:

- persistent;
- calm;
- premium;
- spatially coherent;
- fast;
- visually light.

The content changes.

The application itself remains.

The shell should never compete with the information being managed.

---

# 3. Desktop structure

The primary desktop layout is:

SIDEBAR
\+
CONTENT AREA

Gestió does not use a permanent full-width SaaS-style topbar.

Each page owns its own contextual header inside the content area.

Conceptual structure:

┌───────────────┬──────────────────────────────────────────────┐
│               │                                              │
│   SIDEBAR     │  PAGE HEADER                                 │
│               │                                              │
│               │  PAGE CONTENT                                │
│               │                                              │
│               │                                              │
│               │                                              │
└───────────────┴──────────────────────────────────────────────┘

The sidebar is the primary persistent navigation surface.

---

# 4. Sidebar dimensions

Expanded desktop width:

248px

Collapsed desktop width:

72px

The width may receive minor adjustment during visual implementation if needed,
but these values are the initial design target.

The sidebar must not feel oversized.

---

# 5. Sidebar material

The sidebar is one of the signature Gestió materials.

It should use controlled glass.

Light mode:

- high-opacity translucent neutral;
- subtle backdrop blur;
- very light border;
- almost invisible reflection;
- low shadow;
- Iris only in active states.

Dark mode:

- deep translucent graphite;
- stronger perception of depth;
- subtle blur;
- soft internal highlight;
- faint Iris influence where appropriate;
- no excessive glow.

The sidebar must remain readable even when transparency is reduced.

---

# 6. Sidebar structure

Desktop sidebar is divided into three logical zones.

## Top

Brand / application identity.

## Middle

Primary navigation.

## Bottom

Search, profile and account controls.

Conceptually:

┌────────────────────────┐
│                        │
│  [Logo]  Gestió        │
│                        │
│  Inici                 │
│  Activitats            │
│  Inscripcions          │
│  Quotes                │
│  Participants          │
│  Incidències           │
│  Administració         │
│                        │
│                        │
│  Buscar            ⌘K  │
│                        │
│  [avatar] Usuari       │
│           Rol          │
│                        │
└────────────────────────┘

Exact icons will be defined later.

Do not lock the implementation to placeholder icons.

---

# 7. Brand area

Expanded sidebar:

- Parpalló logo;
- Gestió label.

Collapsed sidebar:

- logo remains;
- Gestió label disappears.

The transition must use `MOTION 02 — Sidebar Collapse`.

Do not shrink the logo into an illegible miniature.

The brand area should remain calm and relatively compact.

---

# 8. Primary navigation

Initial information architecture:

- Inici
- Activitats
- Inscripcions
- Quotes
- Participants
- Incidències
- Administració

This list may evolve as functional phases are added.

Navigation labels shown to users are Valencian.

---

## 8.1 Active navigation state

The active destination should be immediately recognisable.

Use a combination of:

- subtle Iris surface;
- Iris or emphasized icon;
- stronger text;
- optional material/border change.

Do not use a large bright purple block.

Active state should feel refined rather than loud.

---

## 8.2 Navigation attention indicators

Badges may appear only when operationally useful.

Examples:

Incidències · 3

Inscripcions · 7

3.5F: the Inscripcions count comes from `GET /api/registrations/queue/summary`
(registrations the user can act on + payments pending + payment incidences);
no badge at 0; sessions that can neither review nor verify do not see the item.

Do not badge normal navigation simply to create visual activity.

Attention states must follow `UX_RULES.md`.

---

# 9. Collapsed sidebar

When collapsed:

- width becomes approximately 72px;
- icons remain centred;
- labels disappear;
- selected state remains obvious;
- hover/focus exposes tooltip;
- logo remains identifiable;
- search remains accessible;
- profile remains accessible.

Labels should fade before or during width reduction.

Do not abruptly clip text.

Use:

`MOTION 02 — Sidebar Collapse`

---

# 10. Sidebar collapse control

The sidebar may expose a subtle collapse control.

It should not visually dominate the interface.

Possible placement:

- sidebar edge;
- near brand area;
- contextual on hover.

Do not use a large permanent button.

The user's preference may be persisted locally.

---

# 11. Page content area

The content area starts immediately beside the sidebar.

It should not look like a separate webpage embedded inside the application.

Use the application background directly.

Typical desktop page padding:

32px

Compact desktop/tablet:

24px

Mobile:

16px

Large desktop may use slightly more breathing room if the page benefits from it.

---

# 12. Content width

Gestió must not stretch all content to the entire monitor.

Use contextual width constraints.

Suggested categories:

## Narrow

Forms, focused workflows, simple detail.

Approximate maximum:

720–800px

## Standard

Participant details, operational screens, dashboard sections.

Approximate maximum:

1100–1200px

## Wide

Tables, financial management, complex operational data.

Approximate maximum:

1400–1500px

## Full available width

Only when the content genuinely benefits from it.

Do not use one universal `max-width`.

---

# 13. Page header

Gestió does not use a global permanent topbar.

Every page includes its own contextual header inside the content area.

Desktop layout:

PAGE TITLE                         PRIMARY / SECONDARY ACTIONS
Context / subtitle

Example:

Quotes                              [Nova acció]
Seguiment de les quotes anuals

Page header should include only controls relevant to the current context.

---

## 13.1 Page title

Use `Page title` typography from `DESIGN_SYSTEM.md`.

Title should normally remain short.

Examples:

Inici
Activitats
Quotes
Participants

---

## 13.2 Subtitle

Optional.

Use for:

- context;
- period;
- explanation;
- selected section.

Do not add subtitles mechanically to every page.

---

# 14. Contextual actions

Primary page actions belong in the page header when appropriate.

Examples:

- Nova activitat
  Exportar
  Crear...

Only one strong primary action should normally compete for attention.

Secondary actions may use neutral controls or contextual menus.

---

# 15. Global search

Global search is accessible from the sidebar.

Expanded:

Buscar                          ⌘K

Collapsed:

search icon

Keyboard:

⌘K

Search opens the Gestió command palette.

Use:

`MOTION 06 — Command Palette`

The search interaction should visually float above the shell.

The sidebar remains visible behind the temporary search context.

---

# 16. Profile area

The bottom of the sidebar contains current-user identity.

Expanded state may show:

[Avatar / initials]

Name
Primary role / context

Example:

BM
Borja
Coordinació

Do not display unnecessary account information permanently.

---

# 17. Profile popover

Clicking the profile area opens a glass popover.

Potential options:

- Perfil
- Preferències
- Tema
- Tancar sessió

Theme selection:

Sistema
Clar
Fosc

Do not place permanent theme toggle buttons in the sidebar.

Use the popover to keep the shell visually clean.

Popover uses:

`MOTION 07 — Popover / Context Menu`

---

# 18. Theme behaviour

Default:

Sistema

Available:

- Sistema
- Clar
- Fosc

Theme changes use:

`MOTION 14 — Theme Transition`

The user's explicit selection should persist.

If set to Sistema, follow the operating system preference.

---

# 19. Light mode shell

Light Gestió should feel extremely luminous and precise.

Expected shell characteristics:

- soft neutral app background;
- white / cool-neutral content surfaces;
- sidebar with restrained glass;
- subtle Iris active navigation;
- minimal visible shadow;
- excellent contrast.

Avoid pure white everywhere.

Use gentle surface distinction.

---

# 20. Dark mode shell

Dark mode should provide the more visually impressive expression of Gestió.

Expected characteristics:

- deep graphite application background;
- floating surface hierarchy;
- rich but controlled sidebar glass;
- subtle reflections;
- fine translucent borders;
- Iris/lavender active accents;
- excellent text contrast.

The result should feel premium and technological.

It must not become neon, cyberpunk or gaming-oriented.

---

# 21. Desktop breakpoints

Initial design behaviour:

## Large desktop

> \= 1180px

Default:

sidebar expanded.

User may collapse manually.

---

## Compact desktop / tablet landscape

768px–1179px

Default:

sidebar may begin collapsed.

Icon rail remains available where appropriate.

Content density adapts.

No bottom navigation yet unless the available width genuinely requires it.

---

## Mobile

< 768px

Desktop sidebar disappears.

Mobile shell uses bottom navigation.

---

# 22. Mobile shell

Mobile is a deliberate Gestió interface.

It is not desktop compressed into a narrow viewport.

Primary structure:

PAGE HEADER

CONTENT

BOTTOM NAVIGATION

---

# 23. Mobile bottom navigation

Initial destinations:

Inici
Activitats
Quotes
Participants
Més

Conceptually:

┌──────────────────────────────────┐
│                                  │
│          PAGE CONTENT            │
│                                  │
├──────────────────────────────────┤
│  ⌂      ◇      €      ♙      ••• │
│ Inici Activ. Quotes Partic. Més  │
└──────────────────────────────────┘

Actual iconography will be refined later.

---

## 23.1 Why these destinations

These destinations represent frequent high-level operational areas.

Secondary areas move into `Més`.

Potential `Més` destinations:

- Inscripcions
- Incidències
- Administració
- Buscar
- Perfil
- Preferències

The exact ordering may be adjusted after real usage.

---

# 24. Mobile bottom navigation material

Bottom navigation may use controlled glass.

Light:

- high-opacity translucent light material;
- clear top separation;
- excellent icon contrast.

Dark:

- deep glass;
- soft border;
- subtle reflection.

Respect device safe areas.

On iPhone-class devices, account for bottom safe-area inset.

---

# 25. Mobile selected state

Selected destination should use:

- Iris icon;
- stronger label;
- subtle local material or indicator.

Avoid large animated pills moving dramatically between destinations.

Motion should remain refined.

---

# 26. Mobile page header

Mobile page headers should be simplified.

Typical structure:

Page title                    [Action]

Optional context below.

Do not reproduce a full desktop action toolbar.

Lower-priority actions may move into a contextual `•••` menu.

---

# 27. Mobile search

There is no keyboard `⌘K` dependency on mobile.

Search should be accessible through:

- visible search action where relevant;
- `Més`;
- optionally a global search icon in suitable page headers.

It opens a mobile-adapted version of the command palette.

Possible mobile presentation:

full-screen search sheet.

Search capabilities remain identical to desktop.

---

# 28. Tablet behaviour

Tablet should not be treated as an oversized phone automatically.

Landscape tablet may use:

collapsed desktop rail
\+
desktop-style content.

Portrait tablet may use:

compact navigation
or
mobile-style navigation depending on usable width.

Content behaviour should determine the breakpoint rather than device identity.

---

# 29. Responsive information priority

When available width decreases, preserve:

1. identity;
2. state;
3. primary action;
4. critical context;
5. secondary metadata.

Do not solve layout pressure by shrinking typography excessively.

---

# 30. Mobile data structures

Complex desktop tables may become:

- grouped cards;
- compact lists;
- expandable rows;
- sequential detail screens.

The underlying actions must remain available.

No core workflow may require desktop.

---

# 31. Shell motion

Initial shell implementation should support:

### Sidebar collapse

`MOTION 02`

### Primary navigation change

`MOTION 03`

### Command palette

`MOTION 06`

### Profile popover

`MOTION 07`

### Theme switching

`MOTION 14`

Do not introduce other signature motion during the first shell implementation.

---

# 32. Navigation transition

The shell must remain persistent.

When changing primary sections:

sidebar:
unchanged

application background:
unchanged

page content:
transitions subtly

Use:

`MOTION 03 — Navigation Context Shift`

Do not animate the entire application.

---

# 33. Reduced motion

With:

`prefers-reduced-motion: reduce`

Disable or simplify:

- spatial page travel;
- sidebar text movement;
- scale effects;
- spring behaviour.

Preserve:

- state clarity;
- immediate visibility changes;
- minimal opacity where useful.

---

# 34. Reduced transparency

Glass must have a robust opaque fallback.

When transparency is reduced:

- sidebar becomes more opaque;
- bottom navigation becomes more opaque;
- command surfaces preserve hierarchy;
- contrast remains strong.

No feature may depend on blur to remain understandable.

---

# 35. Loading shell

The application shell should become available immediately.

Do not hide the entire application behind a loading screen unless session
initialisation makes it technically unavoidable.

Preferred:

shell visible
\+
content loading independently.

Persistent navigation should not repeatedly reload between sections.

---

# 36. Authorization and navigation

Navigation visibility may reflect permissions.

Examples:

A user without treasury access may not see financial management destinations
that provide no useful read capability.

However:

UI visibility is not authorization.

All authorization remains server-side.

Do not implement access control exclusively through navigation hiding.

---

# 37. Privacy

The shell itself should contain minimal personal information.

Profile area may show:

- user's display name;
- role/context;
- initials/avatar.

Do not show unnecessary personal or sensitive information in global UI.

---

# 38. Accessibility

Shell requirements:

- full keyboard navigation;
- clear focus states;
- tooltips for collapsed navigation;
- semantic labels for icon-only buttons;
- sufficient contrast;
- touch-accessible mobile navigation;
- logical focus return from popovers;
- screen-reader understandable active navigation.

Sidebar collapse must not remove access to any destination.

---

# 39. Iconography

Initial implementation may use a coherent professional icon library.

Requirements:

- single visual family;
- consistent stroke weight;
- approximately 18–20px for sidebar;
- simple geometry;
- no emoji;
- no mixed icon styles.

A custom Gestió icon subset may be created later.

Do not delay the shell solely to create custom icons.

---

# 40. Visual restraint

The shell should contain very little decorative content.

Do not use:

- large gradients;
- abstract blobs;
- decorative background illustrations;
- constant glow;
- oversized logos;
- multiple competing glass layers.

The quality should come from:

- geometry;
- typography;
- spacing;
- material;
- motion;
- consistency.

---

# 41. First implementation acceptance criteria

The first shell implementation is successful when:

1. Gestió immediately feels different from the current generic internal UI.
2. The sidebar feels premium but unobtrusive.
3. Light mode feels luminous and professional.
4. Dark mode feels deep, premium and visually impressive.
5. Iris is recognisable but not dominant.
6. Navigation is immediately understandable.
7. Collapse feels polished.
8. Content has sensible maximum widths.
9. Mobile feels intentionally designed.
10. No current backend behaviour needs to change.
11. Existing functionality is not removed.
12. Reduced-motion behaviour works.
13. The shell feels fast.

---

# 42. First implementation scope

The first Codex implementation should focus only on the shell.

It may implement:

- application layout;
- sidebar;
- collapse;
- primary navigation;
- page frame;
- contextual page header foundation;
- profile popover;
- theme control;
- responsive mobile shell;
- mobile bottom navigation;
- shell-level motion;
- design tokens required by the shell.

It should NOT redesign all individual Gestió modules yet.

Existing page content may temporarily remain inside the new shell.

This allows the design system to be validated before redesigning each screen.

---

# 43. Validation strategy

After implementation, validate in this order:

1. desktop light;
2. desktop dark;
3. collapsed desktop sidebar;
4. compact desktop/tablet;
5. mobile light;
6. mobile dark;
7. keyboard;
8. reduced motion.

Visual changes discovered during testing may adjust design tokens.

Do not silently change the core design direction.

Update the design documentation when a meaningful decision changes.

---

# 44. Design target

The shell should create the impression that Gestió is one coherent application.

Before:

individual administrative pages.

After:

one product with multiple operational areas.

The shell is the foundation of that transformation.
