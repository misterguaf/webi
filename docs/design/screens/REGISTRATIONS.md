# Gestió — Inscripcions

Status: APPROVED FOR IMPLEMENTATION — v0.2 reviewed by Borja/Atlas (2026-10-01)
Version: 0.2
Project: Grup Scout Parpalló — Gestió
Phase: 3.5F
Baseline: `phase-3.5e-complete` (`97fb9f3`)
Depends on:

- ../DESIGN\_VISION.md
- ../DESIGN\_SYSTEM.md
- ../MOTION\_SYSTEM.md
- ../UX\_RULES.md
- SHELL.md, DASHBOARD.md
- ACTIVITIES.md (Inscripcions tab §11, payments §13, privacy §19)
- PARTICIPANTS.md (scope by current section, audited contact consultation)
- ../../AUTHORIZATION\_MODEL.md, ../../PHASE\_3A\_REPORT.md

Changes in 0.2 (decisions of Borja/Atlas on D1–D12, 2026-10-01):

- The `Inscripcions` page becomes a **global work queue**; the activity tab
  stays the surface where a registration is worked (§6).
- Three section concepts: declared, registration (operational, historical) and
  the participant's current section (§7). Scope follows the registration
  section.
- Section correction and escalation to global review instead of a forced
  rejection (§12).
- Payment verification stays with `finance.payment.verify` holders; a
  purpose-limited payment projection replaces the legacy list until 3.5G
  Tresoreria (§14).
- Contact data leaves every list; `Mostra el contacte` is an audited request
  with its own permission (§11).
- Evidence: real MIME, authenticated preview and named download, both audited;
  photo optimisation in the portal; retention-ready (§15).
- New registration state `WITHDRAWN` / `Retirada`; neutral notices on rejection
  and withdrawal (§9, §13).
- Linked participant shown only with profile access; operational list of
  confirmed people per activity (§16, §17).
- Authorisation order fixed for every registration resource (§8.4).

Visual language stays Iris (light/dark). The global redesign remains reserved
for 3.5J.

---

# 1. Purpose

Inscripcions is where the group processes what families send from the portal
for an activity: link each request to the right participant or decline it,
record withdrawals, verify payment evidence, and know who is confirmed.

Families never see Gestió. The portal answers every submission with the same
neutral response whatever the matching outcome.

---

# 2. Product principles

- **The server decides scope.** The UI only avoids pointless requests.
- **Minimise by default.** Lists contain only what is needed to decide the next
  action. Anything else is requested on demand, authorised and, where it is
  personal data, audited. Nothing is sent to the browser just to be hidden.
- **Signals, not master data** in matching (audit M4).
- **No automatic merge, no automatic creation, no automatic cross-section
  link.** Ambiguity goes to a human.
- **History is kept.** The declared section, every correction, every review,
  rejection and withdrawal stay recorded.
- **Separate domains.** Rejection ≠ withdrawal ≠ payment incidence ≠ refund.
  Refunds and reconciliation belong to 3.5G Tresoreria.
- **Never overwrite silently.** Writes carry `expectedVersion`; no optimistic UI.
- **No health data** in a registration. Dietary exports are a Phase 5 matter
  (§19).

---

# 3. Baseline (v0.1 audit, inspected at `97fb9f3`)

Kept as reference for implementation.

## 3.1 Data model today

`activity_registration` (0003–0005): `submitted_name`, `match_key`,
`submitted_section_id` (declared by the family, mandatory in the intake),
`submitted_by_name`, `contact_phone`, `receipt_email`, `submitted_birth_date`
(only while pending), `participant_id`, `transport_code`,
`expected_amount_cents`, `match_status` (`CLEAR`, `AMBIGUOUS`, `NONE`,
`RESOLVED`, `REJECTED`), `status` (`NEEDS_PARTICIPANT_REVIEW`,
`AWAITING_PAYMENT_REVIEW`, `CONFIRMED`, `REJECTED` — fixed by a `CHECK`),
acknowledgement versions, `reviewed_by/at`. No version.

`payment_evidence`: one per registration; bytes already in **R2**
(`EVIDENCE_STORAGE`, bucket private, jurisdiction `eu`); D1 keeps `object_key`
(opaque, `synthetic/…` prefix in development), `sha256`, `size_bytes`
(≤ 4 MiB), `detected_mime` (`application/pdf`, `image/png`, `image/jpeg`,
`image/webp`, detected from magic bytes and required to agree with the declared
type and the extension), `review_status`, `created_at`, `reviewed_by/at`. The
original file name is validated but **not stored**.

`notification_outbox`: kinds `RECEIVED`, `PENDING_PAYMENT`, `CONFIRMED`,
`PAYMENT_ISSUE` (fixed by a `CHECK`), unique per registration and kind; fake
provider locally (`notification_capture`).

## 3.2 Problems found in v0.1

Scope by declared section for registrations but current section for payments;
contact data in every list row and revealed without audit; evidence served as
`justificant.bin`; Tresoreria's only surface is an unstyled legacy list without
confirmations; incidence has no follow-up; withdrawals recorded as rejections;
silent rejection; wrong declared section is a dead end; authorisation checked
after state; evidence downloads not audited; the activity tab downloads every
pending payment and filters in the browser; `Inscripcions` navigation leads to
almost nothing. Resolutions in §22.

---

# 4. Roles and permissions

## 4.1 Permissions used

| Permission | Kind | Purpose |
|---|---|---|
| `activities.registration.review` | SCOPED, delegable | see registrations of a section, match, reject, withdraw, escalate, correct section (with §12.3 rule) |
| `activities.registration.contact.read` | **new**, SCOPED, delegable | reveal the submitter's name, phone and e-mail of a registration (audited) |
| `finance.payment.verify` | SCOPED, delegable | see the payment projection, preview/download evidence, verify, mark incidence |
| `activities.read` | SCOPED | open the activity detail |
| `participants.profile.read` | SCOPED | see the linked participant's name and link; candidate birth dates |

`participants.contact.read` is **not** reused: the submitter of a registration
is not necessarily a master contact of the participant.

**Global review** = `activities.registration.review` with group-wide scope
(evaluated as `all-sections`, the existing `requireGroupWide` helper). No new
"global" permission is needed.

## 4.2 Default matrix (new migration + seed)

| Role | registration.review | registration.contact.read | payment.verify | activities.read |
|---|---|---|---|---|
| Coordinació general | group | group | group | group |
| Secretaria | **group (new)** | **group (new)** | — | **group (new)** |
| Coordinació de secció | own section | own section (new) | — | own section |
| Delegat/da de secció | own section, if delegated | own section, if delegated (new) | own section, if delegated | own section, if delegated |
| Tresoreria | — | — | group | — (**not granted**) |

- Secretaria's three grants are the minimum to perform the global review
  approved in §12 (escalated cases, section correction) in the activity tab.
- Section coordinators keep contact access they have today (now behind an
  explicit, audited request).
- Section coordinators do **not** receive `finance.payment.verify`.
- The model still requires role **and** individual grant; the seed adds the
  synthetic grants.

## 4.3 Capabilities (`/api/me`)

`capabilities.registrations = { review, reviewGlobal, readContacts,
verifyPayments }`, each `null` or `{ all, sections }` like the existing
projections. The UI uses them only to avoid requests and to show actions.

---

# 5. Information visible

| Data | Queue | Activity tab row | Expanded row | Payment projection | Condition |
|---|---|---|---|---|---|
| Activity name, dates | ✓ | — | — | ✓ | review or verify scope |
| Submitted name | — | ✓ | ✓ | ✓ | review or verify scope |
| Registration state | counts | ✓ | ✓ | ✓ | — |
| Payment state | counts | ✓ (paid) | ✓ | ✓ | — |
| Registration section | ✓ (partial note) | ✓ (GENERAL) | ✓ | ✓ when the activity is GENERAL | — |
| Declared section | — | — | ✓ only if it differs | — | review scope |
| Transport | — | ✓ | ✓ | ✓ only if it changes the amount | — |
| Request date | — | ✓ | ✓ | ✓ | — |
| Linked participant (name, link) | — | ✓ | ✓ | ✓ | `participants.profile.read` over the participant |
| Declared birth date | — | — | ✓ pending only (from the candidates call) | — | review scope |
| Candidates and signals | — | — | ✓ pending only | — | review scope (§12) |
| Submitter, phone, e-mail | — | — | on demand | — | `registration.contact.read` + audit |
| Amount, evidence state, received | — | ✓ | ✓ | ✓ | verify scope |
| Evidence preview / download | — | — | ✓ | ✓ | verify scope + audit |
| Withdrawal: when, source | — | — | ✓ | ✓ (flag) | review or verify scope |
| Review date | — | — | ✓ (`Revisada el …`) | ✓ | review or verify scope; the reviewer's identity is not shown |

Never visible: UUIDs, backend codes, health data, other sections' rows or
counts, contact values in any list, the original file name.

---

# 6. Information architecture

## 6.1 Surfaces

| Surface | Route | Role |
|---|---|---|
| **Inscripcions (global queue)** | `#/inscripcions` | what needs attention, across activities; payment work until 3.5G |
| **Activitat → Inscripcions** | `#/activitats/:id/inscripcions` | where a registration is worked (review, contact, withdrawal, section, evidence) |
| **Activitat → Inscripcions → Confirmats** | `#/activitats/:id/inscripcions?vista=confirmats` | operational list of confirmed people (§17) |

The queue does **not** reimplement the review panel. Registration items in the
queue are counts per activity that open the activity tab with the right filter.
Payment items are rows with their actions, because Tresoreria has no access to
the activity tab (§14).

## 6.2 Queue views

```text
Inscripcions
[ Pendents de revisar ] [ Incidències ] [ Totes ]          (route ?vista=…)
```

| View | Registrations (review holders) | Payments (verify holders) |
|---|---|---|
| `Pendents de revisar` | per activity: `n pendents de vincular`, `n en revisió global` (global reviewers: actionable; section reviewers: informative) | rows with evidence `Pendent de revisió` |
| `Incidències` | — | rows with evidence `Incidència` |
| `Totes` | per activity: counts by state (`pendents`, `confirmades`, `rebutjades`, `retirades`) | rows of every payment in scope, paginated |

- Default: `Pendents de revisar`.
- Grouping: one group per activity, ordered by nearest registration deadline,
  then start date. Group header: activity name, dates, `vista parcial` +
  section names when the summary is `PARTIAL`.
- Example:

```text
Campament d'hivern                      3 pendents de vincular   →
Excursió Tropa                          2 pendents de vincular   →
Activitat general · vista parcial (Tropa) 2 pendents de vincular →
```

- A user with both capabilities sees both blocks under each view
  (`Inscripcions` then `Pagaments`).
- A user without either capability does not see the navigation item.
- Empty: `No hi ha res pendent.`; `Incidències` empty: `No hi ha incidències
  de pagament.`
- Routes carry only keywords (`?vista=pendents|incidencies|totes`).
- Activities: PUBLISHED and CLOSED with registrations in scope. In `Totes`,
  CLOSED activities older than the start of the current scout year are
  collapsed under `Activitats anteriors` (no extra request until opened).

## 6.3 Navigation badge (SHELL §8.2)

`Inscripcions · n` where `n` = pending review items the user can act on
(registrations pending at their level + payments pending + payment
incidences), from the queue summary endpoint (§20 B2). No badge when 0.

---

# 7. Section model

| Concept | Column | Meaning | Changes |
|---|---|---|---|
| **Declared section** | `submitted_section_id` (kept; documented as *declared*) | what the family stated | never |
| **Registration section** | `registration_section_id` (**new**) | operational and historical section of the registration | only by the section correction (§12.3), only before linking |
| **Participant's current section** | `participant.current_section_id` | where the person is now | Participants (3.5E); never rewrites a registration |

Rules:

1. At intake `registration_section_id = submitted_section_id`.
2. Scope, counts, summaries, candidates, review, contact, withdrawal, payments
   and evidence all use **`registration_section_id`**.
3. Linking requires the participant's current section to equal the
   registration section at that moment (today's rule, moved to the new column).
4. After linking, the registration section is frozen.
5. A later section change of the participant moves nothing: a June Tropa
   registration stays Tropa (and its payment stays with Tropa's verifiers)
   after the move to Escolta in September.
6. Existing rows are backfilled `registration_section_id =
   submitted_section_id`. Rows with neither (none expected; `sectionCode` is
   mandatory) are visible only to global reviewers.

---

# 8. Scope and authorisation

## 8.1 Registration resources

- A section reviewer sees registrations whose registration section is in scope.
- GENERAL activity: only rows of their sections; the summary is `PARTIAL` with
  section names.
- SECTIONS activity without overlap: 404, like a missing activity.
- Global reviewers see every registration.

## 8.2 Payments

`finance.payment.verify` scoped by the registration section. Tresoreria
(group) sees all. The payment projection grants no activity read or manage.

## 8.3 Escalated registrations

Visible to the section reviewers of the registration section as `En revisió
global` without actions (§12.2). Actionable only by global reviewers.

## 8.4 Authorisation order (every resource endpoint)

1. Authenticate.
2. Check the capability in general (`mode: list`): no grant anywhere →
   **403**, audited `AUTHZ_DENY`.
3. Resolve the resource **within the allowed scope** (one query with the scope
   predicate).
4. Missing or out of scope → **404**, identical body, audited
   `AUTHZ_DENY` (`NOT_FOUND` / `OUT_OF_SCOPE`).
5. Only then: state, version, transition, payload checks → **409** / **400**.
6. Then the write.

Applies to: registration read, candidates, match/reject, contact, section
correction, escalation, withdrawal, payment projection item, payment review,
evidence preview and download. A 403/409 never reveals a resource outside scope.
Validation of a referenced participant (`participantId` in a match) happens
after step 4 and answers 404 for a participant outside the reviewer's scope.

---

# 9. States

Three separate machines. None of them encodes refunds.

## 9.1 Registration state

| Backend | Label | Meaning |
|---|---|---|
| `NEEDS_PARTICIPANT_REVIEW` | `Pendent de vincular` | not yet linked to a participant |
| `AWAITING_PAYMENT_REVIEW` | `Pendent de pagament` | linked; paid activity; evidence not yet verified |
| `CONFIRMED` | `Confirmada` | linked; free, or evidence verified |
| `REJECTED` | `Rebutjada` | the group does not accept the request |
| `WITHDRAWN` (**new**) | `Retirada` | the family communicated that the person stops participating |

Escalation is an attribute, not a state: `review_level` `SECTION` / `GLOBAL`
(label `En revisió global`).

```text
intake ─ CLEAR, free ─────────────► CONFIRMED
       ─ CLEAR, paid ─────────────► AWAITING_PAYMENT_REVIEW
       ─ AMBIGUOUS / NONE ────────► NEEDS_PARTICIPANT_REVIEW   (review_level SECTION or GLOBAL, §12.2)

NEEDS_PARTICIPANT_REVIEW ── link, free ──► CONFIRMED
                         ── link, paid ──► AWAITING_PAYMENT_REVIEW
                         ── reject ──────► REJECTED
                         ── withdraw ────► WITHDRAWN
AWAITING_PAYMENT_REVIEW  ── evidence VERIFIED ─► CONFIRMED
                         ── withdraw ──────────► WITHDRAWN
CONFIRMED                ── withdraw ──────────► WITHDRAWN
```

Forbidden: anything out of `REJECTED` or `WITHDRAWN`; `CONFIRMED →
REJECTED`; linking or rejecting outside `NEEDS_PARTICIPANT_REVIEW`; reopening.
A withdrawn registration keeps its participant link, its evidence and its
payment state.

## 9.2 Payment state (per registration, derived, not stored)

| State | Label | Source |
|---|---|---|
| `NOT_REQUIRED` | `Sense pagament` | `expected_amount_cents = 0` |
| `PENDING_REVIEW` | `Pendent de revisió` | evidence `PENDING_REVIEW` |
| `ISSUE` | `Incidència` | evidence `ISSUE` |
| `VERIFIED` | `Verificat` | evidence `VERIFIED` |

Transitions (unchanged trigger): `PENDING_REVIEW → VERIFIED | ISSUE`,
`ISSUE → VERIFIED`. Verifying evidence moves the registration to `CONFIRMED`
**only** from `AWAITING_PAYMENT_REVIEW`. On a `WITHDRAWN` registration the
evidence can still be reviewed (so Tresoreria records what was received); the
registration stays `WITHDRAWN`. Refunds: 3.5G.

## 9.3 Evidence object state

| State | Label | Meaning |
|---|---|---|
| available | — | object present in R2 |
| `PURGED` | `Justificant eliminat per la política de conservació` | object deleted by policy (§15.6); metadata and history kept |

Only `VERIFIED` evidence can ever be purged. `PENDING_REVIEW` and `ISSUE` never.

---

# 10. Activity tab (updates to ACTIVITIES §11)

## 10.1 Filters

`Totes / Per revisar / Pendents de pagament / Confirmades / Rebutjades /
Retirades` with counts; `Pendents de pagament` only for paid activities;
`Retirades` only when there is at least one. Default `Per revisar` when it has
items. Server-side filtering (`?estat=`), paginated.

## 10.2 Row

- Primary: submitted name — or, when the server returns it, the linked
  participant's name with `Fitxa` link (§16); state label; payment state for
  paid activities; `En revisió global` when escalated.
- Secondary: `Sol·licitada el …` · section (GENERAL) · transport.
- `Declarada a Escolta` (quiet text) only if declared ≠ registration section.

## 10.3 Row actions (`···` menu, per state and capability)

| Action | States | Capability |
|---|---|---|
| `Revisa` (disclosure) | Pendent de vincular, level SECTION or global reviewer | review |
| `Mostra el contacte` | all | registration.contact.read |
| `Corregeix la secció` | Pendent de vincular | §12.3 |
| `Envia a revisió global` | Pendent de vincular, level SECTION | review (section) |
| `Registra la retirada` | Pendent de vincular, Pendent de pagament, Confirmada | review |
| `Veure justificant` / `Descarrega` | paid, evidence present | verify |
| `Verifica` / `Marca incidència` | evidence pending / pending (incidence) | verify |

Destructive or irreversible actions ask for confirmation (§13).

## 10.4 Payments in the tab

Evidence for the activity comes from `GET /api/payments?activityId=…`
(server-filtered). The tab never downloads payments of other activities.

---

# 11. Submitter contact on demand

- Lists and rows never contain `submitted_by_name`, `contact_phone` or
  `receipt_email`.
- `Mostra el contacte` → `GET /api/registrations/:id/contact`:
  - permission `activities.registration.contact.read` over the registration
    section; order §8.4;
  - returns `{ submittedByName, phone, email }` only;
  - audit `SENSITIVE_DATA_READ`, resource `activity_registration`, reason
    `REGISTRATION_CONTACT_CONSULTED`; no values in the audit or logs;
  - `Cache-Control: no-store`.
- The UI shows the values inside the row, with `Amaga`; nothing is cached
  between rows or kept after leaving the activity.

---

# 12. Review and matching

## 12.1 Automatic matching (unchanged rules)

Exact normalised name **and** same birth date **and** participant's current
section = declared section (within the audience), ACTIVE participants only;
exactly one → link; otherwise human review. No fuzzy auto-link. Provisional
records without birth date and participants de baixa still never match
automatically.

## 12.2 Escalation to global review

**Automatic (server-detected) at intake.** When the result is not `CLEAR` and
an ACTIVE participant with the exact name key and the same birth date exists
in a section **different from the declared one**, the registration is created
with `review_level = GLOBAL`, `escalation_reason = POSSIBLE_OTHER_SECTION`.
Nothing about that participant or section is stored on the registration or
shown to the section reviewer. The portal response stays neutral.

**Manual.** A section reviewer can `Envia a revisió global` (reason
`REVIEWER_REQUEST`), e.g. when the family says the section is wrong. Optional
short internal note is **not** offered (no free text).

What the section reviewer sees: the row with `En revisió global`, no review
panel, no candidates, no reason. Global reviewers see it in the queue and in
the tab with the full review panel (candidates in every audience section) and
the reason label (`Possible secció diferent` / `Enviada per la secció`).

A global reviewer resolves by linking, rejecting, withdrawing or correcting the
section. Correcting the section returns the registration to `review_level =
SECTION` of the new section unless they also link it.

## 12.3 Section correction

`Corregeix la secció` (`POST /api/registrations/:id/section`
`{ sectionId, expectedVersion }`):

- only in `Pendent de vincular`;
- target must be in the activity audience (GENERAL: any section; SECTIONS:
  one of the activity's sections). Otherwise 409 `section_not_in_audience` —
  the registration is not forced; the reviewer rejects or withdraws instead;
- authorised for global reviewers, or for a user with
  `activities.registration.review` over **both** the current registration
  section and the target;
- `submitted_section_id` (declared) never changes;
- writes an append-only history row (registration, from, to, by, at, reason
  `CORRECTION`) and audit `REGISTRATION_SECTION_CORRECTED` (identifiers only);
- confirmation dialog: title `Corregir la secció?`, body `La inscripció
  passarà a <secció>. La secció declarada per la família es conserva.`

## 12.4 Manual linking (review panel)

As 3.5D, with:

- declared birth date delivered by the candidates call (not in the list);
- candidates restricted to (audience ∩ reviewer scope) for section reviewers;
  every audience section for global reviewers;
- a candidate whose current section ≠ registration section is shown to global
  reviewers with `Secció diferent` and cannot be linked until the section is
  corrected (two explicit steps, both audited);
- `Vincula` sends `{ decision: MATCH, participantId, expectedVersion }`;
- `Rebutja` sends `{ decision: REJECT, expectedVersion }` after confirmation
  `Rebutjar la inscripció? La família rebrà un avís que no s'ha pogut acceptar.`

---

# 13. Rejection and withdrawal

## 13.1 Rejection

- From `Pendent de vincular` only.
- Queues notice `REJECTED` (§13.3).
- Audit `REGISTRATION_REJECTED` (existing).

## 13.2 Withdrawal

`Registra la retirada` (`POST /api/registrations/:id/withdraw`
`{ source, notifyFamily, expectedVersion }`):

- from `Pendent de vincular`, `Pendent de pagament`, `Confirmada`;
- `source`: `FAMILY_COMMUNICATION` (default) or `OTHER`;
- `notifyFamily`: default `true` for `FAMILY_COMMUNICATION`, `false` for
  `OTHER`; queues notice `WITHDRAWN`;
- stores `withdrawn_at`, `withdrawn_by`, `withdrawal_source`; clears the
  declared birth date if it was pending (existing lifecycle rule);
- keeps participant link, evidence and payment state; implies no refund;
- audit `REGISTRATION_WITHDRAWN`;
- confirmation: title `Registrar la retirada?`, body `La inscripció quedarà
  retirada. No s'elimina cap dada ni s'inicia cap devolució.`, checkbox
  `Envia una confirmació a la família`;
- a later portal submission for the same person creates a **new** registration
  (the withdrawn one no longer blocks it).

No self-service withdrawal in the portal.

## 13.3 Family notices (existing outbox, provider-agnostic)

| Kind | When | Text (neutral) |
|---|---|---|
| `RECEIVED` | intake | unchanged |
| `PENDING_PAYMENT` | linked, paid | unchanged |
| `CONFIRMED` | confirmed | unchanged |
| `PAYMENT_ISSUE` | incidence | **revised**: `Hem detectat un problema amb el justificant de pagament d'aquesta inscripció. Posa't en contacte amb el grup per a resoldre-ho.` (no promise of an in-app flow) |
| `REJECTED` (**new**) | rejection | `No hem pogut acceptar aquesta sol·licitud d'inscripció. Si tens cap dubte, posa't en contacte amb el grup.` |
| `WITHDRAWN` (**new**) | withdrawal with notice | `Hem registrat la retirada d'aquesta inscripció.` |

Shared lines stay: activity, participant name as submitted, price. Never
candidates, internal reasons, other people or sections.

---

# 14. Payments until 3.5G (purpose-limited projection)

## 14.1 Projection

`GET /api/payments?vista=pendents|incidencies|totes[&activityId=][&cursor=]`
and `GET /api/payments/:id`, permission `finance.payment.verify` (scope by
registration section). Row:

| Field | Note |
|---|---|
| `id` (evidence), `registrationId` | for actions only, never displayed |
| `activity` `{ id, name, startsAt }` | name and date only; no other activity data, no management |
| `submittedName` | |
| `participant` `{ id, name }` | only if the caller has `participants.profile.read` over that participant; otherwise absent |
| `amountCents` | expected amount |
| `transport` | only when the activity has transport options |
| `section` | registration section code, only for GENERAL activities |
| `registrationState` | including `WITHDRAWN` |
| `paymentState` | §9.2 |
| `evidence` `{ mime, sizeBytes, receivedAt, available }` | `available=false` when purged |
| `reviewedAt` | |

Holding `finance.payment.verify` never grants `activities.read` or any activity
action.

## 14.2 Surface

In the queue (`Pagaments` block): one row per payment — activity · name ·
amount · state; actions `Veure justificant`, `Descarrega`, `Verifica`
(confirmation as 3.5D), `Marca incidència` (only from pending, confirmation).
Withdrawn registrations show `Inscripció retirada`. Errors next to the action.
The legacy list (`#paymentPanel`) is removed.

## 14.3 Incidence

- Stays in `Incidències` until verified.
- Evidence viewable and downloadable.
- `Verifica` available when it has been resolved outside Gestió.
- Not in 3.5F: bank reconciliation, structured request of new evidence,
  refunds, movement management (3.5G).

---

# 15. Evidence

## 15.1 Storage (no change of location)

Bytes in private R2 only; D1 metadata only. No public or permanent URLs; the
only access is the authenticated endpoints below. Object keys stay opaque.

## 15.2 Validation (server, unchanged and kept)

- JSON body, base64, size ≤ current 4 MiB decoded (portal checks the same
  limit first);
- type detected from **magic bytes**; must equal the declared MIME and the
  extension (`.pdf`, `.png`, `.jpg/.jpeg`, `.webp`); never trust the client
  extension alone;
- file name ≤ 120 chars, no path separators or control characters; not stored;
- synthetic marker in development;
- SHA-256 stored.

## 15.3 Preview and download

`GET /api/payments/:id/evidence?mode=view|download`:

| | `view` | `download` |
|---|---|---|
| `Content-Type` | stored `detected_mime` | stored `detected_mime` |
| `Content-Disposition` | `inline` | `attachment; filename="justificant-<YYYY-MM-DD>.<ext>"` (date received, extension from MIME) |
| Audit | `PAYMENT_EVIDENCE_VIEWED` | `PAYMENT_EVIDENCE_DOWNLOADED` |
| Common | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` (view only), `X-Robots-Tag: noindex` |

UI: `Veure justificant` opens a dialog (sheet on mobile): images in an
`<img>` pointing at the view URL; PDFs in an `<iframe>` pointing at the view
URL, with `Descarrega` always available as fallback (some mobile browsers do
not render PDFs inline). The page CSP already allows same-origin images and
frames; no `blob:` or `data:` sources are added. The dialog never pre-loads:
the request (and its audit) happens only when the user opens it. Purged
evidence answers `410 evidence_purged`.

## 15.4 Audit of evidence

`PAYMENT_EVIDENCE_VIEWED` / `PAYMENT_EVIDENCE_DOWNLOADED`: actor, session,
resource `payment_evidence` id, request id, timestamp. Never the file, its
contents, IBAN, bank concept or file name.

## 15.5 Photo optimisation (portal, before upload)

Workers have no image codec; optimisation happens in the family's browser:

- applies to `image/jpeg`, `image/png`, `image/webp`; **never to PDFs**;
- decode, downscale so the longest side ≤ *L* px if larger, re-encode as JPEG
  quality *q*; re-encoding also drops EXIF metadata (location);
- PNG screenshots under the size threshold are left as they are (text
  legibility);
- if the result is not smaller than the original, upload the original;
- if decoding fails, upload the original (server limits still apply);
- server validation is unchanged; nothing is re-compressed server-side.

*L*, *q* and the threshold are a **non-blocking technical tuning** to settle
during implementation with sample receipts (starting point: *L* 2000 px,
*q* 0.82, threshold 1.5 MB). The 4 MiB server limit stays until the tuning is
validated. The same portal helper may serve annual-fee evidence; its policy is
confirmed in 3.5G.

## 15.6 Retention-ready

No legal period is fixed here. 3.5F prepares:

- `payment_evidence.object_purged_at`, `object_purge_reason`
  (`RETENTION_POLICY`);
- a service function that deletes the R2 object of **verified** evidence and
  sets those columns, with audit `PAYMENT_EVIDENCE_PURGED` (system actor);
- kept after purge: the metadata row, receipt date, review result, reviewer,
  review date, purge date, all audit events.

The scheduled job and the retention category are enabled only when the period
is approved (legal phase / 3.5G).

---

# 16. Linked participant

- The registration read model includes `participant { id, name }` only when the
  caller has `participants.profile.read` over the participant's current
  section; otherwise the field is absent (not `null` with a hint).
- UI: name + `Fitxa` link to `#/participants/:id`.
- Without access: the row shows the submitted name; nothing says a link exists.
- No `Activitats` tab inside Participants in 3.5F.

---

# 17. Confirmed list (operational)

`#/activitats/:id/inscripcions?vista=confirmats`:

- one row per `CONFIRMED` registration in scope, grouped by registration
  section; withdrawn and rejected excluded;
- columns: name (participant name with profile access; otherwise submitted
  name), section, transport (when the activity has options), payment state
  only if not `VERIFIED`/`NOT_REQUIRED` (should not occur for CONFIRMED);
- header totals: `n confirmades` and, with transport, `n amb transport del
  grup`;
- partial scope note as in the tab;
- no contact data, no birth dates, no health data;
- no attendance marking, no export, no print layout in 3.5F.

---

# 18. Dashboard (no redesign of Inici)

| Item | Opens |
|---|---|
| `n inscripcions per revisar · <activitat>` (per activity) | activity tab `?filtre=per-revisar` (unchanged) |
| global `n inscripcions per revisar` (if shown) | `#/inscripcions?vista=pendents` |
| `n pagaments per revisar` | `#/inscripcions?vista=pendents` (Pagaments block) |
| `n incidències de pagament` | `#/inscripcions?vista=incidencies` |

Counts come from the queue summary endpoint (B2), not from downloading
`/api/payments`. Financial items move to Tresoreria in 3.5G.

---

# 19. Future: purpose-limited dietary list (Phase 5, not in 3.5F)

Documented only. Example: `Genera llistat de cuina` for an activity —
confirmed participants with the strictly necessary dietary
allergies/intolerances. Requirements for Phase 5 Salut: specific permission,
scope, step-up authentication, audit `HEALTH_DIETARY_EXPORT_GENERATED` /
`HEALTH_DIETARY_EXPORT_DOWNLOADED` without health data in the log,
minimisation by purpose; never a generic health export. 3.5F adds nothing to
the confirmed list that would pre-empt it.

---

# 20. Backend changes

Inspected code: `registration-service.js`, `evidence-service.js`,
`notification-service.js`, `activity-service.js` (summary), `intake.js`,
`worker.js`, migrations 0003–0005, 0012, `recovery.js`, `portal/public/portal.js`.

| Id | Current state | Target | Migration | Endpoints | Permission | Audit | Tests |
|---|---|---|---|---|---|---|---|
| **B1** Registration model | status CHECK without `WITHDRAWN`; no version; no registration section; no escalation; transition trigger in 0003 | rebuild `activity_registration` (same name, rows copied) adding `WITHDRAWN`, `version`, `registration_section_id` (backfilled), `review_level`, `escalation_reason`, `escalated_at/by`, `withdrawn_at/by`, `withdrawal_source`; new transition trigger (§9.1); member unique index excludes `REJECTED` and `WITHDRAWN`; recreate birth-date and authorisation triggers and the activity lock triggers that reference the table; `PRAGMA defer_foreign_keys` for `payment_evidence` / `notification_outbox` references | **0018** (rebuild, no data loss) | — | — | — | migration copy test; every trigger; recovery `REQUIRED_OBJECTS`; demo |
| **B2** Queue read model | none; Dashboard downloads `/api/payments` | `GET /api/registrations/queue?vista=` (per-activity counts by scope and level) and `GET /api/registrations/queue/summary` (badge/Dashboard) | — | new | review / verify | — | scope matrix, partial, no rows of other sections, constant query count |
| **B3** Authorisation order | 409/404/403 before authorisation in `reviewMatch`, `reviewCandidates`; 403 vs 404 mismatch | §8.4 everywhere via one `resolveRegistration` / `resolvePayment` helper | — | all registration/payment endpoints | — | `AUTHZ_DENY` | out-of-scope ⇒ 404 for every endpoint and state |
| **B4** Section model | scope by `submitted_section_id` (registrations) and current section (payments) | everything by `registration_section_id` | B1 | list, summary, candidates, review, payments, evidence | — | — | section change after registration keeps scope |
| **B5** Section correction | impossible | `POST /api/registrations/:id/section` | **0018** append-only `activity_registration_section_change` (+ immutability triggers) | new | §12.3 | `REGISTRATION_SECTION_CORRECTED` | audience check, both-sections rule, global reviewer, history, version |
| **B6** Escalation | none | intake detection (§12.2) + `POST /api/registrations/:id/escalate`; global-only actions on escalated rows | B1 | intake, new | review (section) / global review | `REGISTRATION_ESCALATED` | detection does not leak; section reviewer sees no candidates; portal response unchanged |
| **B7** Contact on demand | contact fields in list payload | removed from list; `GET /api/registrations/:id/contact` | 0018 permission rows + matrix | list, new | `activities.registration.contact.read` | `SENSITIVE_DATA_READ` / `REGISTRATION_CONTACT_CONSULTED` | list has no contact keys; audit has no values; 403/404 order |
| **B8** Withdrawal | none (rejection used) | `POST /api/registrations/:id/withdraw` | B1 | new | review | `REGISTRATION_WITHDRAWN` | from each allowed state; forbidden states; evidence kept; re-registration creates a new row; notice optional |
| **B9** Notices | kinds fixed by CHECK; rejection silent; incidence text promises contact | rebuild `notification_outbox` adding `REJECTED`, `WITHDRAWN`; revised `PAYMENT_ISSUE` text | **0018** (rebuild; `notification_capture` reference) | — | — | `NOTIFICATION_QUEUED` | queued once; neutral text; no internal data |
| **B10** Payment projection | `/api/payments` all activities, scope by current section, no participant/state detail | §14.1 with `vista`, `activityId`, `GET /api/payments/:id` | — | `/api/payments` (extended, backwards-compatible fields), new item | `finance.payment.verify` | — | Tresoreria without `activities.read` works; no activity data beyond name/date; participant only with profile access |
| **B11** Evidence preview/download | octet-stream `justificant.bin`, not audited | §15.3 | — | `/api/payments/:id/evidence?mode=` | verify | `PAYMENT_EVIDENCE_VIEWED` / `_DOWNLOADED` | MIME per type, filename, headers, audit without content, 404 order |
| **B12** Retention-ready | none | purge columns + service function (disabled job) | **0018** additive on `payment_evidence` | — | system | `PAYMENT_EVIDENCE_PURGED` | only verified; metadata kept; 410 after purge |
| **B13** Linked participant | not returned | `participant {id,name}` when profile access | — | list, payment projection | `participants.profile.read` | — | present/absent by scope |
| **B14** Server-side filters | client-side filters; full fan-out | `?estat=` and `?vista=confirmats` on the activity list | — | `/api/activities/:id/registrations` | review | — | filter = same scope; pagination |
| **B15** Capabilities | `activities.reviewRegistrations`, `verifyPayments` | add `registrations` block §4.3 | — | `/api/me` | — | — | projection without denials |
| **B16** Portal photo optimisation | none | §15.5 | — | portal client only | — | — | helper unit tests; PDFs untouched; fallbacks |
| **B17** Audit vocabulary | — | add `REGISTRATION_SECTION_CORRECTED`, `REGISTRATION_ESCALATED`, `REGISTRATION_WITHDRAWN`, `PAYMENT_EVIDENCE_VIEWED`, `PAYMENT_EVIDENCE_DOWNLOADED`, `PAYMENT_EVIDENCE_PURGED` to `ACTIONS` | — | — | — | — | audit set test |
| **B18** Demo | `Sol·licitud retirada` as rejected; no escalation | withdrawn rows (pending/confirmed/paid-verified), an escalated wrong-section request, a corrected section, incidence, a GENERAL partial case, a section change after registration (D8 kept) | — | — | — | — | demo integrity |
| **B19** Backup/restore | — | new table and triggers in `TABLES` / `REQUIRED_OBJECTS` | — | — | — | — | recovery test with withdrawn + corrected rows |

Not changed: intake contract v1 (fields), matching rules, evidence location,
payment evidence transitions, Activities lock rules.

Migration risk (B1/B9): rebuilding tables referenced by foreign keys. Known
constraints to handle in 0018: deferred foreign keys during the rebuild;
dropping and recreating triggers on `activity`, `activity_section` and
`activity_transport_option` whose bodies reference `activity_registration`
(SQLite validates them on rename); recreating every index and trigger of the
rebuilt tables; tested on SQLite and local D1 before merge, as 0017.

---

# 21. Errors

| Code | Copy |
|---|---|
| `not_found` (also out of scope) | `No tens accés a aquesta inscripció o ja no existeix.` |
| `forbidden` | `No tens permís per a fer aquesta acció.` |
| `invalid_transition` / `stale_registration` | `Aquesta inscripció ha canviat. S'ha actualitzat la informació.` + reload |
| `section_not_in_audience` | `Aquesta activitat no admet aquesta secció.` |
| `invalid_review` | `Revisa la selecció.` |
| `invalid_filter` | `Escriu almenys 2 lletres per a cercar.` |
| `evidence_purged` | `El justificant s'ha eliminat per la política de conservació.` |
| evidence unavailable | `No s'ha pogut obrir el justificant.` + `Descarrega` |
| other | `No s'ha pogut completar l'acció. Torna-ho a provar.` |

Errors appear next to the action, never in the legacy global message line.

---

# 22. Contradictions — resolution

| # | Contradiction (v0.1) | Status | Resolution |
|---|---|---|---|
| **C1** | Registrations by declared section, payments by current section | **RESUELTA POR DISEÑO** | Registration section (§7) for everything; participant moves never rewrite it (B4) |
| **C2** | Contact in every row, reveal not audited | **RESUELTA POR DISEÑO** | Removed from lists; audited on-demand endpoint with its own permission (§11, B7) |
| **C3** | Inline preview vs attachment only vs `justificant.bin` | **RESUELTA POR DISEÑO** | Authenticated preview + named download, both audited (§15.3). ACTIVITIES §11.4/§19 to update |
| **C4** | Dashboard target for registrations/payments | **RESUELTA POR DISEÑO** | Per-activity → tab; global and payments → queue (§18) |
| **C5** | Tresoreria only through the legacy list | **RESUELTA POR DISEÑO** | Purpose-limited payment projection in the queue, without `activities.read` (§14, B10) |
| **C6** | Incidence promises contact, no follow-up | **RESUELTA POR DISEÑO** | Incidence view with preview and later verification; revised neutral text (§14.3, §13.3) |
| **C7** | Withdrawals recorded as rejections; no cancellation | **RESUELTA POR DISEÑO** | `WITHDRAWN` state (§9.1, §13.2, B1, B8); refunds 3.5G |
| **C8** | State/participant checks before authorisation; 403 vs 404 | **RESUELTA POR DISEÑO** | Order §8.4 for every resource (B3) |
| **C9** | Evidence downloads not audited | **RESUELTA POR DISEÑO** | `PAYMENT_EVIDENCE_VIEWED` / `_DOWNLOADED` (§15.4, B11) |
| **C10** | Wrong declared section only rejectable | **RESUELTA POR DISEÑO** | Section correction within the audience + escalation to global review without disclosure (§12.2–12.3) |
| **C11** | `Inscripcions` nav leads to almost nothing; badge without source | **RESUELTA POR DISEÑO** | Global queue (§6) and summary endpoint for the badge (§6.3, B2) |

No contradiction remains open.

---

# 23. Documentation to update during implementation/closure

Not rewritten now.

| Document | Reference | Change |
|---|---|---|
| ACTIVITIES.md | §8.3 | add `Retirada`, `En revisió global` |
| ACTIVITIES.md | §11.1 | filters: `Retirades`; server-side filters |
| ACTIVITIES.md | §11.2 | contact via audited endpoint + permission; declared birth date from candidates; linked participant; row menu actions; escalation; section correction |
| ACTIVITIES.md | §11.4, §19 ("never an inline preview", "attachment download") | authenticated preview + named download, audited; evidence fetched by `activityId` |
| ACTIVITIES.md | §13 ("Dashboard … keeps opening the existing payments review") | payments in the global queue |
| ACTIVITIES.md | §23.2 G6, G8 | G6 partially (projection per activity), G8 resolved |
| ACTIVITIES.md | §24 out of scope "redesign of … Inscripcions (global page)" | delivered in 3.5F |
| DASHBOARD.md | §6.2 | targets per §18; financial items → 3.5G |
| DASHBOARD.md | payments review ("large drawer / modal preview") | points to REGISTRATIONS §15.3 |
| SHELL.md | §8.2 `Inscripcions · 7` | source = queue summary (§6.3) |
| AUTHORIZATION_MODEL.md | role matrix | `activities.registration.contact.read`; Secretaria grants; scope by registration section |
| PARTICIPANTS.md | §20 / T9 | note: linked participant shown in registrations with profile access |
| GESTIO_DEMO_LOCAL.md | scenarios | B18 |
| DESIGN_INDEX.md | entry | Registrations v0.2 |

---

# 24. Responsive, design and accessibility

- Iris, light/dark tokens, existing components (chips, rows, `···` menu,
  dialogs/sheets, toasts, skeletons). No artistic redesign.
- Queue: activity groups as cards on mobile; counts as text, not colour only;
  `→` targets ≥ 44 px.
- Payment rows on mobile: stacked; actions full-width below; preview as a
  full-screen sheet with `Descarrega` and `Tanca`.
- Review panel on mobile: one candidate per line; section correction and
  withdrawal dialogs as sheets.
- Keyboard: every action reachable; focus returns to the row after a dialog;
  disclosure with `aria-expanded`; radio group for candidates.
- Screen readers: row accessible names include name, state and payment state;
  never contact values.
- No UUIDs, codes or English in visible text.

---

# 25. Privacy

- Lists: name, states, dates, section, transport, amount (verifiers) — nothing
  else.
- On demand + authorisation + audit: submitter contact, evidence view/download.
- On demand + authorisation: declared birth date and candidates (review only).
- Linked participant only with profile access.
- URLs: activity ids, section codes, keywords.
- Audit: identifiers and reason codes only; never names, e-mails, phones,
  files, IBAN or bank concepts.
- No health data anywhere in 3.5F.

---

# 26. Acceptance criteria

**Global queue**
- [ ] `Pendents de revisar`, `Incidències`, `Totes` with route-backed view;
      groups by activity with counts and `vista parcial` + sections.
- [ ] Opening a registration group lands on the activity tab with the matching
      filter; the queue has no review panel.
- [ ] Users without review/verify capability do not see the nav item; the
      badge equals the actionable pending count.

**Scopes**
- [ ] A section reviewer never receives rows, counts or names of other
      sections, in any endpoint, including GENERAL activities.
- [ ] Every registration/payment endpoint answers 404 identically for missing
      and out-of-scope ids, before any 409/400.

**Matching**
- [ ] Automatic rules unchanged; no fuzzy or cross-section auto-link.
- [ ] Declared birth date only in the candidates response, only while pending.

**Historical section**
- [ ] `registration_section_id` set at intake and backfilled; a participant's
      later section change does not move registration or payment.

**Section correction / escalation**
- [ ] Correction only to an audience section, only while pending, by global
      reviewers or reviewers of both sections; declared section unchanged;
      history row + audit with identifiers only.
- [ ] Server-detected escalation reveals nothing to the section reviewer and
      leaves the portal response unchanged; global reviewers resolve it.

**Contact**
- [ ] No contact field in any list payload; the reveal needs
      `activities.registration.contact.read`, is audited and logs no values.

**Rejection / withdrawal**
- [ ] Rejection queues the neutral `REJECTED` notice.
- [ ] Withdrawal from the three allowed states only; keeps link, evidence and
      payment state; optional neutral notice; who/when/source stored; a new
      portal submission creates a new registration.

**Payments / incidence**
- [ ] Tresoreria verifies from the queue without `activities.read`, sees only
      the projection fields, and cannot read or manage activities.
- [ ] Section coordinators without delegation cannot verify.
- [ ] Incidences stay listed until verified; evidence viewable; later
      verification confirms a registration only from `Pendent de pagament`.
- [ ] The activity tab requests only its own payments.

**Preview / download / audit**
- [ ] Correct `Content-Type` per format; download named
      `justificant-<data>.<ext>`; no `justificant.bin`.
- [ ] Each view and download writes its own audit event without content.
- [ ] Purged evidence answers 410 and keeps its history.

**Linked participant / confirmed**
- [ ] Name and `Fitxa` link only with profile access over that participant.
- [ ] Confirmed list grouped by section with transport totals, no contact or
      health data, no export.

**Dashboard**
- [ ] Targets per §18; counts from the summary endpoint; Inici unchanged.

**Mobile / privacy**
- [ ] All flows usable at 375 px, keyboard and screen reader; light/dark.
- [ ] No hidden data in payloads; no UUIDs or codes visible.

---

# 27. Human validation checklist (Borja/Atlas)

- [ ] **Inscripcions global:** the three views read clearly; it is obvious
      where to click to work an item; partial views are understandable.
- [ ] **Activity tab:** filters, `Retirades`, escalated rows and the row menu
      feel consistent with 3.5D.
- [ ] **Manual review:** candidates, section difference and the two-step
      correction are understandable; nothing from other sections leaks.
- [ ] **Contact:** `Mostra el contacte` feels deliberate, not obstructive.
- [ ] **Evidence:** images and PDFs open inside Gestió; download has a
      sensible name; mobile fallback works.
- [ ] **Rejection:** the confirmation states that the family is notified; the
      notice text is acceptable.
- [ ] **Withdrawal:** the confirmation is clear about no deletion and no
      refund; the optional notice is acceptable.
- [ ] **Incidence:** stays visible; can be verified later; the revised e-mail
      text is acceptable.
- [ ] **Confirmed list:** useful on the day (sections, transport totals).
- [ ] **Temporary Tresoreria experience:** can verify without seeing
      activities; enough context to decide.
- [ ] **Responsive:** queue, payment preview and dialogs on a phone.

---

# 28. Open points

**No blocking decision remains.** Defaults confirmed by Borja/Atlas
(2026-10-01):

| Item | Confirmed |
|---|---|
| Secretaria grants (`activities.read`, `registration.review`, `registration.contact.read`, group) | granted; never `activities.manage` |
| Payment review on a withdrawn registration | allowed; the payment stays visible; registration stays `WITHDRAWN`; no automatic refund |
| New portal submission after a withdrawal | creates a new registration; the withdrawn one stays as history |
| Withdrawal notice default | on for `FAMILY_COMMUNICATION`, off for `OTHER` |
| Notice texts (§13.3) | as written |
| Photo optimisation (§15.5) | longest side 2000 px, quality 0.82, from ~1.5 MB; EXIF removed; orientation respected; 4 MiB server limit kept; PDFs untouched |
| PDF preview (§15.3) | internal preview where viable; download always offered |
