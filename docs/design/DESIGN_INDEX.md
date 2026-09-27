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

` screens/SHELL.md `
Application shell: sidebar, top area, layout and responsive navigation.

Future specifications may include:

- DASHBOARD
- ACTIVITIES
- REGISTRATIONS
- FEES
- PARTICIPANT
- SEARCH
- SETTINGS

---

## Core rule

Do not invent a new visual language inside an individual screen.

Every screen must feel like part of the same application.

Gestió should become more consistent as it grows, not less.
