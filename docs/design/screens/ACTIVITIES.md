# Gestió — Activitats

Status: ACTIVE
Version: 0.2 (updated for 3.5F — Inscripcions, see REGISTRATIONS.md v0.2)
Project: Grup Scout Parpalló — Gestió
Phase: 3.5D
Baseline: `phase-3.5-audit-remediated` (`55cbf96`)
Depends on:

- ../DESIGN\_VISION.md
- ../DESIGN\_SYSTEM.md
- ../MOTION\_SYSTEM.md
- ../UX\_RULES.md
- SHELL.md
- DASHBOARD.md

Changes in 0.2: product decisions of Atlas/Borja (2026-09-29).
- Discard DRAFT is in scope; family transport is fixed at 0 €; the demo
  scenarios are part of 3.5D.
- Routing and deep links, optimistic concurrency and server-side registration
  counts move into scope.
- GENERAL read is separated from manage.
- There is no generic Pagaments tab in v1.0.
- The Dashboard opens the new detail.

Updates from 3.5F (REGISTRATIONS.md v0.2, implemented): the Inscripcions tab
gains `Retirades`, escalated rows (`En revisió global`), a row menu (correct
section, send to global review, register a withdrawal), the linked participant
with profile access, contact through an audited request, an in-app evidence
preview and the confirmed list. Sections below are updated where they
contradicted those decisions.

---

## 1. Purpose

Activitats is where Gestió prepares, publishes and runs the group's activities:
excursions, camps, workshops and whole-group days.

It must answer, in order:

1. What activities exist in my scope, and in what state?
2. Which one needs something from me now?
3. How is a given activity going (registrations, deadline, pending reviews)?
4. How do I create, complete, publish, close or discard one?

The current screen is legacy: a bullet list with two buttons per row and a long
form inserted under the list. It does not represent the target and is replaced
entirely by this specification.

Activitats is an operational module, not a catalogue and not a form.

---

# 2. Product principles

### 2.1 An activity is an entity, not a form

Users open an activity to see its situation. Editing is one action among
several, not the default state of the screen.

### 2.2 Lists are for scanning; detail is for work

The list communicates identity, state and the one signal that matters most.
Everything else lives in the detail view.

### 2.3 One primary action per context

- List: `Nova activitat`.
- Draft: `Publicar`.
- Published or closed: no primary action by default. `Editar` is secondary;
  `Tancar activitat` and `Descartar esborrany` live in the overflow menu.

### 2.4 Luminous Utility

The module should be:

- calm, bright and legible in light mode;
- deep and premium in dark mode;
- neutral at about 85–90%;
- Iris only for selection, focus, the primary action and the publication
  moment.

It must not become:

- a SaaS dashboard;
- a classic admin table;
- a giant grid of cards;
- a glass showcase.

### 2.5 80% clarity / 20% magic

The magic is reserved for three moments:

- card → detail;
- draft → published;
- opening `Nova activitat`.

Everything else is quiet.

### 2.6 Real data only

The UI shows only what the backend provides. The backend additions that 3.5D
needs are listed explicitly in §23.1. Anything else without a source is an open
gap (§23.2); the frontend never fabricates or guesses it.

### 2.7 Never overwrite silently

Every edit carries the version the user saw. If someone else changed the
activity in the meantime, Gestió says so and does not overwrite (§14.3).

---

# 3. Permissions and scopes

The UI adapts to `GET /api/me` → `capabilities` (version 1). Capabilities are
advisory; every request is still authorised by the server. Hiding a control is
not a security measure.

## 3.1 Capabilities used

| Capability | Meaning in Activitats |
|---|---|
| `activities.read` | Scope of activities the user may **consult**. Any scope also grants read access to GENERAL activities (§3.3) |
| `activities.manage` | Sections in which the user may create, edit, publish, close and discard |
| `activities.manageGeneral` | May create, edit, publish, close and discard GENERAL activities |
| `activities.reviewRegistrations` | Scope in which the user may see and review registrations, and receive registration counts |
| `activities.verifyPayments` | Scope in which the user may review activity payment evidence (contextual, §11.4) |

## 3.2 Product decision: section coordination and GENERAL activities

`SECTION_COORDINATOR` with the individual grant `activities.general.manage` may
create, edit, publish, close and discard GENERAL (whole-group) activities. This
is deliberate: it speeds up group management and avoids depending on a single
person for general activities.

It does not extend to other sections. A Tropa coordinator can manage:

- Tropa activities;
- GENERAL activities.

They cannot manage Escolta activities, nor mixed activities that include a
section outside their `activities.manage` scope.

## 3.3 Product decision: GENERAL read is separate from GENERAL manage

A GENERAL activity concerns every section. Therefore:

- **READ** a GENERAL activity (list row and detail): any user with
  `activities.read` in any scope. For example, a Tropa section delegate can
  consult the whole-group day.
- **MANAGE** a GENERAL activity: `activities.general.manage` only (§3.2).

This replaces the current backend rule, where the GENERAL detail requires
`activities.general.manage` and scoped readers do not receive GENERAL rows in
the list. It is backend work in 3.5D (§23.1, B4).

Reading a GENERAL activity never widens other scopes. Registrations of a
GENERAL activity remain filtered by the reviewer's section (§3.5).

## 3.4 What the UI derives

| UI element | Shown when |
|---|---|
| Module visible | `read` or `manage` or `manageGeneral` |
| `Nova activitat` | `manage` has at least one section, or `manageGeneral` |
| Scope choice `Tot el grup` in the form | `manageGeneral` |
| Section chips in the form | only sections in `manage` |
| `Editar` / `Publicar` / `Tancar` / `Descartar` on a SECTIONS activity | `manage` is `all` or contains every section of the activity |
| Same actions on a GENERAL activity | `manageGeneral` |
| `Descartar esborrany` | additionally: status DRAFT and no registrations |
| Inscripcions tab and counts | `reviewRegistrations` is `all`, the activity is GENERAL, or it shares a section with the activity |
| Contextual payment evidence | paid activity and `verifyPayments` overlaps (§11.4) |

The backend rule is the reference:

- for SECTIONS activities, managing requires scope over **all** targeted sections;
- for GENERAL activities, it requires `activities.general.manage`.

## 3.5 Read-only situations

A user may see an activity without being able to manage it. Examples:

- a mixed Tropa + Escolta activity for a Tropa-only coordinator;
- a section delegate reading a GENERAL activity.

The detail then shows the activity with no management actions. A quiet line
under the header explains why when it helps:

`Només lectura · inclou seccions que no gestiones`

or `Només lectura`.

Do not show disabled buttons for every missing permission (UX_RULES §32).

## 3.6 Scoped registration counts

For a GENERAL activity, a section-scoped reviewer only receives registrations
submitted for their own section. The server-side counts (§5.5) are computed with
the same scope. Every count and list in that case is labelled as partial, for
example:

`12 inscripcions de Tropa`

Never present such a count as the activity total, and never derive the global
total on the client.

---

# 4. Information architecture

```text
Activitats (list)                       #/activitats
 ├─ Nova activitat ───────── drawer (desktop) / full-screen sheet (mobile)
 └─ Activity detail (page)              #/activitats/<activityId>
     ├─ header · status · actions (Publicar · Editar · •••)
     ├─ operational summary / readiness block
     └─ tabs
         ├─ Inscripcions     (capability + not DRAFT)  #/activitats/<id>/inscripcions
         └─ Informació       (always)                   #/activitats/<id>/informacio
```

- **Edit** reuses the same drawer or sheet as creation. The drawer does not
  change the route; closing it returns focus to the detail.
- **Detail is a page, not a drawer.** It is a sustained workflow with
  registrations and repeated use (UX_RULES §7).
- **There is no generic Pagaments tab in v1.0.** Payment evidence appears
  contextually inside Inscripcions when it can be related safely (§11.4). A
  full per-activity payment view is deferred (§24).
- **Entry points into the detail:**
  - Dashboard `Pròximes activitats` cards;
  - Dashboard attention items ("inscripcions per revisar"), which open the
    Inscripcions tab filtered to `Per revisar`;
  - pasted deep links;
  - ⌘K results, when activity search exists.

  All of them land on this detail, never on the legacy form.

## 4.1 Routing and deep links

3.5D introduces lightweight hash routing, without a framework, compatible with
the existing view registry (`view-registry.js`, `shell.js`).

| Hash | Screen |
|---|---|
| `#/activitats` | List |
| `#/activitats?estat=esborranys&seccio=TROPA&quan=proximes&q=eixida` | List with filters (§6) |
| `#/activitats/<uuid>` | Detail, default tab |
| `#/activitats/<uuid>/inscripcions` | Detail, Inscripcions (optional `?filtre=per-revisar`) |
| `#/activitats/<uuid>/informacio` | Detail, Informació |

Behaviour:

- **Refresh** restores the same screen, tab and filters.
- **Back and forward:**
  - list ⇄ detail ⇄ tab changes are history entries;
  - filter changes replace the current entry, so the history does not fill up
    with every keystroke;
  - opening or closing the drawer does not create history entries.
- **Deep links:**
  - A deep link loads the shell, the session and capabilities first, then the
    target.
  - If the activity does not exist or is out of scope, the server returns 404
    and the UI shows the same message for both: `No tens accés a aquesta
    activitat o ja no existeix.` + `Torna a Activitats`. It never reveals
    existence.
  - If the user is not signed in, the login appears; after login, the pending
    route is restored.
- **Other shell pages** (`#/inici`, `#/quotes`…) get equivalent hash routes so
  that back/forward is coherent across the app. Their content does not change
  in 3.5D.
- **Why hash routing:**
  - no server change or asset fallback is needed (the Gestió Worker serves
    static assets without SPA fallback);
  - it works behind Cloudflare Access;
  - the fragment is never sent to the server or written to access logs.
- **Only non-personal identifiers in the URL:**
  - the activity UUID;
  - section codes and filter keywords.
  - The search text stays in the URL only while it is non-empty.
  - Participant names or ids never appear in URLs.

---

# 5. Activities list

## 5.1 Page header

```text
Activitats                                         [ Nova activitat ]
```

- Page title typography; no subtitle by default.
- A subtitle is used only to state the scope when it is limited, for example:
  - `Tropa i activitats de tot el grup`;
  - `Només lectura`.
- `Nova activitat` is the Iris primary button, shown only per §3.4.

## 5.2 Status segmented control

Directly under the header:

```text
[ Totes ] [ Publicades ] [ Esborranys ] [ Tancades ]
```

- Default: `Totes`.
- Each segment may show a count from the loaded list.
- Selection uses the Iris selected state.

## 5.3 Secondary filter line

A compact second line, visually subordinate:

```text
[⌕ Busca una activitat…]   [Secció ▾]   [Quan ▾]            Neteja filtres
```

Detailed behaviour is in §6.

## 5.4 List body

A single column of rich rows inside one solid surface:

- rows are separated by subtle dividers, not boxed individually;
- desktop content width: standard (~1100–1200px);
- no grid of cards and no table columns.

Grouping inside `Totes`:

| Group | Contents | Order |
|---|---|---|
| `En marxa i pròximes` | PUBLISHED whose end is in the future | open deadline first, then start date ascending |
| `Esborranys` | DRAFT | start date ascending |
| `Passades i tancades` | CLOSED, plus PUBLISHED whose end is in the past | start date descending |

- **A published activity that has ended** stays published in the backend until
  someone closes it. It appears in the last group with the signal
  `Pendent de tancar` (§8.2).
- **Other segments** show a single flat list with the same ordering rules.
- **Group headers** use the Label style with the group count. They are not
  sticky on mobile.

## 5.5 Data source: enriched list read model

`GET /api/activities` (paginated with `nextCursor`, followed to completion by
`public/api.js`) returns each row with a server-side registration summary
(backend work B1, §23.1). There is **no request per activity**.

Per row, in addition to today's fields:

| Field | Meaning |
|---|---|
| `version` | Optimistic concurrency token (B2) |
| `registrations` | `null` if the user has no review scope overlapping the activity; otherwise `{ scope, total, needsReview, awaitingPayment, confirmed, rejected }` |
| `registrations.scope` | `ALL` (complete) or `PARTIAL` with `sections: ['TROPA']` (for GENERAL activities and section-scoped reviewers) |

Rules:

- Counts are computed with **exactly the same scope rules as
  `GET /api/activities/:id/registrations`**: submitted section in the reviewer's
  scope, and all sections for group-wide reviewers.
- Counts contain no personal data. Aggregates for a scope the user cannot
  review are never computed.
- The UI shows partial counts with their sections (§3.6) and omits `null`
  counts. It never shows `0` when the value is unknown.

---

# 6. Filtering and search

All filtering happens client-side on the authorised, fully loaded list. At the
current scale (tens of activities per year) this is simpler and just as fast.
Server-side filtering stays a future option (§23.2, G2).

| Control | Behaviour | URL key |
|---|---|---|
| Status segments | Totes / Publicades / Esborranys / Tancades. `Tancades` also includes ended-but-published rows so nothing disappears | `estat` |
| Search | Name and location, case- and accent-insensitive, as the user types. Also matches the internal public code, never shown as a primary label | `q` |
| `Secció` | Options: `Totes`, `Tot el grup`, and only the sections present in the user's loaded list. Multi-section activities match any of their sections | `seccio` |
| `Quan` | `Qualsevol data` (default), `Pròximes` (end ≥ now), `Aquest mes`, `Passades` (end < now). No custom date picker in v1.0 | `quan` |
| `Neteja filtres` | Appears only when something differs from the defaults; resets everything | — |

- Filters are reflected in the hash (§4.1) using the replace-entry rule, so
  refresh and deep links reproduce the same list.
- Invalid or unknown values fall back to the defaults silently.
- Active filters are always visible (UX_RULES §10). On mobile, a single
  `Filtres (2)` button shows the number of active filters.
- Returning from a detail restores filters and the scroll position.

---

# 7. Activity card anatomy

Each activity is a single interactive row. The whole row opens the detail
(`#/activitats/<id>`).

```text
┌──────┐
│ 25   │  Eixida · Tropa                                  ● Publicada
│ OCT  │  Tropa · 25–26 d'oct.                            12 inscripcions
└──────┘  Espai de muntanya                               Termini en 3 dies · 15,00 €
```

## 7.1 Zones

| Zone | Content |
|---|---|
| **Date tile** (left) | Day number and short month from `starts_at`. Neutral surface, `--radius-small`. For CLOSED/past it uses secondary text colour |
| **Identity** (centre) | Line 1: name (Card title, one line with ellipsis, full name in the accessible name). Line 2: scope label (`Tot el grup` or section names) · date range. Line 3 (optional, Small body, secondary): location |
| **Status and signals** (right) | Line 1: status badge (§8). Lines 2–3: at most two signals, chosen by priority (§7.2) |

## 7.2 Signal priority (at most two)

1. Attention: `3 per revisar` (`registrations.needsReview`) or
   `Pendent de tancar`.
2. Registrations: `12 inscripcions`, or `12 inscripcions de Tropa` when
   `scope = PARTIAL`. Omitted when `registrations` is `null`.
3. Deadline: `Termini en 3 dies`, `Últim dia`, `Termini tancat`.
4. Price: `Gratuïta`, or the amount (`15,00 €`).

Rules:

- A GENERAL activity uses the scope label `Tot el grup`.
- Multi-section activities list the sections (`Tropa · Escolta`).
- A DRAFT replaces signals with the contextual affordance
  `Continuar editant →` (Label, Iris text on hover and focus only). The whole
  row still opens the detail; the affordance is a visual cue, not a separate
  button.
- A CLOSED row shows the registration count (if permitted) and `Tancada`,
  de-emphasised.

## 7.3 Interaction

- One focusable element per row (a link to the detail hash, so middle-click and
  "open in new tab" work). No persistent buttons inside rows.
- Hover: subtle surface change, and the chevron `›` appears at the far right.
  No scale (MOTION_SYSTEM §7).
- Pressed: scale 0.995, 80–120ms.
- Enter opens the detail.

## 7.4 What the row must not show

- raw UUIDs or the internal public code as a label;
- creator identifiers or names;
- descriptions;
- materials;
- participant names;
- contact data;
- transport details.

---

# 8. Status semantics

## 8.1 Backend states

| Backend | Badge | Visual |
|---|---|---|
| DRAFT | `Esborrany` | Neutral outline badge (border only), secondary text. Row keeps normal contrast because it needs work |
| PUBLISHED | `Publicada` | Neutral soft badge with a small semantic success dot. Not a solid green |
| CLOSED | `Tancada` | Neutral soft badge, secondary text. The row's name uses the primary colour at reduced emphasis |

- State must be legible without colour (the text is always present).
- Iris is **not** a status colour. It appears only during the publication
  moment (§17).

## 8.2 Derived timing signals

These are derived client-side from authoritative dates. Not stored.

| Condition (PUBLISHED) | Signal |
|---|---|
| deadline ≥ now | `Inscripcions obertes` in detail; `Termini en N dies` in the list |
| deadline within 48h | Same text with `--warning` emphasis (dot + text, not a filled badge) |
| deadline < now ≤ start | `Inscripcions tancades` |
| start ≤ now ≤ end | `En curs` |
| end < now | `Finalitzada · pendent de tancar` (attention signal; suggests closing) |

- A DRAFT with deadline < now shows `El termini ja ha passat` in the detail,
  because the backend refuses to publish it (`expired_deadline`).
- CLOSED needs no timing signal.

## 8.3 Registration and payment states (user-facing)

Uses the existing labels in `public/labels.js`, never the backend codes:

| Backend | Label |
|---|---|
| NEEDS_PARTICIPANT_REVIEW | `Pendent de vincular` |
| AWAITING_PAYMENT_REVIEW | `Pendent de pagament` |
| CONFIRMED | `Confirmada` |
| REJECTED | `Rebutjada` |
| WITHDRAWN (3.5F) | `Retirada` |
| PENDING_REVIEW | `Pendent de revisió` |
| VERIFIED | `Verificat` |
| ISSUE | `Incidència` |

---

# 9. Nova activitat

## 9.1 Surface

- **Desktop (≥1180):** a large drawer from the right.
  - Width 600px (clamped to 90vw).
  - Height of the content area.
  - `--radius-panel` on the leading corners.
  - Level 3 floating surface: glass only on the drawer header and footer; the
    form body is solid for readability.
  - The list behind dims slightly and remains visible (MOTION 05).
- **Compact (768–1179):** the same drawer at min(600px, 80vw).
- **Mobile (<768):** a full-screen sheet with its own header (`Cancel·la` ·
  title · primary action) and safe-area insets.
- The form is **never** inserted into the list.

## 9.2 Header and footer

- Header: `Nova activitat` and a close control (`Esc`).
- Sticky footer:
  - secondary `Cancel·la`;
  - primary `Crear esborrany`.
- Creation always produces a DRAFT. Publishing is a separate, explicit act
  (§14).

## 9.3 Fields (current backend contract)

`POST /api/activities` accepts only these keys (extra keys are rejected):
`name`, `audience`, `sectionIds`, `location`, `startsAt`, `endsAt`,
`registrationDeadline`, `priceCents`, `shortDescription`, `materials`,
`specialNotice`, `transportOptions`.

Progressive disclosure groups them into sections.

### 1. Què i qui — always open

- **Nom** (required, max 120).
- **Per a qui** (required): a segmented choice `Tot el grup` | `Seccions`.
  - `Tot el grup` → `audience: GENERAL`, `sectionIds: []`. Offered only with
    `manageGeneral`.
  - `Seccions` → chip selection among the sections in `activities.manage`
    (1–4, at least one) → `audience: SECTIONS`.
  - If only one option exists, show it as fixed text, not a control.

### 2. Quan i on — always open

- **Inici** and **Final** (required; date + time, local time).
- **Termini d'inscripció** (required; date + time).
- **Lloc** (required, max 160).
- Inline rules mirroring the backend:
  - Final after inici: `El final ha de ser posterior a l'inici`.
  - Termini on or before inici: `El termini ha de ser abans de l'inici`.
  - If the deadline is already past, a non-blocking note:
    `Es podrà guardar, però no publicar amb un termini passat`.

### 3. Preu — always open, compact

- Choice `Gratuïta` | `De pagament` → `priceCents` (0 for free; euros input
  converted to cents; max 10.000,00 €).
- Disclosure `+ Transport organitzat pel grup` (collapsed by default). When
  enabled:
  - field **Suplement transport del grup** (euros, may be negative for a
    discount);
  - maps to `transportOptions: [{GROUP, adjustment}, {FAMILY, 0}]`. The backend
    requires both options together.
  - Inline: final price with group transport must stay between 0 and
    10.000,00 €.
- **Product decision (v1.0):** transport arranged by the family has a Gestió
  price adjustment of exactly **0 €**. The UI never offers another value, even
  though the backend accepts one. The form sends `FAMILY: 0`. The Informació tab
  shows `Transport per compte de la família (sense cost per al grup)`.

### 4. Informació per a les famílies — collapsed by default

Header: `Afegeix informació per a les famílies (opcional)`.

- **Descripció breu** (max 600).
- **Material** (max 400).
- **Avís especial** (max 400).
- Character counters appear only near the limit (≥ 80%).

## 9.4 Behaviour

- **Focus:** enters `Nom` on open. `Esc` or `Cancel·la` closes. With unsaved
  changes, a small confirmation appears:
  `Vols descartar els canvis?` → `Descarta` (destructive) / `Continua editant`.
- **Submit:**
  - validates everything inline first;
  - the primary button enters its loading state;
  - on success, the drawer closes, the new row is inserted in the list
    (MOTION 13) and the route changes to the new draft's detail
    (`#/activitats/<id>`);
  - toast: `Esborrany creat`.
- **Server errors** map to human copy (§14.4). Nothing is lost; the drawer stays
  open.

## 9.5 Edit (same surface)

- **Title and action:** `Editar activitat`; the primary action is `Guardar
  canvis`. The drawer opens pre-filled from the detail.
- **Allowed states:** DRAFT and PUBLISHED. CLOSED has no edit.
- **Version:** the drawer keeps the `version` it was opened with and sends it
  as `expectedVersion` (§14.3). It never retries a save automatically with a
  newer version.
- **Locked terms:** once the activity has any registration, the backend locks:
  - audience and sections;
  - dates and deadline;
  - price;
  - transport options.

  The detail read model includes `termsLocked` (a global boolean, no personal
  data, backend work B5). When it is true, those fields render read-only with:
  `Ja hi ha inscripcions: les dates, el preu, l'abast i el transport no es poden
  canviar.`

  The UI still handles `409 activity_terms_locked` in case registrations arrive
  while editing.

---

# 10. Activity detail

A dedicated page in the content area at standard width, addressed by
`#/activitats/<id>`.

## 10.1 Header

```text
← Activitats

Eixida · Tropa                                               ● Publicada
Tropa · dissabte 25 – diumenge 26 d'oct. · Espai de muntanya

                                                   [ Editar ]  [ ••• ]
```

- **Back link** `← Activitats` behaves like browser back when the user came from
  the list. It restores filters and scroll position. On a deep link without
  history it goes to `#/activitats`.
- **Title:** Page title typography. **Status badge:** §8.1.
- **Context line:**
  - scope · date range with weekday · location;
  - a second line shows the derived timing state (§8.2) when relevant, for
    example `Inscripcions obertes fins al dilluns 20 d'oct.`

Actions by state and capability:

| State | Primary | Secondary | `•••` menu |
|---|---|---|---|
| DRAFT, no registrations | `Publicar` | `Editar` | `Descartar esborrany` (destructive) |
| DRAFT with registrations (only possible through direct data) | `Publicar` | `Editar` | — |
| PUBLISHED | — | `Editar` | `Tancar activitat` |
| CLOSED | — | — | — (no menu) |
| Read-only (any state) | — | — | — (explanatory line instead) |

- `Tancar activitat` and `Descartar esborrany` are deliberately inside `•••`:
  they are final and should not compete with daily work.
- The `•••` menu is a popover (MOTION 07). It has no other entries in v1.0.

## 10.2 Operational summary

A single calm strip under the header. It is not a grid of metric cards: at most
four facts in one row, each a value plus a label.

| Fact | Source | Shown when |
|---|---|---|
| `12 inscripcions` (+ `3 per revisar`) | registration summary (B1) | review scope; partial label per §3.6 |
| `2 pagaments per revisar` | `registrations.awaitingPayment` | paid + review scope |
| `Termini en 3 dies` / `Inscripcions tancades` / `En curs` | dates | PUBLISHED |
| `15,00 €` / `Gratuïta` (+ `transport del grup +3,00 €`) | activity | always |

- **DRAFT:** replaces the strip with a readiness block `Abans de publicar`.
  It lists only real rules:
  - `✓ Termini d'inscripció futur` (a backend requirement; failing it shows
    `El termini ja ha passat: canvia'l per a poder publicar`).
  - A recommendation, visually distinct:
    `Recomanat: afegeix una descripció per a les famílies`, if the description
    is empty.

  Never invent other requirements.

## 10.3 Tabs

```text
[ Inscripcions ]  [ Informació ]
```

- **Visibility:**
  - Inscripcions per §3.4, and never on DRAFT.
  - DRAFT shows only Informació (no tab bar).
- **No Pagaments tab in v1.0.** Payment evidence appears inside Inscripcions
  when it can be related safely (§11.4).
- **Default tab:**
  - PUBLISHED/CLOSED with review scope → Inscripcions;
  - otherwise → Informació.
- **Routes:** each tab has its own hash route (§4.1); switching tabs pushes a
  history entry.
- **Tabs control:** segmented-style, Iris selected indicator, keyboard arrow
  navigation (WAI-ARIA tabs). Tab change uses a short cross-fade
  (`--motion-fast`).
- **Tab counts:** `Inscripcions 12` (or `Inscripcions 12 · Tropa` when
  partial). Shown only when known.

---

# 11. Inscripcions tab

## 11.1 Filters

```text
[ Totes 12 ] [ Per revisar 3 ] [ Pendents de pagament 2 ] [ Confirmades 6 ] [ Rebutjades 1 ] [ Retirades 1 ]
```

- `Retirades` (3.5F) appears only when there is at least one.

- `Per revisar` = NEEDS_PARTICIPANT_REVIEW.
- `Pendents de pagament` = AWAITING_PAYMENT_REVIEW; shown only for paid
  activities.
- Default: `Per revisar` if it has items, otherwise `Totes`.
- The active filter is part of the tab route (`?filtre=per-revisar`).

## 11.2 Registration row

Primary line:

- the submitted name;
- the registration state label;
- for paid activities, the payment state.

Secondary line:

- `Sol·licitada el 12 de set.`;
- the transport choice, if any.

Only NEEDS_PARTICIPANT_REVIEW rows are interactive for review. Clicking one
expands it in place (disclosure, MOTION 13 height transition) to show:

- the declared birth date (only retained while pending; label
  `Naixement declarat`);
- candidates from `/api/registrations/:id/candidates`:
  - name, section, and `naixement coincideix / no coincideix`;
  - the full birth date only if the server returns it (profile access, M4);
- `Cerca una altra persona` → `?search=`, minimum 2 characters, capped with the
  `truncated` notice;
- actions: `Vincula` (after choosing a candidate) and `Rebutja` (destructive
  style, separated). There is no auto-merge and no auto-create.

Other rows:

- `Mostra el contacte` requests the submitter's name, phone and e-mail on
  demand (3.5F: `GET /api/registrations/:id/contact`, permission
  `activities.registration.contact.read`, audited without values). Lists never
  carry contact data.
- The declared birth date comes with the candidates call while pending (3.5F),
  never in the list.
- Row menu, escalation, section correction, withdrawal and the linked
  participant: REGISTRATIONS.md §10–§13, §16. The confirmed list: §17.

## 11.3 Scope note

When partial (§3.6), a quiet line sits above the list:

`Veus les inscripcions de Tropa. Les d'altres seccions les revisa cada secció.`

## 11.4 Contextual payment evidence

For paid activities, when the user also has `verifyPayments` overlapping the
activity, rows in `Pendent de pagament` show the pending evidence inline:

- the expected amount and the review state;
- `Veure justificant`: authenticated preview inside Gestió (image or PDF) with
  `Descarrega` as fallback, each audited (3.5F, REGISTRATIONS.md §15.3);
- actions:
  - **`Verifica`** — 3.5F: dialog with total, already verified and remaining,
    asking for the amount verified now (instalments, REGISTRATIONS.md §9.2,
    §14.2); the result uses MOTION 09;
  - **`Marca incidència`** — only from `Pendent de revisió`.

The evidence is related to its registration through `registrationId` in
`/api/payments?activityId=…` (3.5F: server-filtered to this activity). The UI
never guesses by name or amount.

If the relation cannot be established safely for a row, that row shows only its
state label. Verified evidence and payment history are not listed in v1.0
(deferred, §24).

## 11.5 Empty states

- None at all: `Encara no hi ha inscripcions.`
- For a PUBLISHED activity with an open deadline, add:
  `Les famílies poden inscriure's des del portal fins al <termini>.`
- Filtered empty: `No hi ha inscripcions en aquest estat.` plus
  `Mostra-les totes`.

---

# 12. Informació tab

A read view of everything the activity contains. It is not a disabled form.

| Group | Content |
|---|---|
| Quan i on | start–end with weekday and time, deadline, location |
| Per a qui | `Tot el grup` or sections |
| Preu | base price or `Gratuïta`; transport: `Transport del grup: +3,00 €` / `Transport per compte de la família (sense cost per al grup)` |
| Per a les famílies | description, material, special notice (only non-empty ones; if all empty: `Encara no hi ha informació per a les famílies.`) |
| Dades internes (collapsed) | `Codi públic` with a copy control (for support); `Creada el …`, `Actualitzada el …` |

- Never show `created_by` or any other identifier. Creator display is deferred.
- Managers see `Editar` in the page header, not repeated inside the tab.

---

# 13. Payments in v1.0

A dedicated Pagaments tab is **not** part of v1.0. The backend has no
per-activity payment read model:

- `/api/payments` lists only evidence awaiting review, across all activities,
  without `activity_id`;
- verified evidence is not listed.

A tab would promise a financial history that does not exist.

For v1.0:

- the operational summary shows `N pagaments per revisar` from the registration
  summary (B1);
- review happens contextually in Inscripcions (§11.4);
- the Dashboard attention item `pagaments per revisar` opens the Inscripcions
  queue, the temporary payment surface until 3.5G (REGISTRATIONS.md §14, §18).

If during implementation a correct per-activity read model already exists, the
tab may be reconsidered with an explicit spec update. Otherwise it is deferred
(§24).

---

# 14. Actions and state transitions

## 14.1 Transitions

| Transition | Where | Confirmation | Backend | Result |
|---|---|---|---|---|
| Create → DRAFT | Nova activitat | none (reversible content) | `POST /api/activities` | Toast `Esborrany creat`; route to detail |
| Edit | Editar drawer | discard confirmation only on cancel with changes | `PATCH /api/activities/:id` with `expectedVersion` | Toast `Canvis guardats`; detail updates in place |
| DRAFT → PUBLISHED | `Publicar` (primary) | yes | `POST …/publish` with `expectedVersion` | MOTION 11; toast `Activitat publicada` |
| PUBLISHED → CLOSED | `•••` → `Tancar activitat` | yes, with consequence stated | `POST …/close` with `expectedVersion` | State morph (MOTION 08); no celebration |
| Discard DRAFT | `•••` → `Descartar esborrany` | yes, explicit | `DELETE /api/activities/:id` with `expectedVersion` (B3) | Route to list; the row collapses (MOTION 13); toast `Esborrany descartat` |

Publish confirmation:

- title: `Publicar l'activitat?`;
- body: `Les famílies la veuran al portal i s'hi podran inscriure fins al
  <termini>. Després de rebre inscripcions, les dates, el preu i l'abast ja no
  es podran canviar.`;
- actions: `Publica` (primary) / `Cancel·la`.

Close confirmation:

- title: `Tancar l'activitat?`;
- body: `Ja no s'hi podran fer inscripcions noves i no es pot tornar a obrir.`;
- actions: `Tanca l'activitat` (neutral-strong, not Iris) / `Cancel·la`.

Discard confirmation:

- title: `Descartar l'esborrany?`;
- body: `S'eliminarà «<nom>» definitivament. Aquesta acció no es pot desfer.`;
- actions: `Descarta l'esborrany` (destructive) / `Cancel·la` (default focus).

## 14.2 Discard rules (product decision)

A DRAFT may be discarded only when **all** of the following hold. The backend
enforces every condition; the UI mirrors them.

1. It is still DRAFT.
2. It has no registrations. This is guaranteed by the server check and by the
   database (`activity_registration` references `activity` with
   `ON DELETE RESTRICT`).
3. The user may manage it (§3.4).
4. The user explicitly confirmed (§14.1).
5. The `expectedVersion` still matches.

Discarding removes the activity together with its section and transport rows
in one atomic batch, and writes an audit event. PUBLISHED and CLOSED activities
can never be deleted.

## 14.3 Optimistic concurrency

- Every activity row and detail carries `version` (B2).
- Every write sends `expectedVersion`: edit, publish, close, discard.
- The server applies the change only if the version still matches and
  increments it; otherwise it returns `409 stale_activity` and writes nothing.
- This follows the existing project pattern (`versionCas` in
  `gestio/src/concurrency.js`, used by fee rounds and allocations).
- The UI never overwrites silently and never auto-retries.
- On `stale_activity`:
  - Edit drawer: keep the user's input, show an inline banner:
    `Algú ha canviat aquesta activitat mentre l'editaves. Els teus canvis no
    s'han guardat.` + `Torna a carregar` (reloads the detail and reopens the
    drawer with fresh data; the user's unsaved text stays visible in a
    collapsible `Els teus canvis` block so it can be copied).
  - Publish, close or discard: close the confirmation and reload the detail,
    with the inline message `L'activitat ha canviat. Revisa-la abans de
    continuar.`

## 14.4 Error copy

| Code | Copy |
|---|---|
| `invalid_activity` | `Revisa els camps marcats` (fields highlighted where determinable) |
| `forbidden` | `No pots gestionar activitats d'aquesta secció` |
| `activity_terms_locked` | `Ja hi ha inscripcions: les dates, el preu, l'abast i el transport no es poden canviar` |
| `activity_closed` | `Aquesta activitat està tancada` |
| `expired_deadline` | `No es pot publicar: el termini d'inscripció ja ha passat. Edita el termini i torna-ho a provar.` |
| `stale_activity` | §14.3 |
| `activity_has_registrations` (discard) | `Aquest esborrany ja té inscripcions i no es pot descartar.` |
| `invalid_transition` | `L'estat de l'activitat ha canviat. S'ha actualitzat la informació.` Then reload the detail |
| `not_found` (and out of scope) | `No tens accés a aquesta activitat o ja no existeix.` + `Torna a Activitats` |
| any other | `No s'ha pogut completar l'acció. Torna-ho a provar.` (nothing was saved) |

## 14.5 Not in v1.0

Duplicate, unpublish and reopen are not available. The UI shows no
placeholders for them.

Transitions never use optimistic UI: the state changes after the server
confirms (UX_RULES §22).

---

# 15. Light and dark

| Element | Light | Dark |
|---|---|---|
| Page | `--bg-primary` | `--bg-primary` (graphite) |
| List and detail surfaces | `--surface-primary`, `--border-default` dividers, low shadow | `--surface-primary`, tonal separation, soft border, no black shadow |
| Date tile | `--surface-elevated` | `--surface-elevated` with subtle top highlight |
| Row hover | `--surface-elevated` tint | slightly lighter surface + soft border |
| Drawer | header/footer high-opacity glass, solid body, Floating shadow | deep glass header/footer, solid body, subtle edge reflection |
| Status badges | soft tinted neutral; success/warning dots | same semantics with dark semantic tokens |
| Publication moment | Iris soft pulse on the badge surface | Iris soft pulse with extremely controlled glow |
| Discard / stale banners | semantic danger / warning tints, never Iris | same with dark tokens |

- Dark mode may feel deeper but must stay equally readable.
- No neon, no permanent glow.
- `prefers-reduced-transparency`: the drawer header and footer become opaque
  surfaces.

---

# 16. Responsive and mobile

## 16.1 Desktop ≥ 1180px

- Sidebar expanded (SHELL). List at standard width; three-zone rows (§7).
- Detail at standard width. Tabs inline. Drawer from the right.

## 16.2 Compact 768–1179px

- Sidebar rail. Rows keep all three zones; location (line 3) hides first.
- The secondary filter line may wrap to two lines. The drawer is narrower
  (§9.1).
- The summary strip may wrap into 2 × 2.

## 16.3 Mobile < 768px

Mobile is a different layout, not a compressed desktop.

- **Header:** `Activitats` and a compact icon button `+` (accessible name
  `Nova activitat`) (SHELL §26).
- **Segments:** a horizontally scrollable segmented control; counts hidden if
  space is short.
- **Filters:** search field full width, then `Filtres (n)` opening a bottom
  sheet with `Secció` and `Quan`, plus `Aplica` / `Neteja`.
- **Cards:** compact vertical cards (list items with 12px padding, 44px minimum
  target):
  - line 1: name + status badge;
  - line 2: scope · short date;
  - line 3: the single highest-priority signal (§7.2).

  The date tile is removed; the date moves into line 2.
- **Detail:** a full-screen page (same hash route) with a back chevron
  top-left; the system/browser back works identically.
  - The header wraps: title, badge under it, context lines.
  - Actions: `Publicar` or `Editar` as a full-width button under the header;
    `•••` stays top-right.
  - The summary becomes a 2 × 2 compact grid of facts.
  - Tabs become a sticky segmented control under the header.
- **Create/Edit:** full-screen sheet (§9.1); sections are sequential,
  collapsed sections as rows; the footer action is pinned above the safe area.
- **Registration review:** an expanded row becomes a full-screen step: choose
  a candidate → confirm.
- **Confirmations** (publish, close, discard, verify): bottom-sheet dialogs.

---

# 17. Motion

All patterns come from `MOTION_SYSTEM.md`. No new durations or easings.

| Moment | Pattern | Detail |
|---|---|---|
| List first load | Skeleton → content | Rows fade in once (`--motion-default`); no per-row stagger beyond 4 rows total; no motion on later reloads |
| Filters and segments | MOTION 13 | Matching rows reposition; removed rows collapse; `--motion-fast`. Segment indicator slides (Level 1). No animation when the result set is entirely replaced (>20 changes) |
| Card → detail | MOTION 04 (signature) | Name and status badge are shared elements; the row surface expands into the detail header; secondary content fades. `--motion-medium`–`--motion-slow`. Fallback: MOTION 03 context shift |
| Detail → list (back link or browser back) | Reverse of MOTION 04 | The row regains its place; scroll position restored |
| Deep link / refresh into detail | MOTION 01 | App enter; no shared-element travel (there is no source) |
| Tab change | Level 2 cross-fade | `--motion-fast`; content region only; the header stays still |
| Open Nova activitat / Editar | MOTION 05 | Drawer from the right, background dims; `--motion-default`–`--motion-medium`. Close is faster. Mobile: sheet rises from the bottom |
| Create draft | MOTION 13 + MOTION 15 | New row inserted in `Esborranys`, then route to the detail; toast `Esborrany creat` |
| DRAFT → PUBLISHED | MOTION 11 (signature) + MOTION 08 | The button enters its loading state; the badge morphs `Esborrany` → `Publicada` with a single soft Iris surface pulse on the badge; the readiness block is replaced by the summary strip; the row moves group (MOTION 13) |
| PUBLISHED → CLOSED | MOTION 08 | Badge morph to `Tancada`, emphasis reduces; no pulse, no Iris |
| Discard DRAFT | MOTION 13 (remove) | Route back to the list; the discarded row shows a brief removing state, then its height collapses; toast `Esborrany descartat`. No Iris, no celebration |
| Stale conflict | MOTION 15-like inline banner | Banner fades in inside the drawer or detail; nothing else moves |
| Registration reviewed | MOTION 08 + MOTION 13 | Row state morphs; if the filter excludes it, it collapses after a short pause (MOTION 10 sequence) |
| Registration count change | MOTION 12 | Short vertical number transition on counts in the summary and tab; only when caused by the user's action, never on load |
| Payment verified (contextual) | MOTION 09 | Per MOTION_SYSTEM; no celebration |
| Toasts | MOTION 15 | — |

`prefers-reduced-motion: reduce` applies:

- MOTION 04 → instant swap with a short opacity change;
- drawer and sheet → fade only;
- no pulse, no number interpolation (the value simply changes);
- list reflow without travel;
- the discarded row disappears after the toast appears.

Every result stays understandable without motion.

---

# 18. Accessibility

- **List:**
  - `role="list"` with headings per group;
  - each row is one link whose accessible name includes name, state, dates and
    the primary signal (for example `Eixida · Tropa, Publicada, 25 a 26
    d'octubre, 12 inscripcions`).
- **Route changes:**
  - move focus to the page title (`tabindex="-1"`) and update `document.title`
    (`Eixida · Tropa · Activitats · Gestió`);
  - announce the new page politely.
- **Segments and tabs:** follow the WAI-ARIA tabs pattern (arrow keys, Home and
  End).
- **Filters:** labelled controls; the result count is announced politely
  (`12 activitats`).
- **Drawer and sheet:** `role="dialog"`, `aria-modal`, focus trapped inside,
  `Esc` closes, focus returns to `Nova activitat` or `Editar`.
- **Form:**
  - visible labels, never placeholder-only;
  - errors are linked with `aria-describedby`, and the first invalid field
    receives focus on submit;
  - required fields are marked in text;
  - the stale-conflict banner uses `role="alert"`.
- **Status:** always text; colour and dots are supplementary.
- **Confirmations:** `alertdialog` with default focus on the safe choice
  (`Cancel·la`), especially for discard and close.
- **Targets:** ≥ 44px on touch; visible Iris focus ring.
- **Dates:** readable text (`dissabte 25 d'octubre`), not only numeric.

---

# 19. Privacy and security

- The UI never widens scope. It renders only what the server returns;
  capabilities only avoid pointless requests.
- Registration counts are aggregates computed server-side with the reviewer's
  scope. A section-scoped user never receives or can derive totals for other
  sections.
- `termsLocked` is a boolean without personal data; it is only returned to users
  who can read the activity.
- The list and summary contain no participant personal data.
- Registration contact data (phone, email) is revealed only on demand in the
  registration row, and is never shown in lists or summaries.
- Declared birth dates appear only on rows pending review. Candidate birth dates
  appear only when the server includes them (profile access); otherwise only
  `coincideix / no coincideix`.
- Payment evidence is previewed inside Gestió or downloaded, only through
  authenticated endpoints, and every view or download is audited (3.5F).
- URLs (hash) contain only the activity UUID, section codes and filter keywords.
  No personal data. The fragment is never sent to the server.
- No raw UUIDs, backend codes or English identifiers in visible UI text.
- Out-of-scope or missing activities return 404. The UI shows the same message
  for both (§14.4), including for deep links.
- Discard is audited server-side. Deleting is possible only for drafts without
  registrations. PUBLISHED and CLOSED activities cannot be deleted.
- Every write sends `expectedVersion`; there are no silent overwrites.

---

# 20. Loading, empty, error, conflict and permission states

| State | Behaviour |
|---|---|
| Loading (first) | Header and controls render immediately; 4 skeleton rows matching the row anatomy; calm, no shimmer sweep |
| Loading (refresh) | Keep current rows; a subtle inline progress indicator in the header; no blanking |
| Loading (deep link to detail) | Header skeleton (title, badge, context) + summary skeleton; tabs appear when capabilities are known |
| Normal | §5–§7 |
| Empty (no activities in scope) | `Encara no hi ha activitats.` + `Crea la primera activitat per a començar.` + `Nova activitat` (if permitted); read-only users see only the first sentence |
| Filtered empty | `Cap activitat coincideix amb els filtres.` + `Neteja filtres` |
| Error (list) | Inline in the list surface: `No s'han pogut carregar les activitats.` + `Torna-ho a intentar`; the header stays usable |
| Error (detail) | Inline in the page: `No s'ha pogut carregar l'activitat.` + retry + `Torna a Activitats` |
| Not found / out of scope | §14.4; identical for both |
| Partial error | The list and counts come in one response, so there are no per-row count failures. Inside the detail, Inscripcions, candidates and contextual evidence fail independently with their own inline error and retry |
| Conflict (stale) | §14.3: banner, the user's input is preserved, never an overwrite |
| Permission limited | Scope subtitle (§5.1); read-only line in detail (§3.5); Inscripcions hidden without review scope; no disabled clutter |
| No access to module | Not shown in navigation; a direct `#/activitats` shows the shell empty state (`Les activitats no estan disponibles en esta sessió.`) |
| DRAFT | Neutral outline badge; `Continuar editant →`; detail with readiness block and Informació only; `Descartar esborrany` if allowed |
| PUBLISHED | Success-dot badge; timing signal; tabs by capability |
| CLOSED | De-emphasised; no actions; history readable |
| Free | `Gratuïta`; no payment facts, no evidence |
| Paid | Price fact; `N pagaments per revisar`; contextual evidence if capable |
| General | Scope `Tot el grup`; readable by any activity reader; partial labels for section-scoped reviewers |
| Scoped section | Only the user's sections plus GENERAL; the section filter lists only those |
| Mobile | §16.3 |
| Light / Dark | §15 |

---

# 21. Demo scenarios

These scenarios are part of 3.5D (product decision). All data stays fictitious
(`Demo`, `example.test`).

**Dates relative to seeding time.** The demo dataset (`gestio/demo/data.js`)
must compute activity dates relative to the moment of `demo:seed` /
`demo:reset`, not fixed calendar dates, so that "deadline soon", "in progress"
and "ended" remain true whenever the demo is rebuilt.

Registration timestamps, and any fee data that depends on activity dates, move
with them. The demo test's expected counts are updated accordingly.

| # | Scenario | Relative timing (T = seed time) |
|---|---|---|
| D1 | GENERAL, published, a few registrations incl. one pending review | start T+21d, deadline T+14d |
| D2 | Tropa, published, paid, **many registrations** (≥ 20) mixing confirmed, pending review, pending payment and rejected | start T+10d, deadline T+2d (**deadline soon**, < 48h) |
| D3 | Published, **no registrations** | start T+30d, deadline T+20d |
| D4 | DRAFT, GENERAL, free (discardable) | start T+40d, deadline T+30d |
| D5 | DRAFT, section, paid, deadline already past (cannot publish) | start T+5d, deadline T−1d |
| D6 | Published, **in progress** | start T−1d, end T+1d |
| D7 | Published, **ended, pending close** | start T−10d, end T−9d |
| D8 | CLOSED, past, with registrations | start T−60d, end T−58d |
| D9 | Free and paid mix (covered by D1–D8) | — |
| D10 | Paid with **group transport supplement** (GROUP +X, FAMILY 0) | start T+15d, deadline T+7d |
| D11 | **Mixed** Tropa + Escolta activity (read-only for a Tropa-only coordinator) | start T+25d, deadline T+15d |
| D12 | Paid with contextual evidence: one pending review, one issue, one verified | inside D2 or D10 |

The base seed fixtures (dates in 2040) remain; the demo adds to them.

---

# 22. Components

Build only what this screen needs. Reuse the Dashboard pieces where they match.
Promote to `COMPONENT_LIBRARY.md` after visual validation.

| Component | Use |
|---|---|
| HashRouter (small module) | Parse/serialise `#/activitats…`; push vs replace; restore pending route after login; integrates with `shell.js` `navigateTo` and `view-registry.js` |
| PageHeader | Title, scope subtitle, primary action (SHELL §13) |
| SegmentedControl | Status segments, detail tabs, `Per a qui` choice, `Gratuïta`/`De pagament` |
| FilterBar | Search, `Secció`, `Quan`, reset; mobile `Filtres (n)` sheet |
| SearchField | Instant client-side search |
| ActivityRow | §7 (desktop/compact) and ActivityCardCompact (mobile) |
| DateTile | Day and month tile |
| StatusBadge | Activity, registration and payment states (§8) |
| ScopeLabel | `Tot el grup` / section names |
| Signal | Small text + optional semantic dot (deadline, attention, counts) |
| GroupHeader | List group titles with counts |
| Drawer / Sheet | Nova activitat / Editar |
| FormSection + Disclosure | Progressive disclosure in the form |
| DateTimeField, MoneyField | Local date/time; euros ↔ cents |
| SummaryStrip + Fact | Operational summary; DRAFT readiness block |
| Tabs | Detail tabs |
| RegistrationRow (+ ReviewPanel, EvidenceInline) | §11 |
| ConfirmDialog | Publish, close, discard, verify |
| ConflictBanner | §14.3 |
| OverflowMenu | `•••` |
| Toast, EmptyState, InlineError, Skeleton | Shared states |

Implementation convention: view modules under `gestio/public/views/` following
`view-registry.js`:

- the list, the detail, and the drawer as a shared sub-module;
- routing lives in one small router module, not scattered across views;
- the legacy Activitats markup and module are removed. Do not keep two UIs.

---

# 23. Backend work and gaps

## 23.1 Backend work included in 3.5D

These are small, scoped additions required by this spec. Each needs tests,
including authorisation and scope tests. None introduces a second API for an
existing flow.

| Id | Change | Notes |
|---|---|---|
| **B1** | Enriched `GET /api/activities` read model: per-row `registrations` summary `{scope, sections, total, needsReview, awaitingPayment, confirmed, rejected}` computed server-side in the same query or a batch | Same scope rule as `listRegistrations`; `null` without an overlapping review scope; no personal data; no per-activity requests. The detail endpoint returns the same summary |
| **B2** | Optimistic concurrency for activities: additive migration `activity.version` (NOT NULL, default 1); `versionCas` on PATCH, publish, close and discard; `expectedVersion` required; `409 stale_activity` | Follows the fee-round pattern. Historical migrations untouched |
| **B3** | `DELETE /api/activities/:id` (discard draft) with `expectedVersion` | Allowed only for DRAFT with no registrations and a manager; deletes the activity, section and transport rows atomically; audited (new audit action); `409 activity_has_registrations`, `409 invalid_transition` for non-drafts |
| **B4** | Separate GENERAL read from manage | GENERAL activities are listed and readable in detail by any holder of `activities.read` (any scope); manage keeps requiring `activities.general.manage`. Update the permission catalogue documentation, the capability semantics and the role matrix tests. Section scope rules for SECTIONS activities are unchanged |
| **B5** | `termsLocked` boolean in the activity detail | True when any registration exists; no personal data |
| **B6** | Enforce the family-transport decision server-side | Reject `FAMILY` adjustments other than 0 (`invalid_activity`) so the product rule cannot be bypassed |
| **B7** | Demo dataset: relative dates + scenarios D1–D12 | Updates `gestio/demo/data.js` and the demo test expectations |
| **F1** | Hash routing (§4.1) and Dashboard entry points | Dashboard `openActivity` → `#/activitats/<id>`; attention items → Inscripcions tab filtered; the legacy form is no longer reachable |

## 23.2 Gaps that remain open (not in 3.5D)

**G2 — No server-side filtering or search on `/api/activities`.**
- Client-side filtering is sufficient at current volume. Revisit if the list
  grows significantly.

**G6 — No per-activity payment history.**
- 3.5F: `/api/payments` filters by `activityId` and lists verified evidence in
  the `totes` view (purpose-limited projection). A Pagaments tab and financial
  history remain for 3.5G.
- v1.0 uses contextual evidence (§11.4) and summary counts. The full Pagaments
  tab and payment history are deferred.

**G8 — Resolved in 3.5F.**
- The linked participant's name and record link are returned with
  `participants.profile.read` over that participant.

**G10 — No human-readable activity history** ("publicada per …").
- Deferred, as for Dashboard Recent Activity.

**G12 — No capacity or places field.**
- Deferred. The UI must not show places.

**G15 — No creator display.**
- `created_by` is only a UUID. Creator display is deferred and the UI must not
  show it.

## 23.3 Resolved by product decision

| Former gap | Decision |
|---|---|
| G1 registration counts | Resolved in 3.5D by B1 |
| G3 routing / deep links | Resolved in 3.5D by F1 (§4.1) |
| G4 terms locked | Resolved in 3.5D by B5 |
| G5 concurrency | Resolved in 3.5D by B2 |
| G7 GENERAL read vs manage | Resolved in 3.5D by B4 (§3.3) |
| G9 delete/unpublish/reopen/duplicate | Discard DRAFT in scope (B3, §14.2); unpublish, reopen and duplicate are out of v1.0 |
| G11 family transport | Fixed at 0 € by product decision (§9.3), enforced by B6 |
| G13 demo | In scope (B7, §21) |
| G14 Dashboard entry | In scope (F1) |

---

# 24. Explicit v1.0 scope

**In scope for 3.5D:**
- list with status segments, search, section and time filters (URL-backed);
- rich rows and mobile cards with server-side registration counts;
- the Nova activitat and Editar drawer/sheet with the real contract, family
  transport fixed at 0 € and `termsLocked`;
- the detail page with header, actions, summary or readiness block;
- tabs Inscripcions (review + contextual payment evidence) and Informació;
- publish, close and discard draft with confirmations and optimistic
  concurrency;
- hash routing with refresh, back/forward and deep links;
- GENERAL read separated from manage;
- all states in §20;
- light and dark;
- responsive per §16;
- the motion in §17 with reduced-motion support;
- Dashboard entry points to the new detail;
- demo scenarios D1–D12 with relative dates;
- backend work B1–B7.

**Out of scope (deferred):**
- duplicate activity;
- unpublish;
- reopen;
- capacity/seats;
- human-readable activity history;
- creator display;
- a full activity payment history or Pagaments tab;
- server-side list filtering;
- redesign of Participants, Quotes, Incidències (Inscripcions global page: delivered in 3.5F),
  Administració;
- calendar views;
- historical charts;
- cover images;
- social features;
- exports;
- ⌘K activity search (it may link to the detail route later).

---

# 25. Acceptance criteria

1. A coordinator understands in under five seconds which activities are open,
   which are drafts and which need attention.
2. The list is a calm single column of rich rows: no table, no card grid, no
   persistent per-row buttons.
3. The whole row opens the detail; keyboard and screen reader work end to end.
4. The list loads registration counts with **no request per activity**; partial
   counts are labelled (`12 inscripcions de Tropa`); unknown counts are
   omitted, never `0`.
5. `Nova activitat` never inserts a form into the list; it opens the
   drawer/sheet with progressive disclosure and only the real backend fields.
   Family transport is fixed at 0 € (UI and server).
6. Creating always yields a DRAFT and lands on its detail route.
7. Publish, close and discard require confirmation, never use optimistic UI,
   and explain `expired_deadline`, irreversibility and the discard rules.
8. Only drafts with no registrations can be discarded, by users who can manage
   them. PUBLISHED and CLOSED can never be deleted.
9. Concurrent edits never overwrite silently: a stale version produces
   `409 stale_activity`, a human message, and the user's input is preserved.
10. A Tropa coordinator with the GENERAL grant manages Tropa and GENERAL
    activities, sees mixed activities read-only, and never gets Escolta
    management. A section delegate can consult GENERAL activities without
    managing them.
11. Free activities show no financial elements. Paid activities show payment
    information only to capable users. There is no generic Pagaments tab.
12. Refresh, back/forward and deep links work for the list (with filters), the
    detail and its tabs. Out-of-scope and missing links show the same message.
13. The Dashboard opens the new detail; the legacy form is unreachable.
14. No raw UUIDs in visible text, no backend codes, no creator ids and no
    unnecessary personal data are visible; URLs contain no personal data.
15. Loading, empty, filtered-empty, error, conflict and permission-limited
    states behave per §20.
16. Light feels luminous; dark feels deep and premium; both keep AA contrast.
17. Mobile uses its own patterns (compact cards, full-screen detail, sheet
    creation, filter sheet) with ≥ 44px targets.
18. Motion follows §17; with reduced motion every change remains
    understandable.
19. Backend changes B1–B7 have authorisation, scope, concurrency and regression
    tests. The demo scenarios D1–D12 exist with relative dates. All existing
    tests, lint, typecheck and CI stay green.

---

# 26. Human visual validation checklist

Validate with the demo dataset (freshly reset), in light and dark, at desktop
(≥1180), compact (~1000) and mobile (~390):

- [ ] First impression: calm, polished, clearly Gestió (not a SaaS panel, not a
      table).
- [ ] Status of every row is readable without relying on colour.
- [ ] Drafts invite completion without dominating the list.
- [ ] D2's deadline in under 48h is noticeable but not alarming.
- [ ] D7 `Pendent de tancar` and D6 `En curs` read correctly.
- [ ] D2 with many registrations stays calm; counts are right; `3 per revisar`
      stands out appropriately.
- [ ] D3 without registrations reads as normal, not as an error.
- [ ] Search and filters feel instant; the URL reflects them; refresh keeps
      them; the reset is obvious.
- [ ] Card → detail feels continuous; browser back returns to the same scroll
      position.
- [ ] A copied detail link opens the same activity and tab in a new tab.
- [ ] The detail reads as an operational entity, not as a form.
- [ ] Tabs make sense for free, paid, general and section activities; no empty
      financial module.
- [ ] Nova activitat: a first-time monitor can create a draft without help.
- [ ] Optional sections stay out of the way until needed.
- [ ] Validation messages are clear and appear before submit.
- [ ] Publishing feels like a meaningful moment, not a celebration.
- [ ] Closing clearly communicates that it is final.
- [ ] Discarding D4 feels safe: clear consequence, safe default focus, calm
      removal.
- [ ] Editing the same activity in two windows shows the conflict message and
      loses nothing.
- [ ] Registration review is understandable; contact data only on demand;
      evidence is inline only where relevant.
- [ ] A Tropa coordinator sees Tropa and GENERAL, and D11 as read-only; a
      section delegate can open D1 but not edit it.
- [ ] A user without review capability sees no counts and no empty tabs.
- [ ] Mobile feels designed for mobile: cards, sheets, full-screen detail.
- [ ] Reduced motion: nothing is lost.
- [ ] Nothing shows UUIDs, backend codes or English state names in the UI.

The desired reaction:

"I know exactly how every activity is going and what to do next."

followed by:

"This feels extremely polished."
