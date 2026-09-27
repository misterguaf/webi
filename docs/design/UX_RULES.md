# Gestió — UX Rules

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5

---

## 1. Purpose

This document defines how Gestió should behave from the user's point of view.

It complements:

- DESIGN_VISION.md
- DESIGN_SYSTEM.md
- MOTION_SYSTEM.md

It defines interaction principles, navigation, progressive disclosure,
responsive behaviour, feedback and workflow structure.

The goal is to make Gestió feel simple even when the underlying system is complex.

---

# 2. Core UX principle

Gestió should reduce mental load.

The user should rarely have to ask:

- Where am I?
- What can I do here?
- What just happened?
- Is this saved?
- What requires my attention?
- How do I go back?

The interface should make these answers visible.

---

# 3. Progressive disclosure

Do not show all available information at once.

Use this hierarchy:

1. summary;
2. relevant state;
3. primary actions;
4. detail on demand;
5. advanced information only when needed.

Example:

Annual fee list:

Visible initially:
- participant;
- section;
- amount due;
- amount paid;
- state.

On detail:
- payments;
- allocations;
- incidents;
- history;
- audit-relevant actions.

Do not expose technical complexity before the user needs it.

---

# 4. Dashboard

The dashboard answers:

"What should I know right now?"

It is not a collection of every available metric.

It should prioritise:

- active activities;
- registrations requiring attention;
- annual fee state;
- open incidents;
- pending actions;
- important recent changes.

Every dashboard element must justify its presence.

Avoid vanity metrics.

---

# 5. Navigation model

Desktop Gestió uses persistent lateral navigation.

Primary sections should remain stable.

Potential structure:

- Inici
- Activitats
- Inscripcions
- Quotes
- Participants
- Incidències
- Administració

Exact information architecture may evolve as screens are specified.

Navigation must communicate:

- current section;
- available destination;
- optional attention state;
- collapsed state.

The user should never rely on browser history to understand the application.

---

# 6. Global search / command palette

`⌘K` is a first-class navigation mechanism.

It should eventually support searching for:

- participants;
- activities;
- registrations;
- payments;
- sections;
- common actions.

The palette should prioritise:

1. exact or highly relevant result;
2. recent/contextual actions;
3. broader search results.

Search should never expose resources the current user is not authorised to access.

Authorization is enforced server-side.

The UI must not attempt to bypass or reproduce authorization logic.

---

# 7. Pages vs drawers vs popovers

Use a full page when:

- the workflow is substantial;
- the user needs sustained attention;
- many fields or sub-sections exist;
- navigation state should be durable.

Use a drawer when:

- detail is secondary to the current context;
- the user should preserve their place;
- quick review/editing is expected.

Use a popover when:

- the interaction is small;
- contextual;
- short-lived.

Do not place complex workflows inside tiny overlays.

---

# 8. Tables vs cards

Desktop:

Prefer tables when users need to:

- compare records;
- scan many rows;
- sort;
- filter;
- inspect repeated structured fields.

Use cards when:

- each item contains varied content;
- visual hierarchy matters more than direct comparison;
- the collection is small;
- the item represents an object rather than a row.

Mobile:

Tables may transform into structured cards.

Do not force horizontal scrolling for core workflows unless the data genuinely
requires tabular comparison.

---

# 9. Lists

Lists should make the next useful action clear.

Each row should prioritise:

1. identity;
2. current state;
3. critical contextual information;
4. actions.

Avoid displaying every available field.

Secondary actions may appear:

- on hover;
- inside contextual menus;
- inside detail views.

---

# 10. Filtering

Filtering should be understandable and reversible.

Common filters may include:

- section;
- state;
- activity;
- date;
- issue status.

Active filters must remain visible.

Provide a clear way to reset them.

Do not make users remember invisible filter state.

---

# 11. Sorting

Use predictable defaults.

Examples:

Incidents:
most urgent / recent first.

Participants:
alphabetical unless context requires otherwise.

Payments:
recent or actionable first.

The active sort should be visible when it materially affects interpretation.

---

# 12. Forms

Forms should be calm and sequential.

Group related fields.

Avoid very long undifferentiated forms.

Preferred order:

1. essential information;
2. contextual information;
3. advanced/optional fields;
4. final action.

Use inline validation where possible.

Do not wait until submission to reveal obvious field errors.

---

# 13. Save behaviour

The user must understand whether data is:

- automatically saved;
- pending;
- explicitly saved;
- failed.

Do not mix autosave and explicit save unpredictably.

For explicit save workflows:

- primary action should be clear;
- success should be acknowledged;
- unsaved changes should not disappear silently.

---

# 14. Confirmation strategy

Do NOT request confirmation for every action.

Confirmation should be reserved for:

- destructive actions;
- irreversible actions;
- financially significant actions;
- actions with important external consequences.

Examples likely requiring confirmation:

- destructive deletion;
- payment verification where appropriate;
- publishing an activity;
- sensitive permission changes.

Examples not requiring confirmation:

- opening detail;
- changing filters;
- expanding a card;
- navigating.

Too many confirmation dialogs reduce trust rather than increasing it.

---

# 15. Financial workflows

Financial workflows should prioritise certainty.

The interface must clearly distinguish:

- expected amount;
- declared amount;
- verified amount;
- allocated amount;
- disputed amount;
- unallocated verified balance.

Never rely on colour alone.

Important financial state changes should show:

- what changed;
- resulting state;
- relevant amount;
- clear feedback.

Do not hide financial inconsistencies behind optimistic UI.

---

# 16. Issues / incidents

Incidents must feel actionable, not alarming by default.

Each incident should answer:

- What is wrong?
- What does it affect?
- Does it block anything?
- What action is possible?
- Is another person responsible?

Severity must be reflected through hierarchy, not excessive red UI.

Resolved incidents should remain traceable where history matters.

---

# 17. Status language

Status labels should be short and consistent.

Do not use multiple labels for the same state.

Examples:

PENDENT
PARCIAL
PAGAT
INCIDÈNCIA
RESOLT

Technical backend state names do not need to be exposed directly.

User-facing language should remain Valencian in Gestió.

---

# 18. Empty states

Empty states must explain the situation.

Bad:

"No data"

Better:

"Encara no hi ha activitats publicades."

When useful, offer the next action.

Empty states should remain visually calm.

Do not fill them with decorative illustration unless it adds value.

---

# 19. Error states

Errors should explain:

1. what happened;
2. what the user can do;
3. whether anything was saved.

Avoid exposing raw stack traces or technical backend messages.

Examples:

Bad:
"Request failed 409"

Better:
"Aquesta informació ha canviat mentre l'editaves. Torna a carregar-la abans de guardar."

---

# 20. Success feedback

Success feedback should be proportional.

Small action:
inline acknowledgement.

Normal save:
subtle confirmation / toast.

Important state transition:
state morph + clear resulting status.

Do not use modal success dialogs for routine actions.

---

# 21. Loading

Preserve context whenever possible.

Preferred:

existing content
→ subtle updating state
→ updated content

instead of:

content
→ blank page
→ spinner
→ content.

Use skeletons mainly for first-load structures.

Avoid making the application visually reset on every request.

---

# 22. Optimistic UI

Use optimistic UI only where rollback is safe and understandable.

Do NOT optimistically confirm:

- payment verification;
- permission changes;
- destructive actions;
- sensitive financial transitions.

Wait for server confirmation before presenting these as complete.

---

# 23. Keyboard usage

Desktop Gestió should support efficient keyboard use.

Baseline expectations:

- Tab navigation;
- Shift+Tab;
- Enter for primary contextual actions where appropriate;
- Escape closes temporary surfaces;
- ⌘K opens global search.

Future shortcuts may be added only when discoverable and valuable.

Do not create a shortcut-heavy application that requires memorisation.

---

# 24. Focus management

When opening:

Modal:
focus enters modal.

Command palette:
focus enters search.

Drawer:
focus enters relevant first control when appropriate.

When closing:
focus should return logically to the triggering element.

Focus must never disappear.

---

# 25. Mobile navigation

Mobile must remain fully usable.

Do not simply collapse the desktop sidebar into an awkward narrow rail.

Possible mobile patterns:

- compact top navigation;
- bottom navigation for primary areas;
- menu/drawer for secondary areas.

The final pattern will be defined in SHELL.md.

Primary actions must remain easily reachable.

---

# 26. Mobile workflows

Complex desktop workflows may become sequential.

Example desktop:

participant detail + payment panel side-by-side

Mobile:

participant
→ payment detail
→ allocation action

The underlying workflow remains the same.

The layout does not need to.

---

# 27. Touch interactions

Avoid interactions that exist only on hover.

Any hover-only action must have a touch-accessible equivalent.

Important touch targets should generally approach 44px.

Do not place destructive actions immediately adjacent to common actions without
sufficient separation.

---

# 28. Responsive priority

When space decreases, remove or reorganise lower-priority information first.

Priority order:

1. identity;
2. status;
3. primary action;
4. critical context;
5. secondary metadata;
6. decorative information.

Do not simply reduce font sizes to fit more content.

---

# 29. Detail hierarchy

A detail view should normally follow:

Header
→ identity / status
→ primary actions
→ current important information
→ operational detail
→ history / secondary detail

Audit/history information should be accessible but not dominate routine work.

---

# 30. Context preservation

Returning from detail should preserve:

- filters;
- scroll position where practical;
- selected section;
- relevant navigation context.

Do not make users rebuild their working context repeatedly.

---

# 31. Destructive actions

Destructive actions should:

- use danger semantics;
- require appropriate confirmation when meaningful;
- clearly identify the affected object.

Do not place destructive actions as primary actions.

Avoid accidental activation.

---

# 32. Permissions in UX

The UI may hide or disable actions the user cannot perform.

But UI state is never authorization.

Backend authorization remains authoritative.

When an action is unavailable due to permissions:

prefer hiding irrelevant actions when there is no value in showing them.

Use disabled state + explanation only when understanding the unavailable
capability is useful.

---

# 33. Privacy by interface

Do not expose personal information unless it is necessary for the current task.

Lists should avoid displaying excess participant data.

Sensitive detail belongs deeper in the workflow.

Search results should show only enough information to identify the correct
resource.

---

# 34. Attention design

Gestió should not constantly demand attention.

Reserve strong visual emphasis for:

- unresolved issues;
- blocked workflows;
- important deadlines;
- security-relevant states.

Do not badge every navigation item.

If everything demands attention, nothing does.

---

# 35. Notifications

In-app feedback should be contextual.

Do not build a noisy social-style notification system.

Potential future notification centre should prioritise:

- actionable;
- operational;
- recent;
- relevant to the current user's role.

---

# 36. Dashboard attention model

Dashboard ordering should favour:

1. requires action;
2. operational state;
3. useful summary;
4. informational context.

Example:

3 incidències obertes

should generally matter more than:

124 participants totals

unless the current context says otherwise.

---

# 37. Search philosophy

Search should progressively become one of the fastest ways to use Gestió.

A user should eventually be able to type:

"Joan"

and quickly reach the correct participant.

Or:

"Campament"

and reach the corresponding activity.

Or trigger an action when appropriate.

Search must remain permission-aware.

---

# 38. User confidence

Gestió should constantly communicate system state.

Examples:

Saved
Processing
Failed
Updated
Conflict
Pending review

Users should not need to wonder whether the application registered their action.

---

# 39. Conflict handling

When optimistic concurrency detects stale data:

Do not silently overwrite.

Explain that the underlying information changed.

Offer:

- reload;
- compare/retry where appropriate.

Example:

"Aquesta informació ha canviat des que la vas obrir."

Financial data must never use silent last-write-wins behaviour.

---

# 40. Accessibility

All workflows must remain usable with:

- keyboard;
- reduced motion;
- increased contrast where available;
- reduced transparency where applicable.

Do not encode meaning through:

- colour alone;
- animation alone;
- hover alone.

---

# 41. UX quality test

Before accepting a workflow, ask:

1. Can a new monitor understand what to do?
2. Can an experienced coordinator do it quickly?
3. Is the current state obvious?
4. Is the primary action obvious?
5. Are dangerous actions appropriately separated?
6. Is unnecessary information hidden?
7. Does it still work on mobile?
8. Does it remain usable without animation?
9. Does it preserve authorization and privacy boundaries?
10. Would repeated weekly use become annoying?

If not, simplify or restructure.

---

# 42. Product behaviour principle

Gestió should reveal complexity only when complexity is necessary.

The system underneath may be sophisticated.

The interface should not force the user to feel that sophistication.
