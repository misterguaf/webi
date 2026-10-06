# Phase 3.5I — Implementation report (global integration / responsive / UX consistency)

Factual record of the Phase I candidate. Not an independent audit. Phase I is **not closed**: no `phase-3.5i-complete`,
no `pre-j`, no canonical I branch. Borja reviews it first (`docs/reviews/PHASE_3_5_I_HUMAN_REVIEW.md`).

- Base: `pre-i` = `dfea4be70ba4011dd81cade95ddd342f1af687dd` (Phase 3.5H closed).
- Branch: `phase/3.5i-integration`.
- Final candidate SHA and its GitHub Actions run: recorded in the final hand-off to Borja (this file is part of that
  candidate, so it cannot contain its own SHA).

## Commits

| Commit | Scope |
|---|---|
| I.1 shell | pages offered only when usable, capability/session sync, overlays dismissed at session end, human client errors, no double submit, mobile toolbar/detail overflow |
| I.2 copy | legacy Quotes without backend states/codes/ids, one money format, role/section/state names, «Esculta», dashboard link label |
| I.3 states/responsive/cross-module | scoped error banner, real-date filters, payment queue links when permitted, way back from missing requests, dialogs fit small screens |
| I.4 lifecycle | requests belong to their session; late answers are dropped |
| I.5 docs | this report and the human review checklist |
| I.4 fix | only late data is dropped (errors settle), found by the full suite: the shell test hung on logout |
| I.6 demo | realistic invented names for a 104-educand group; local selector shows each role (Borja's request) |

## How the inventory was made

Isolated worktree and Wrangler instance (`--port 0`, own `.wrangler` state, demo dataset seeded with a scratch preload
that only redirected the demo CLI's 8788 probe; Borja's 8788 server untouched). Automated browser sweeps per identity
(101 Coordinació general, 102 Coordinació Tropa, 104 Tresoreria, 105 Secretaria, 106 CRM, 107 TECH_ADMIN alone) over
every page, sub-route and representative detail at 375, 768, 830 and 1024 px, measuring horizontal overflow, visible
error blocks, global error banner, unlabelled controls and visible technical codes/UUIDs; then code reading of the
shell, router, view registry, HTTP client and every view's load/unload.

## Integration problems found → fixes

**Navigation / permission-aware UI**
- Only Inscripcions and Tresoreria were hidden when unusable; every other page stayed in the sidebar, mobile bar,
  «Més» and search, leading to «no disponible» screens (e.g. TECH_ADMIN saw Activitats, Quotes, Participants).
  → `view-registry.availablePages(caps)`: a page is offered iff one of its views is available; `shell.setAvailablePages`
  applies it to sidebar, mobile bar, «Més» and search; a deep link to an unusable page lands on Inici.
- Mobile bottom bar was fixed (Inici, Activitats, Quotes, Participants): Tresoreria's main tool was buried in «Més».
  → the bar shows the first four usable pages by priority; the rest go to «Més».

**Lifecycle / session**
- Capabilities were read only at login: a revoked role/delegation left protected screens visible until reload.
  → `session-sync.js`: re-reads `/api/me` when the tab becomes visible, after a generic 403 (`forbidden`), and on
  navigation (throttled to 30 s). Changed access → screens reloaded, unusable ones unloaded, unusable page left for
  Inici; another person → full reset. Verified in the browser by revoking a grant in the synthetic D1.
- Dialogs, drawers, sheets and menus appended to `<body>` survived session end (data over the login screen, keyboard
  handlers still trapping focus). → `trackOverlay`/`dismissOverlays` in `ui.js`; every overlay registers; `hide()`
  dismisses them first. Verified: revoking the session with the report dialog open returns to the login screen.
- Late responses from a previous session could paint into the next one (legacy loaders have no request tokens).
  → the HTTP client tags requests with a session epoch; `endSession()` on logout/expiry/user change drops late answers.
- The account screen and the dashboard only hid their DOM on unload. → previous person's name, roles, sessions and
  dashboard lists are removed.

**Common states / errors**
- The client turned every 4xx into `code · requestId` and several screens showed it raw. → `humanError()`: one Catalan
  sentence per kind of failure; code and request id stay on the error object for screens and support.
- The global «No s'han pogut carregar algunes dades» banner fired on 4xx (already explained in place) and never cleared
  until reload. → only network/5xx raise it; it clears when the page changes.
- Activitat accepted impossible dates from the URL (`2026-99-99`) and got a 400. → real calendar dates only.
- A missing/out-of-scope admission request had no way back. → «← Noves altes» like every other detail.

**Forms**
- No protection against double clicks on most action buttons (server CAS/UNIQUE caught them as confusing errors).
  → `h()` marks a button `aria-busy` while its async click handler runs and ignores further clicks (not `disabled`, so
  focus and each screen's own disabled states are untouched).

**Responsive**
- `#/participants` at 375 px: page 533 px wide («Nou participant» off-screen) since H.2 added «Noves altes»; Secció and
  Estat filters were hidden on mobile (no way to see inactive participants). → toolbar wraps; filters stay visible.
- Mobile detail action grids overflowed with long labels (user detail in Administració, +4 px). → buttons may wrap text.
- Dialogs had no max height (actions unreachable on short screens). → capped to the viewport, internal scroll.
- After the fixes: no horizontal overflow on any swept route at 375/768/830/1024 px for the six identities.

**Copy**
- Legacy Quotes (Tresoreria full view) showed section UUIDs, `PENDING/PAID/ISSUE`, issue codes, payment/obligation ids,
  `3500.00 €` and a monospace block. → section names, Catalan state/issue labels, quotas by name, `formatEur`, readable
  summary; fee status filter options labelled.
- «Escolta» survived in the Quotes section filter (`index.html`). → «Esculta».
- «El meu compte» showed `GROUP_COORDINATOR`, `TROPA`, `ACTIVE`. → shared `ROLE_LABELS`, `SECTION_LABELS`,
  `ACCOUNT_STATUS_LABELS` in `labels.js` (also used by the shell profile).
- Dashboard (section coordinators): «Veure participants →» opened Quotes. → «Veure quotes →».

**Cross-module**
- Inscripcions payment queue: names were plain text although the server includes the participant only when the viewer
  may read it. → person links to the record when included; activity links only for people who use Activitats.
- Already correct and kept: activity registrations tab → participant (server-gated), Noves altes → participant (H.3),
  Activitat → resource (server-decided links), incidents → admission request (server-decided).

## Realistic demo (Borja's request during Phase I)

`gestio/demo/names.js` builds invented Valencian names deterministically; the demo now has 104 educands (the 15
original families and every fee/registration/treasury scenario unchanged, plus 45 families with 64 children), guardians
for most families, realistic activity names/places/codes, payers, counterparties and bank descriptions, and renames the
canonical seed's visible records **in the local demo database only** (`seed.sql` and every test fixture keep their
«(fictici)» names). Fences kept: `@example.test` addresses, synthetic marker in evidence, zero IBAN, the «Entorn local ·
dades de demostració» indicator, `SYNTHETIC_ONLY` intake checks. Seed activities with registrations keep their 2040
dates (the terms lock forbids changing them). A test guarantees 104 unique names and no visible demo/fictitious text.

## Tests added / changed

- New `test/gestio-integration-shell.test.js` (9 tests): session sync (unchanged / changed / other user / throttle /
  forced / failure), page availability and shell guard wiring, busy buttons and overlay dismissal, human client errors,
  unload clearing, copy (no codes/ids/enums, Esculta, money format), scoped error banner and real-date filters,
  cross-module link gating, way back, dialog sizing, dropped late answers.
- `test/gestio-treasury-ui.test.js`: wiring assertion moved from `setNavAvailable('tresoreria', …)` to the registry
  mechanism (the treasury view declares `available: caps => treasuryAvailable(caps)`).
- No new Workerd-based tests (the safe `test/helpers/wrangler-port.js` remains the pattern).

## Validation

- Targeted UI/shell suites: green at each checkpoint.
- Full local gate, remote CI: see the final hand-off (exact SHA and run id).

## Known objective debt (not fixed in I)

- Participant → registrations/activities: the participant detail API has no registrations; linking them needs new
  server data (not invented in I).
- Capability changes while idle on the same page without tab focus changes are only noticed on the next navigation
  (≤ 30 s throttle), a 403, or returning to the tab; the server still refuses everything.
- The demo CLI (`npm run demo:seed`) refuses to run while anything listens on 8788, even with a separate state dir.
- Legacy Quotes view is functionally coherent but remains the 3B form UI (cents inputs, plain lists).

## Deferred to Phase J (subjective)

Legacy Quotes redesign; expressiveness of the mobile bar for roles with few pages; irregular wrapping of long action
labels on mobile; busy-button spinner hides the label (existing style). Listed for Borja in the review checklist.

## Product decisions NOT changed

Backend authorisation remains authoritative (UI visibility is advisory); no permission widened; TECH_ADMIN alone is not
a superuser; no self-escalation or subdelegation; scopes server-enforced; admissions candidates never public; Health
untouched; no payment gateway or automatic bank matching; no silent merge; Treasury canonical with Excel export only;
no schema changes (no migration in Phase I); no staging/production infrastructure.
