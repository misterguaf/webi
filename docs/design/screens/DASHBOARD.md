# Gestió — Dashboard

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5C
Depends on:

- ../DESIGN\_VISION.md
- ../DESIGN\_SYSTEM.md
- ../MOTION\_SYSTEM.md
- ../UX\_RULES.md
- SHELL.md

---

## 1. Purpose

The Gestió dashboard is the operational home of the application.

Its purpose is not to display every available metric.

It should answer:

"What should I know or do right now?"

The dashboard must prioritise:

1. actions requiring attention;
2. current operational context;
3. upcoming activities;
4. annual fee status when permitted;
5. recent relevant activity.

It should feel calm even when there is work pending.

The dashboard is not a generic SaaS analytics page.

---

# 2. Core principle

The dashboard follows the Gestió rule:

80% CLARITY
20% MAGIC

The user should understand their current situation within a few seconds.

Visual polish must support comprehension.

Avoid decorative widgets that do not help the user act.

---

# 3. Permission-aware dashboard

The dashboard adapts completely to the current user's effective permissions and
scope.

It must never display information simply because the dashboard component exists.

Examples:

## Group coordination

May see:

- group-wide activity;
- all sections within their permissions;
- global attention items;
- relevant operational summaries.

## Section responsibility

May see only information belonging to sections/resources they are authorised
to access.

Example:

A Tropa coordinator should not automatically see Escolta operational data.

## Treasury

May see financial information and actions according to their effective
permissions.

## Users without financial permissions

Must not see:

- annual fee amounts;
- payment metrics;
- financial incidents;
- financial activity log entries that reveal restricted information.

When a module is unavailable, the dashboard layout reorganises naturally.

Do not render empty placeholders for inaccessible modules.

UI visibility does not replace server-side authorization.

---

# 4. Dashboard hierarchy

Initial desktop order:

1. Greeting / contextual introduction
2. Requires attention
3. Upcoming activities
4. Annual fees, when permitted
5. Recent operational activity
6. Minimal contextual actions

Exact placement may adapt when some modules are unavailable.

---

# 5. Greeting

The dashboard should greet the current user personally.

Examples:

`Bon dia, Borja.`

`Bona vesprada, Borja.`

`Bona nit, Borja.`

Greeting depends on local time.

The user's display name must come from the current authenticated identity.

Do not expose technical role identifiers here.

---

## 5.1 Contextual phrase

A short contextual sentence may appear below the greeting.

The sentence should reflect actual dashboard state.

Examples:

When attention is required:

`Tens 3 coses que necessiten la teua atenció.`

`Hi ha un parell de coses pendents.`

When nothing requires action:

`Tot al dia. Hui pots anar amb calma.`

`Tot controlat per ara.`

Do not generate arbitrary motivational phrases.

Use a curated set of short Valencian messages.

Tone:

- human;
- calm;
- professional;
- young;
- not childish;
- not corporate.

---

## 5.2 Date

The current date may appear subtly below or beside the greeting.

Example:

`Dilluns, 28 de setembre`

It should remain secondary to the greeting.

---

# 6. Requires Attention

This is normally the most important section of the dashboard.

Title:

`Requereix la teua atenció`

Only show items that actually require an action.

Possible categories include:

- registrations requiring review;
- payments requiring verification;
- annual fee incidents;
- operational incidents;
- draft activities that need completion;
- other actionable states added in future phases.

Do not include informational metrics here.

---

## 6.1 Attention structure

Desktop concept:

┌─────────────────────────────────────────────────────┐
│ REQUEREIX LA TEUA ATENCIÓ                           │
│                                                     │
│  3 inscripcions    2 pagaments      1 incidència   │
│  per revisar       per revisar      de quotes      │
│                                                     │
│  [Revisar]                                          │
└─────────────────────────────────────────────────────┘

Exact layout may use compact metrics or actionable rows.

The component should remain easy to scan.

---

## 6.2 Attention actions

Attention items must lead directly to the relevant filtered workflow.

Examples:

`3 inscripcions per revisar`

opens Inscripcions filtered to those records.

`2 pagaments per revisar`

opens the corresponding review queue.

`1 incidència de quotes`

opens Quotes with the relevant issue context.

Do not send the user to a generic module landing page when a specific filtered
state is available.

---

## 6.3 No attention state

When no action is required, replace the attention panel with a calm positive
state.

Example:

`Tot al dia`

`No tens cap acció pendent ara mateix.`

This may use:

- subtle success icon;
- restrained semantic colour;
- very soft state transition.

Do not use:

- confetti;
- celebration animation;
- large green surfaces.

The state should communicate confidence and calm.

---

# 7. Reviews vs Annual Fees

Do not mix operational review queues with annual fee metrics.

The dashboard distinguishes:

## Reviews requiring action

Examples:

- registration review;
- payment verification;
- matching/rejection;
- evidence review.

## Annual fee status

Examples:

- percentage collected;
- paid obligations;
- partial obligations;
- fee incidents.

These may be related operationally but are separate dashboard concepts.

---

# 8. Evidence preview principle

When future review workflows expose payment evidence or documents, the user
should not normally be forced to download the file to inspect it.

Preferred experience:

click evidence
→ preview inside Gestió
→ inspect
→ accept / reject / mark issue as permitted

Possible presentation:

- large drawer;
- modal preview;
- dedicated review panel.

Images and PDFs should be viewable directly where technically feasible.

Downloads may remain available as a secondary action.

This behaviour will be fully specified in the Inscripcions / Payments screen
documentation.

The dashboard itself should link to the review workflow rather than implement
the complete review UI.

---

# 9. Upcoming Activities

Section title:

`Pròximes activitats`

Secondary action:

`Veure totes`

The dashboard should show only a small number of relevant activities.

Initial target:

2–4 items.

---

## 9.1 Activity priority

Prefer:

1. upcoming published activities;
2. activities whose deadline is close;
3. relevant drafts requiring completion;
4. other contextually important activities.

Do not simply show the most recently created records.

---

## 9.2 Draft visibility

A draft may appear when:

- the current user can access it;
- it is relevant to their section/scope;
- it requires continued work.

Example:

`Eixida de Tropa`

`ESBORRANY`

`Encara no publicada`

Action:

`Continuar editant`

Drafts should not dominate the section when there are more relevant published
activities.

---

## 9.3 Activity card information

A dashboard activity card may include:

- activity name;
- section;
- date;
- status;
- registration count;
- deadline context;
- price only when useful and permitted.

Avoid showing every available activity field.

---

## 9.4 Activity interaction

Clicking an activity should navigate to the activity detail.

Future implementation may use:

`MOTION 04 — Shared Card Expansion`

when the Activities screen supports it.

Do not implement a complex shared transition solely for the dashboard before
the corresponding detail experience exists.

---

# 10. Annual Fees

Show this section only when the current user is authorised to access the
relevant financial information.

Title:

`Quotes anuals`

Secondary action:

`Veure quotes`

---

## 10.1 Primary metric

The main value is:

percentage effectively collected / confirmed

Example:

`82% cobrat`

The calculation must use the authoritative financial model.

Do not calculate a simplified frontend approximation when the backend exposes
the proper values.

---

## 10.2 Supporting values

Possible summary:

- pagades;
- parcials;
- incidències.

Example:

`32 pagades`

`5 parcials`

`3 incidències`

The dashboard may also show:

confirmed / expected amount

only if it remains visually useful.

Do not turn the block into a complete financial report.

---

## 10.3 Progress presentation

A restrained progress visual may accompany the primary percentage.

It should be:

- simple;
- readable;
- accessible;
- compatible with light/dark mode.

Do not use a large chart merely to show one percentage.

---

## 10.4 Financial attention

Financial incidents requiring action also appear in:

`Requereix la teua atenció`

The Annual Fees card communicates overall state.

The attention panel communicates work that needs action.

Do not duplicate the same information excessively.

---

# 11. Recent Activity

Section title:

`Activitat recent`

Secondary action:

`Veure historial`

This section shows meaningful operational events.

Its purpose is awareness and transparency, not surveillance.

---

## 11.1 Example events

Possible entries:

`Marina ha verificat un pagament.`

`Pau ha publicat "Campament d'estiu".`

`Laura ha resolt una incidència de quota.`

`Arnau ha actualitzat una activitat.`

Events should be written in human-readable Valencian.

Do not expose technical event codes directly.

---

## 11.2 What Recent Activity is not

It is not:

- a raw audit log;
- a debug log;
- a complete immutable event dump;
- a list of every request made by the application.

The dashboard shows only recent operationally useful events.

---

# 12. Activity History

Gestió should eventually expose a dedicated human-readable activity history.

Potential location:

Administració
→ Historial d'activitat

This is distinct from raw technical/security logs.

---

## 12.1 History capabilities

Future history view should support filtering by:

- user;
- date;
- module;
- action;
- affected resource where appropriate.

Examples:

- activity publication;
- payment verification;
- fee issue resolution;
- registration review;
- session/admin action.

---

## 12.2 Permissions and transparency

Operational transparency is desirable.

However, users must not gain access to information they are otherwise not
authorised to see merely through the activity history.

Rule:

A user may see an activity event only when their permissions allow them to
understand the affected resource and relevant event.

Examples:

A section user should not discover restricted financial information through a
log entry.

Sensitive future health actions must remain appropriately restricted.

Audit/security events may have separate access rules.

"Everyone can see everything" is not an acceptable authorization model.

---

## 12.3 Technical audit vs human history

Keep two concepts separate:

### Audit trail

Security/compliance oriented.

May contain:

- actor identifiers;
- resource identifiers;
- technical action codes;
- timestamps;
- security context.

### Activity history

Human-facing.

Contains:

- readable actor name;
- understandable action;
- relevant object;
- time;
- link to accessible context.

The activity history may be derived from audit/event data but must not expose
raw internal details.

---

# 13. Quick Actions

The dashboard must not become a shortcut grid.

Initial dashboard quick action:

`Nova activitat`

Show only when the current user is authorised to create an activity.

Do not show:

`Buscar participant`

as a permanent dashboard action.

Global participant/resource search belongs primarily to:

`⌘K`

---

# 14. Nova Activitat

The `Nova activitat` action may live:

- in the dashboard page header;
- or in a visually appropriate high-level contextual position.

It should use the existing authorized activity creation flow.

Do not duplicate the API.

Creation should continue to generate a DRAFT first.

The detailed creation experience belongs to `ACTIVITIES.md`.

---

# 15. Do Not Include Yet

Version 0.1 of the dashboard should NOT include:

- calendar widget;
- complex historical charts;
- decorative analytics;
- long-term trend graphs;
- birthday widgets;
- weather;
- arbitrary statistics;
- large participant totals without operational purpose;
- configurable widget system.

These may be considered later if real use demonstrates value.

---

# 16. Avoid SaaS Metric Grid

Do not build the dashboard around four generic cards such as:

`40 participants`

`13 activitats`

`16 inscripcions`

`40 quotes`

unless a total has direct operational meaning in context.

Generic totals should not dominate the first screen.

The dashboard should feel purpose-built for Parpalló.

---

# 17. Desktop Layout

Suggested conceptual structure:

Bon dia, Borja.
Tens 3 coses que necessiten la teua atenció.
Dilluns, 28 de setembre

┌────────────────────────────────────────────────────────────┐
│ REQUEREIX LA TEUA ATENCIÓ                                  │
│                                                            │
│ 3 inscripcions     2 pagaments       1 incidència          │
│ per revisar        per revisar       de quotes             │
└────────────────────────────────────────────────────────────┘

PRÒXIMES ACTIVITATS                              Veure totes →

┌────────────────────────┐  ┌────────────────────────┐
│ Campament d'estiu      │  │ Eixida Tropa           │
│ PUBLICADA              │  │ ESBORRANY              │
│                        │  │                        │
│ 42 inscripcions        │  │ Encara no publicada   │
│ 12–15 juliol           │  │ 23 octubre             │
└────────────────────────┘  └────────────────────────┘

QUOTES ANUALS                                   Veure quotes →

82% cobrat
████████████████░░░░

32 pagades        5 parcials        3 incidències

ACTIVITAT RECENT                                Veure historial →

✓ Marina ha verificat un pagament
◇ Pau ha publicat Campament d'estiu
✓ Laura ha resolt una incidència
```
                                           + Nova activitat
```

This is a conceptual hierarchy, not a pixel-perfect layout requirement.

---

# 18. Layout Behaviour

Use contextual maximum width from `DESIGN_SYSTEM.md`.

Dashboard should normally use a standard content width.

Avoid stretching cards across extremely wide monitors.

Large screens may use:

- two-column activity cards;
- balanced metric layouts;
- aligned recent activity.

Do not create excessive empty horizontal space.

---

# 19. Light Mode

Light dashboard should feel:

- luminous;
- calm;
- spacious;
- professional.

Use predominantly solid surfaces.

Glass should remain concentrated in shell/floating contexts.

Dashboard cards may use:

- solid white/cool-neutral surfaces;
- subtle border;
- low/no shadow;
- restrained Iris accent.

Do not turn every dashboard block into glass.

---

# 20. Dark Mode

Dark dashboard should preserve the premium shell depth.

Use:

- graphite canvas;
- solid elevated content surfaces;
- subtle borders;
- Iris accents;
- controlled semantic colours.

Important information should remain highly readable.

Do not use excessive glow.

---

# 21. Dashboard Card Behaviour

Cards should represent meaningful objects or summaries.

Possible shared components:

- AttentionPanel
- ActivityCard
- FinancialSummary
- RecentEvent
- SectionHeader
- Metric
- StatusBadge
- Progress

Do not create generic Card variants for every block if the content has different
semantic requirements.

---

# 22. Interaction States

Each interactive dashboard component must support:

- default;
- hover;
- focus;
- pressed;
- loading where relevant;
- permission-limited behaviour;
- error where relevant.

Hover-only actions must have keyboard/touch equivalents.

---

# 23. Loading State

The shell should remain visible.

Dashboard content may load section by section.

Preferred:

greeting visible
\+
structured skeletons for operational blocks

Avoid:

full-screen spinner

Skeletons should approximate final geometry.

Do not animate them aggressively.

---

# 24. Error State

A failure in one dashboard module should not necessarily destroy the entire
dashboard.

Example:

Activities fail to load
→ Activities section shows local error/retry

Annual fees still render if available.

Use understandable Valencian copy.

Example:

`No s'han pogut carregar les pròximes activitats.`

`Torna-ho a intentar`

Do not expose:

`Failed to fetch`

or backend codes directly.

---

# 25. Empty States

Each section has its own empty behaviour.

Examples:

No upcoming activities:

`No hi ha cap activitat pròxima.`

No recent activity:

`Encara no hi ha activitat recent per mostrar.`

No attention:

use the dedicated `Tot al dia` state.

Do not render meaningless blank cards.

---

# 26. Permission-Limited State

If the user cannot access a dashboard module:

Do not display an access-denied card.

Remove the module and allow remaining content to reflow.

Use explicit permission explanation only when the unavailable capability is
useful for the user to understand.

---

# 27. Mobile Layout

Mobile dashboard uses the same information priority.

Order:

1. greeting;
2. attention;
3. activities;
4. annual fees when permitted;
5. recent activity.

Do not attempt desktop multi-column composition on small screens.

---

## 27.1 Mobile attention

Attention items may become a vertical actionable list.

Example:

Requereix la teua atenció

3 inscripcions per revisar        →
2 pagaments per revisar           →
1 incidència de quotes            →

Touch targets must remain comfortable.

---

## 27.2 Mobile activities

Activity cards stack vertically.

Show only essential information.

Avoid wide metadata rows.

Actions may use:

- card tap;
- contextual menu;
- clear inline action.

---

## 27.3 Mobile financial summary

Use a compact vertical presentation.

The percentage and progress remain visible.

Secondary counts may use a simple grid or inline grouping.

Avoid dense mini charts.

---

# 28. Tablet

Tablet landscape may preserve much of the desktop structure.

Tablet portrait should progressively collapse:

- activity cards;
- metric arrangements;
- recent activity layout.

Follow content width rather than device name.

---

# 29. Motion

Dashboard motion should remain restrained.

Approved patterns include:

### Attention state updates

Use subtle state transition.

### Activity cards

May use small hover/elevation feedback.

### Metric changes caused by user action

Use `MOTION 12 — Metric Update`.

### List updates

Use `MOTION 13 — List Insert / Remove`.

### Activity → detail

Future use of `MOTION 04 — Shared Card Expansion`.

Do not animate all metrics on every initial dashboard load.

---

# 30. Tot al dia Transition

When the final attention item is resolved during a session:

attention list
→ subtle transition
→ `Tot al dia`

This is a potential Gestió signature moment.

It should feel satisfying but restrained.

No celebration effects.

---

# 31. Recent Activity Motion

New activity events caused by the current user's action may appear using:

`MOTION 13 — List Insert / Remove`

Do not continuously animate historical entries.

---

# 32. Accessibility

Dashboard must support:

- keyboard navigation;
- screen-reader understandable headings;
- semantic status beyond colour;
- visible focus;
- sufficient contrast;
- reduced motion;
- mobile touch targets.

Attention priorities must not be communicated only through colour.

---

# 33. Privacy

Dashboard should minimise unnecessary personal information.

Examples:

Do not display:

- full personal records;
- health information;
- unnecessary contact information;
- raw UUIDs;
- technical identifiers.

Recent Activity should use only the information necessary to understand the
event.

---

# 34. Copy Language

Gestió user-facing dashboard copy is Valencian.

Copy must be:

- natural;
- concise;
- consistent;
- human-readable.

Do not expose English/backend status identifiers such as:

- GROUP\_COORDINATOR
- ACTIVE
- PENDING\_REVIEW

Map technical states to approved user-facing language.

---

# 35. Initial Demo Dataset Requirements

The demo environment should provide enough data to exercise the dashboard.

Minimum useful scenarios:

- at least 2 upcoming activities;
- at least 1 draft activity;
- several registrations requiring attention;
- payment reviews if supported by current data;
- at least one annual fee incident;
- mix of paid / partial / pending obligations;
- several recent activity events if human-readable history exists;
- a state where attention is present.

Testing should also include a manually produced:

`Tot al dia`

state.

---

# 36. Component Extraction

Do not create a large abstract component library before the dashboard exists.

After Dashboard v0.1 is visually validated, stable components may be documented
in:

`../COMPONENT_LIBRARY.md`

Potential first components:

- PageGreeting
- AttentionPanel
- AttentionItem
- SectionHeader
- ActivityCard
- Metric
- FinancialProgress
- StatusBadge
- RecentEvent
- EmptyState
- InlineError

Only extract components that have demonstrated reuse.

---

# 37. First Implementation Scope

Dashboard v0.1 should implement:

- greeting;
- contextual phrase;
- date;
- permission-aware attention section;
- upcoming activities;
- annual fee summary when permitted;
- recent activity if current data source supports it safely;
- `Nova activitat` when authorised;
- loading / empty / local error states;
- responsive layout;
- light/dark;
- relevant motion.

---

# 38. Do Not Invent Backend Data

The frontend must not fabricate operational values to make the dashboard look
complete.

If a metric or event source does not currently exist:

- identify the backend/data gap;
- use existing demo data only where appropriate;
- do not silently derive potentially incorrect business meaning.

Visual placeholders may be used during isolated design development only when
clearly synthetic.

---

# 39. Recent Activity Backend Gap

Before implementing Recent Activity, inspect the existing audit/event
capabilities.

Determine:

- what operational events are currently recorded;
- whether they contain enough safe information for a human-readable feed;
- how permission scoping can be enforced.

If the current audit system is not appropriate as a direct data source:

do not expose raw audit records.

Document the gap before adding a new endpoint.

---

# 40. Dashboard Acceptance Criteria

Dashboard v0.1 is successful when:

1. The user immediately understands what requires attention.
2. The content changes appropriately according to permissions.
3. Group coordination can understand the current operational situation quickly.
4. Section-scoped users see only relevant data.
5. Financial information appears only to authorised users.
6. Upcoming activities are immediately useful.
7. Draft activity work can be resumed easily.
8. The dashboard does not feel like a generic SaaS metric grid.
9. Light mode feels luminous and professional.
10. Dark mode feels deep and premium.
11. Mobile retains the same information priority.
12. No raw UUIDs or backend codes are visible.
13. Partial API failures do not destroy the whole page.
14. `Nova activitat` is visible only where appropriate.
15. The screen remains calm when there is a lot of operational activity.

---

# 41. Human Validation

After the first implementation, test with realistic demo data.

Evaluate:

- Can the user identify pending work in under five seconds?
- Is anything important hidden too low?
- Are there unnecessary metrics?
- Does the dashboard feel overloaded?
- Does it remain useful when some modules are unavailable by permission?
- Does mobile preserve the same priorities?
- Does the dashboard encourage useful action rather than passive monitoring?

Visual quality alone is not enough.

The dashboard must work as an operational home.

---

# 42. Design Target

The desired reaction is:

"I know what is happening and what I need to do."

followed by:

"This feels extremely polished."

The dashboard should be the first Gestió screen that demonstrates how the
design system, operational logic and real scout-group workflows become one
coherent product.]
