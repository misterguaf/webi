# Gestió — Design Index

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5

---

## Purpose

This directory is the source of truth for the visual design, interaction design
and user experience of Gestió.

The documents in this directory define HOW Gestió should look, feel and behave.

They do not redefine:

- backend business logic;
- authorization;
- financial rules;
- data models;
- security requirements.

Those remain governed by the corresponding project documentation.

---

## Reading rules for AI agents

Do not load every design document for every task.

Read only the context required for the requested implementation.

### Always read

For any significant Gestió UI task:

1. `DESIGN_VISION.md`
2. `DESIGN_SYSTEM.md` when it exists
3. the screen specification relevant to the task

### Read when relevant

Motion or transitions:
- `MOTION_SYSTEM.md`

Navigation, responsive behaviour, feedback or accessibility:
- `UX_RULES.md`

Individual screen implementation:
- `screens/<SCREEN>.md`

Shared components:
- `COMPONENT_LIBRARY.md` when it exists

---

## Source-of-truth hierarchy

When instructions conflict, use this priority:

1. Current explicit task scope
2. Screen specification
3. UX rules
4. Design system
5. Motion system
6. Design vision

A lower-level document must not silently override a higher-level product rule.

If a genuine contradiction exists, stop and report it instead of inventing a
solution.

---

## Design documents

### Foundation

`DESIGN_VISION.md`
Defines the personality, aesthetic direction and design principles of Gestió.

`DESIGN_SYSTEM.md`
Defines typography, colour, spacing, surfaces, radius, shadows, glass,
controls and visual tokens.

`MOTION_SYSTEM.md`
Defines the official animation language of Gestió.

`UX_RULES.md`
Defines navigation, responsive behaviour, progressive disclosure, feedback,
accessibility and interaction principles.

### Shared implementation

`COMPONENT_LIBRARY.md`
Will document reusable Gestió components once the first stable components
exist.

### Screens

`screens/SHELL.md`
Application shell: sidebar, top area, layout and responsive navigation.

`screens/DASHBOARD.md`
Dashboard / Inici v0.1 (3.5C): permission-aware home, attention block, upcoming activities, fee summary.

`screens/ACTIVITIES.md`
Activitats v0.2 (3.5D, implemented — checkpoint `phase-3.5d-complete`): activity list, Nova
activitat drawer/sheet, activity detail with Inscripcions / Informació (no Pagaments tab in
v1.0), hash routing, concurrency, states and known implementation gaps.

`screens/PARTICIPANTS.md`
Participants v0.5 (3.5E, implemented — checkpoint `phase-3.5e-complete`): participant list and record, section
history, provisional records with age-based completeness (minors need a guardian and a
contact; adults need a contact), manual progressive incorporation, guardians and contacts
with audited consultation and shared-guardian protection, legal-representation history and
administrative review by Secretaria, guardian relationship episodes (a former relationship can
start again), Inici follow-up items, basic fee status, and delegation
duration (default 90 days, maximum 365). Secretaria absorbs the retired CRM manager role.
Consent catalogue and texts stay in the legal phase.

`screens/REGISTRATIONS.md`
Inscripcions v0.2 (3.5F, implemented — pending review): global work queue across activities,
registration section distinct from the declared section and the participant's current section,
authorisation order without existence oracles, escalation to global review and section
correction, submitter contact on demand (audited), withdrawal (`Retirada`) distinct from
rejection, neutral family notices, a purpose-limited payment projection for verifiers until
3.5G Tresoreria, authenticated evidence preview/download (audited), photo optimisation in the
portal, retention-ready evidence, linked participant with profile access, and the confirmed
list per activity.

Future specifications may include:

- FEES
- SEARCH
- SETTINGS

---

## Implementation conventions (frontend)

These are engineering rules, not visual rules, but every screen must follow them:

- A screen is a view module in `gestio/public/views/` following the contract in
  `gestio/public/view-registry.js` (`available`, `load`, `unload`, optional `enter`).
  `app.js` only composes views.
- Which modules a user sees comes from `GET /api/me` → `capabilities`. The UI never discovers
  permissions by provoking 403 responses; the server still authorises every operation.
- Lists follow `nextCursor` (`public/api.js`); a list is never shown silently truncated.
- The page runs under a strict CSP: no inline scripts, inline `style` attributes or inline event
  handlers. Use CSS classes and module scripts.

## Core rule

Do not invent a new visual language inside an individual screen.

Every screen must feel like part of the same application.

Gestió should become more consistent as it grows, not less.
