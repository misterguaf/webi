# Gestió — Participants

Status: APPROVED FOR IMPLEMENTATION — all product decisions resolved (§22)
Version: 0.5
Project: Grup Scout Parpalló — Gestió
Phase: 3.5E
Baseline: `phase-3.5d-complete` (`a99d851`)
Depends on:

- ../DESIGN\_VISION.md
- ../DESIGN\_SYSTEM.md
- ../MOTION\_SYSTEM.md
- ../UX\_RULES.md
- SHELL.md, DASHBOARD.md
- ACTIVITIES.md (routing, list, detail, drawer and concurrency conventions of 3.5D)
- ../../AUTHORIZATION\_MODEL.md, ../../PHASE\_3\_5\_AUDIT\_REMEDIATION.md (permission catalogue,
  delegations, participant domain of migration 0011)

Changes in 0.5 (technical closure, 2026-10-01 — no product decision changed):

- **`CRM_MANAGER`:** retirement is enforced in the service only (approved by
  Atlas). No database trigger; historical migrations untouched; existing
  assignments stay inert and cannot be assigned again (§4.3).
- **Guardian relationship episodes:** a participant and a guardian may have
  several relationships over time — at most one current, ended ones kept as
  immutable history; an ended relationship can be followed by a new one
  (§9.4, migration 0017).
- **Delegation duration:** implemented as decided (§5.2).
- **Contacts:** the reveal button reads `Mostra el contacte`; `Retira` moved
  from the contact row into that contact's `···` menu, with the same
  confirmation dialog.

Changes in 0.4 (final decisions, 2026-10-01 — spec approved for implementation):

- **Completeness (D1 resolved):** a complete record always needs name, birth
  date and section; **minors under 18** additionally need a current guardian
  and a current contact; **participants of legal age (18+)** need their own
  current contact and **no guardian**. Derived server-side from the birth date
  (§8.2).
- **Delegations (D2 resolved):** default duration 90 days, **maximum 365
  days**, always with an expiry; never indefinite (§5.2).

Changes in 0.3 (final decisions, 2026-09-30):

- **Secretaria absorbs the CRM manager function.** `SECRETARY` is the single
  functional profile; `CRM_MANAGER` is retired compatibly (§4).
- **Shared guardians:** direct edit only with authority over every linked
  participant; otherwise a request to Secretaria, with a message that reveals
  nothing about other sections (§9.3).
- **Provisional records:** membership status and administrative completeness
  are separate; completeness is a derived indicator, not a new status (§8).
- **Follow-up from Inici:** incomplete records produce scoped attention items
  (§13).
- **Contacts:** every explicit consultation is audited without copying values
  to logs (§9.2).
- **Legal representation:** only Secretaria or general coordination may mark it
  as accredited (§10).
- **Delegations:** 90 days is the default, not the maximum; no indefinite
  delegations; the administrative interface is 3.5H (§5).
- **Basic fee status** in the participant record (§11).
- Tabs, guided flow, review queue and legal deferrals of v0.2 are kept.

---

## 1. Purpose

Participants is where Gestió answers, for the people a user is responsible for:

1. Who is in my section (or in the group) right now?
2. Who is this person, and how do I reach their family when I need to?
3. Who are their guardians, and what has the family told us about them?
4. Which records still need information?
5. How does a participant enter Gestió, change section or leave?

The legacy screen (a bullet list of `name · section UUID`) is replaced entirely.

This module holds the most sensitive routine data in Gestió: minors and their
families. Every choice favours **minimisation**.

---

# 2. Product principles

1. **A participant is a person, not a record.** The detail is a calm profile;
   editing is an action.
2. **Minimise by default, reveal on demand.** Lists show identity and section.
   Contact values are consulted explicitly, and each consultation is audited.
3. **Master data changes only by explicit human action.** Nothing is created,
   merged or updated automatically; ambiguous matches are never merged.
4. **A permission over one minor never reaches another minor.** A shared
   guardian is not a bridge between sections.
5. **Membership is not completeness.** Whether someone belongs to the group and
   whether their record is administratively complete are two different facts.
6. **Communicated is not accredited, and reviewed is not verified.**
7. **No inferred families**, **no health data**, **no identity documents**,
   **no photos**, **no export**, **no import** in 3.5E.
8. **Iris design system as it is.** Functional UX, clarity, accessibility,
   responsive behaviour and reusable components. The global artistic redesign
   is a later phase and is not anticipated here.

---

# 3. Access model

## 3.1 Who uses Gestió

Ordinary users: **general coordination, section coordinators, Secretaria**, and
other people expressly authorised.

**Monitors have no automatic access.** They receive individual delegations
(§5): specific permissions, a specific section, a named authoriser, an expiry
and the possibility of early revocation.

Everything uses the existing mechanisms: the role catalogue, the rule "role
**and** individual grant", the `SECTION_DELEGATE` role and
`delegated_permission`. **No parallel authorisation system and no new role.**

The technical administrator is not a superuser (§6).

## 3.2 Permissions (final proposal)

Declared in `gestio/src/permissions.js`, enforced server-side. Scope of every
SCOPED permission is the participant's **current section**.

| Permission | Kind | New | Delegable | Covers |
|---|---|---|---|---|
| `participants.profile.read` | SCOPED | no | **yes (new)** | list, detail, `Fitxa` (including birth date), section history, completeness of the profile part |
| `participants.profile.manage` | SCOPED | yes | yes | create (also provisional), edit identity data, deactivate, reactivate, change section (§12) |
| `participants.contact.read` | SCOPED | yes | yes | guardians of a participant and the existence of contact points; consulting contact values (audited) |
| `participants.contact.manage` | SCOPED | yes | yes | add, correct and end ordinary contact points (subject to §9.3) |
| `participants.guardian.manage` | SCOPED | yes | yes | create or link a guardian, edit or end the relationship, record **communicated** legal representation |
| `participants.representation.accredit` | GLOBAL | yes | no | mark legal representation as documentarily accredited (§10) |
| `participants.review.manage` | GLOBAL | yes | no | Secretaria's administrative review queue and change requests (§10.3) |
| `participants.consent.read` / `.record` | SCOPED | yes | legal phase | **declared only**, assigned to nobody (§15) |
| `finance.fee.status.read` | SCOPED | no | no (unchanged) | basic fee status, reused in the record (§11) |

## 3.3 Role matrix (final proposal)

`●` held through the role plus the individual grant, as today. `◐` only through
an individual, section-scoped delegation. `—` never.

| Permission | General coordination | Secretaria | Section coordinator | Delegated user (monitor) | Treasury | Tech admin |
|---|---|---|---|---|---|---|
| `profile.read` | ● group | ● group | ● own section | ◐ | — | — |
| `profile.manage` | ● group | ● group | ● own section | ◐ | — | — |
| `contact.read` | ● group | ● group | ● own section | ◐ | — | — |
| `contact.manage` | ● group | ● group | ● own section | ◐ | — | — |
| `guardian.manage` | ● group | ● group | ● own section | ◐ | — | — |
| `representation.accredit` | ● | ● | — | — | — | — |
| `review.manage` | ● | ● | — | — | — | — |
| `consent.*` | legal phase | legal phase | legal phase | legal phase | — | — |

`CRM_MANAGER` does not appear: it is retired (§4).

## 3.4 What the UI derives

`GET /api/me` → `capabilities.participants` grows from `{ read }` to
`{ read, manage, readContacts, manageContacts, manageGuardians, accredit, review }`
(scopes; booleans for `accredit` and `review`). Capabilities stay advisory.

| UI element | Shown when |
|---|---|
| Module visible | `read` |
| `Nou participant` | `manage` has at least one section |
| `Editar`, `Donar de baixa`, `Reactivar`, `Canviar de secció` | `manage` covers the participant's section (and the target, §12) |
| Tab `Família` | `readContacts` covers the participant's section |
| Contact actions | `manageContacts` covers it |
| Guardian actions | `manageGuardians` covers it |
| `Marca com a acreditada` | `accredit` |
| `Revisions` queue | `review` |
| Fee status line | basic fee capability covers the participant's section (§11) |

No disabled buttons for missing permissions (UX_RULES §32).

---

# 4. Secretaria and the former CRM manager

## 4.1 Decision

In the group, Secretaria also performs what had been attributed to a CRM
manager. There is one functional profile: **`SECRETARY`**, with participant,
contact and guardian management and the administrative supervision of §10.
"CRM Manager" must not appear as an organisational post in the interface.

## 4.2 What exists today (inspected)

| Place | Current state |
|---|---|
| `role` table | `CRM_MANAGER` is one of seven codes fixed by a `CHECK` constraint in historical migration 0001; re-inserted idempotently by migration 0012 |
| Role matrix | `CRM_MANAGER` → only `crm.contact.read`, a reserved permission with no route ("No CRM module exists yet") |
| `SECRETARY` | only `participants.profile.read`, group-wide |
| Service | `security-service.js` accepts `CRM_MANAGER` as an assignable, non-elevated role |
| Accounts | only the synthetic seed user 106 holds it (with a `crm.contact.read` grant). Nothing is deployed, so no real account exists |
| Delegations | none reference it; none of its permissions is delegable |
| Interface | `shell.js` has a role label `CRM` |
| Tests | the role-boundary matrix asserts that user 106 has no operational data; the governance test assigns `CRM_MANAGER` as its example of a non-elevated role; other tests reuse user 106 as "a user without access" |
| Documents | `AUTHORIZATION_MODEL.md` lists the role; RC1 document 12 (role matrix) probably does too — not reviewed |

## 4.3 Compatible consolidation — IMPLEMENTATION REQUIREMENT

Nothing historical is edited or deleted.

1. **New append-only migration** (with B1):
   - the new participant permissions go to `SECRETARY`, **not** to
     `CRM_MANAGER`;
   - **no trigger** (approved 2026-10-01): a trigger would also refuse the
     synthetic seed's historical assignment, so retirement is enforced in the
     service. The role code and its existing rows stay, because the code is
     part of a historical constraint and of the audit trail;
   - `crm.contact.read` stays reserved and unused.
2. **Service:** `CRM_MANAGER` leaves the list of assignable roles; any attempt
   to assign it is refused with `role_retired` (409). Existing assignments stay
   inert: the role grants no participant permission and cannot be granted
   again.
3. **Existing holders:** a `CRM_MANAGER` assignment keeps granting nothing
   operational (as today). Moving a person to Secretaria is an explicit,
   audited act — assign `SECRETARY`, then revoke `CRM_MANAGER` — never an
   automatic conversion, because a role assignment needs an author and a
   justification.
4. **Interface:** the `CRM` label is removed; a retired assignment is shown, if
   at all, as `Rol retirat` in administration.
5. **Seed and tests:** user 106 stays as the synthetic fixture of a retired
   role that grants nothing; the governance test uses another non-elevated
   role; a new regression asserts that the retired role cannot be assigned and
   holds no participant permission.
6. **Documents:** `AUTHORIZATION_MODEL.md` updated at implementation; RC1
   document 12 to be reconciled in the legal phase.

---

# 5. Delegations

## 5.1 Flow (existing mechanism, unchanged)

```text
0. The person has a Gestió account            POST /api/users + Access invitation   (auth.user.manage)
1. Role SECTION_DELEGATE for one section      with an expiry date                    (auth.role.manage)
2. Delegation: one permission, one section    provisioned, naming who authorised it  (auth.permission.provision)
   + authorisation reference + expiry
3. The named authoriser confirms in Gestió    authority over that section            (auth.permission.authorize)
4. A different person ratifies                not the provisioner nor the recipient  (auth.permission.ratify)
5. Effective while RATIFIED and not expired
6. Early revocation at any time
```

Always kept: authorisation, specific permissions, defined scope, expiry,
ratification where applicable, traceability, early revocation.
**The ratification system is not modified.**

## 5.2 Duration — IMPLEMENTED

Decision: **default duration 90 days; maximum duration 365 days; always an
expiry.** A delegation may be shorter or longer than 90 days when a duration is
given (a week, six months, up to one year). **Indefinite delegations are not
allowed.**

Before 3.5E, `delegation-service.js` required `expiresAt` and rejected
anything beyond 90 days, and `security-service.js` applied the same 90-day
maximum to the `SECTION_DELEGATE` role. Implemented in 3.5E:

| Concept | Before 3.5E | Implemented |
|---|---|---|
| Default duration | none (`expiresAt` mandatory) | 90 days when no expiry is given |
| Maximum duration | 90 days, hard-coded twice | **365 days**, a separate named constant |
| Delegate role expiry | capped at 90 days | same 365-day maximum, so the role does not expire before the delegation |
| Indefinite | impossible | stays impossible: an expiry always exists |

The conditions under which an especially long delegation may be authorised
(who, with what record) are an organisational and legal decision, pending.

## 5.3 What 3.5E changes and does not change

- The five operational participant permissions become delegable and enter the
  `SECTION_DELEGATE` role matrix (append-only migration).
- **No delegation interface in 3.5E.** The definitive administrative interface
  is phase **3.5H**; until then delegations are managed through the existing
  API.
- Unanimity as the organisational rule for granting access, signatures and the
  final authorisation policy belong to the legal phase. Gestió keeps recording
  one named authoriser and one independent ratifier; the collective decision is
  cited in the authorisation reference.

---

# 6. Technical administrator

`TECH_ADMIN` holds only `auth.permission.provision` and a reserved
infrastructure permission. It cannot read participants, contacts, finance,
health or audit, and this stays so.

| Layer | Meaning | Status |
|---|---|---|
| Ordinary technical access | Provisioning, configuration, deployment; no personal data | exists |
| Diagnostics | Tools over synthetic or minimised data (counts, states, identifiers; never names or contacts) | to design |
| Operational permissions | The same identity may also hold operational roles or delegations, each expressly granted like anyone else's. They never follow from being technical; self-delegation and self-provisioning stay blocked | exists |
| Extraordinary access | Purpose-bound, time-limited, approved by someone else, audited and visible afterwards | **conceptual only; no interface in 3.5E** |

---

# 7. Information architecture

```text
Participants (list)                      #/participants[?seccio=&estat=&completitud=]
 ├─ Nou participant ──────── guided drawer / sheet (§14)
 └─ Participant detail (page)            #/participants/<participantId>
     ├─ header · section · membership · completeness · fee status · actions
     └─ tabs
         ├─ Fitxa            (profile.read)       #/participants/<id>/fitxa
         └─ Família          (contact.read)       #/participants/<id>/familia

Participants → Revisions (Secretaria)    #/participants/revisions          (review.manage)
```

- Hash routing of 3.5D. URLs carry only the participant UUID and filter
  keywords. **The search text is never written to the URL.**
- No `Activitats` tab (no read model) and no consent tab in 3.5E.

---

# 8. Membership and completeness

## 8.1 Two independent facts

| Fact | Values | Where it lives |
|---|---|---|
| **Membership** | `Actiu` / `De baixa` | `participant.status` (`ACTIVE` / `INACTIVE`), unchanged |
| **Administrative completeness** | `Fitxa completa` / `Informació pendent` | **derived** by the server from the record; not stored, no new status |

Inspection of the model: `participant.status` only distinguishes membership,
and `birth_date` is already nullable. A provisional participant is therefore
simply an active participant whose record lacks required information. **No new
status value and no change to the membership triggers are needed.**

The three situations the interface distinguishes:

| Situation | Membership | Completeness | Shown as |
|---|---|---|---|
| Active, complete | `ACTIVE` | complete | `Actiu` |
| Active, information pending | `ACTIVE` | pending | `Actiu` + `Informació pendent` |
| Left | `INACTIVE` | not evaluated | `De baixa` |

## 8.2 What makes a record complete

Completeness depends on age, which is derived server-side from the birth date.

| Participant | Required for `Fitxa completa` |
|---|---|
| **Minor (under 18)** | name, birth date, section, **at least one current guardian**, **at least one current contact** (of the participant or a guardian) |
| **Legal age (18+)** | name, birth date, section, **at least one current contact of their own** — **no guardian required** |

- Without a birth date, age is unknown: the record is `Informació pendent`, and
  the missing birth date is the reason. A guardian is never demanded of a
  participant who is 18 or older.
- The server returns, per participant, the list of missing items
  (`birthDate`, `guardian`, `contact`), never a free text. A user only receives
  the items their permissions allow them to know: the guardian and contact
  items need `contact.read`; without it the user sees only whether the birth
  date is missing.
- The age boundary uses the participant's age today (18th birthday reached).

## 8.3 What completeness does not do

- It does **not** exclude a participant from activities, fees or any other
  flow. No new automatic exclusion rule is introduced.
- One existing behaviour is worth knowing, and is unchanged: automatic matching
  of a family's registration compares the declared birth date with the record.
  A participant without birth date is never matched automatically; the
  registration goes to human review, as any unclear match does today.

---

# 9. Participant list, record and family

## 9.1 List

```text
Participants                                        [ Nou participant ]
Tropa

[⌕ Busca pel nom…]   [Secció ▾]   [Estat ▾]   [Completitud ▾]      Neteja filtres
```

- One column of calm rows in one solid surface, grouped by section when the
  user sees more than one, ordered by name. The whole row is a link.
- Row: initials avatar, name, section, and at most one signal:
  `Informació pendent` (or `De baixa` in that filter).
- Never in a row: contact data, guardians' names, birth date, identifiers.
- Filters: search (name, accent-insensitive, client-side, not in the URL);
  `Secció`; `Estat` (`Actius` default / `De baixa`); `Completitud`
  (`Totes` / `Informació pendent`).
- Participants `De baixa` are visible, through the `Estat` filter, to holders
  of `profile.read` over their last section — the same current-section rule as
  everything else. How long they remain is a retention question (legal phase).

## 9.2 Detail header and `Fitxa`

```text
← Participants

Nom del participant                                  ● Actiu   ○ Informació pendent
Tropa · des de setembre de 2025
Quota 2026/2027: Pendent
                                                   [ Editar ]  [ ••• ]
```

| Group | Content |
|---|---|
| Identitat | Name; birth date (full date, to `profile.read` holders, only in the detail — consistent with the existing rule that matching shows the birth date to profile readers) |
| Completitud | `Fitxa completa`, or the list of what is missing with a direct action for each (`Afegeix la data de naixement`, `Afegeix un tutor`, `Afegeix un contacte`) when the user may do it |
| Secció | Current section and readable history, with the reason in words (`alta`, `canvi de secció`, `baixa`, `reactivació`, `registre inicial`) |
| Incorporació | Provenance, who recorded it and when — to `profile.manage` holders |

Edit uses the 3.5D drawer with optimistic concurrency (`expectedVersion`,
`409 stale_participant`, input preserved).

## 9.3 `Família`: guardians and contacts

```text
Tutors
┌ Nom del tutor · Mare                          Representant legal · comunicat
│ ✆ Telèfon  ✉ Correu                           [ Mostra el contacte ]
└ Afegit el 12 de set. · procedència: documentació física

                                                [ Afegeix un tutor ]
```

**Contacts**

- Loading the tab returns guardians, relationships and **which kinds** of
  contact exist — not the values.
- `Mostra el contacte` fetches the values of one owner (a guardian or the
  participant). **Each consultation is audited**: user, resource (the
  participant and the owner), action, date and the permitted context (the
  permission and section that authorised it). **Phones, addresses and e-mails
  are never written to audit events or logs.**
- Retiring a contact is in that contact's `···` menu (`Retira`), always after
  a confirmation dialog; it is never a button on the row.
- Authorised coordinators add, correct and end ordinary contacts of their
  participants. A correction ends the old value and adds the new one.

**Operations**

| Operation | Permission |
|---|---|
| Consult contact values | `contact.read` (audited) |
| Add / correct / end a contact | `contact.manage`, subject to the shared-guardian rule |
| Create and link a guardian; link a visible one; change relationship type; end a relationship | `guardian.manage` |
| Record or change **communicated** legal representation | `guardian.manage` (always a relevant change, §10) |
| Mark as **accredited** | `representation.accredit` (Secretaria, general coordination) |

**Shared guardians** — a person may be guardian of participants in different
sections. Rules enforced by the server:

1. **Reading** through a participant in scope returns the guardian and the
   relationship with *that* participant. Other participants of the guardian are
   returned only if they are in the user's scope; nothing about the others —
   no name, no section, no count.
2. **Relationship data** (type, representation, start, end) belongs to the pair
   participant–guardian: scope over that participant is enough.
3. **Ordinary shared data** (the guardian's name and contact points):
   - if the user's authority covers **every** participant linked to the
     guardian and they hold the needed permission, they edit directly;
   - if any linked participant is outside their scope, they **cannot** edit
     directly. They may **send a request**: Secretaria receives it, reviews it
     and applies or rejects it; author, time, content and outcome are kept.
4. **The message never reveals other sections.** The user sees:
   `Aquestes dades les gestiona Secretaria. Pots enviar una sol·licitud de canvi.`
   No mention of other participants, sections or of the guardian being shared.
5. **Linking** offers only guardians already visible to the user. If the data
   typed for a new guardian matches one outside the user's scope, the server
   does not reveal it: the guardian is created and Secretaria receives a
   `possible duplicate` review. Nothing is merged automatically.
6. No search of guardians by name or contact for section-scoped users. No
   endpoint lists a guardian's participants.

## 9.4 Relationship episodes

A participant and a guardian may be related more than once over time (for
example, a relationship ended by mistake or a family situation that changes
back). Each relationship is an **episode**:

- at most **one current** episode per participant and guardian;
- ending a relationship closes the current episode (who and when are kept);
  it is never deleted or reopened;
- a **new episode** may start afterwards with the same guardian. It starts
  from scratch: relationship type chosen again, legal representation
  `comunicat` again if set (never inherited from an earlier episode), with its
  own review; a review of an earlier episode never marks a new one as
  reviewed;
- `Relacions anteriors` lists ended episodes with their period
  (`Des de 03/2024 fins a 09/2025`); `Torna a vincular` starts a new episode
  from the latest ended one, for users with guardian management over that
  participant;
- linking again is possible only for **that same participant**: a former
  relationship never gives access to the guardian's other participants, and
  the shared-guardian rules above apply to the new episode unchanged.

---

# 10. Legal representation and administrative review

## 10.1 Three different facts

| Fact | Meaning | Who |
|---|---|---|
| **Comunicat** | The family told the group | whoever holds `guardian.manage` over the participant |
| **Acreditat** | A supporting document was seen. Gestió stores who, when and a reference — not the document | **only Secretaria or general coordination** (`representation.accredit`) |
| **Revisat per Secretaria** | Secretaria has seen the change. An administrative acknowledgement; it is **not** a legal accreditation and never turns into one by itself | Secretaria (`review.manage`) |

Shown separately, for example
`Representant legal · comunicat · revisat per Secretaria el 3 d'oct.`. The word
"verified" is never used.

## 10.2 Relevant changes

Any change affecting legal representation: a guardian is recorded as, or stops
being, a legal representative; a relationship with a legal representative
ends; the basis changes between `comunicat` and `acreditat`.

In one atomic operation the server:

1. keeps the previous state in an append-only history;
2. records who entered the change, when and its provenance (§14.3);
3. opens a review task for Secretaria;
4. raises the in-app notification (§13).

The change is effective at once; the review does not gate it.

## 10.3 Review queue (`Revisions`)

Task kinds: `Canvi de representació legal`, `Sol·licitud de canvi en dades d'un
tutor` (§9.3), `Possible tutor duplicat`, `Possible participant duplicat`.

```text
Per revisar ──► Vista
          └───► Incidència ──► Resolta
                          └──► Escalada
```

- `Marca com a vista` — acknowledgement, with who and when.
- `Assenyala una incidència` — with a short internal note.
- `Aplica` / `Rebutja` — for change requests on shared guardian data; the
  requester sees the outcome next to the affected item.
- `Escala` — contradictory or disputed cases go to general coordination.
  **Escalation changes no data.** Gestió never resolves representation or
  pick-up rights by itself; pick-up authorisations are not modelled in 3.5E.
- Notes are internal, short and must not contain health data.

---

# 11. Basic fee status in the record

- The header shows one line per current round: `Quota 2026/2027: Pagada`,
  `Parcial`, `Pendent` or `Incidència`.
- Source: the existing basic projection (`annual_fee_obligation_status`,
  already exposed by the scoped fee-status list with exactly these four states
  and no amounts).
- Authorisation: the existing `finance.fee.status.read` over the participant's
  current section, or the existing group-wide finance read. Nothing new is
  granted. **Secretaria holds neither today, so it sees no fee line** unless a
  later decision grants the basic status (not required for 3.5E).
- The basic status never gives amounts, payments, evidence or allocations.
  Treasury work stays in Quotes. No link into finance detail for users without
  finance access.
- A participant without an obligation in the round shows no fee line.

---

# 12. Section change and leaving

| Action | Rule |
|---|---|
| `Canviar de secció` | `profile.manage` over the **current and the target** section. A section coordinator alone cannot move a participant into or out of another section; Secretaria and general coordination can. History kept by the existing triggers |
| `Donar de baixa` | `profile.manage`; confirmation; history kept |
| `Reactivar` | `profile.manage`; reopens membership in the same section |
| Bulk change at the start of the course | deferred |
| Delete | not offered; erasure and retention are legal-phase decisions |

Never optimistic.

---

# 13. Follow-up from Inici and notifications

The Dashboard keeps its architecture and appearance: new entries are ordinary
attention items in the existing "Requereix la teua atenció" block, produced by
one aggregate request. **Inici is not redesigned.**

| Attention item | Who sees it | Opens |
|---|---|---|
| `3 fitxes pendents de completar` | holders of `profile.manage`, counted **only within their scope** (a section coordinator: their section; Secretaria and general coordination: the group) | `#/participants?completitud=pendents` |
| `2 canvis de tutoria per revisar` | holders of `review.manage` | `#/participants/revisions` |
| `1 cas escalat` | general coordination | `#/participants/revisions` |

Rules:

- The count is computed by the server with the caller's scope; a user without
  the capability triggers no request and receives nothing.
- The attention item contains a number only: no names, no sections of other
  users, no reasons.
- The destination list applies the same scope again.
- The outcome of a change request is shown to its author on the participant's
  `Família` tab.
- Notifications are in-app only. No e-mail to staff; nothing is sent to
  families from this module.

---

# 14. Manual incorporation

Current information comes from the old CRM and from paper documentation. It is
entered by hand, progressively. **No CSV/XLSX import in this phase.**

## 14.1 Guided flow (`Nou participant`)

Drawer on desktop, full-screen sheet on mobile; one step at a time with a
persistent summary (`Pas 2 de 6`).

| Step | Content | Rules |
|---|---|---|
| 1. Cerca prèvia | Name (and birth date if known) → possible existing participants **in the user's scope** | The user may open an existing record instead. Matches outside the scope are never shown (§14.2) |
| 2. Participant | Name (required); birth date (may be left empty → provisional record) | Same validation as editing |
| 3. Secció | One section among those the user manages | Fixed text when there is only one |
| 4. Tutors | For each: create new or link a visible one; relationship; legal representative yes/no (`comunicat`) | Optional |
| 5. Contactes | Contacts of each guardian (and of the participant if any); one primary per kind | Optional |
| 6. Revisió de completitud i confirmació | What will be created, in plain words; **what is still missing** (`Informació pendent: data de naixement, contacte`); provenance | One atomic operation; nothing is written before this step |

After confirming: toast `Participant afegit`, route to the new detail, which
shows `Informació pendent` when applicable. Relevant changes from step 4 open
their reviews.

## 14.2 Duplicates

- Nothing is merged automatically.
- In scope: the user sees possible duplicates and decides.
- Out of scope: the server discloses nothing; the record is created and
  Secretaria receives a `possible duplicate` review.

## 14.3 Provenance

Recorded for every incorporation and relevant change. Values:
`CRM anterior`, `Documentació física`, `Comunicació de la família`, `Altres`
(with a short note).

## 14.4 Data during development

Development and test stay `SYNTHETIC_ONLY`: **no real personal data**. 3.5E
delivers and validates the flow with synthetic people. Entering real
participants is a production gate (real Access/MFA, legal validation, leaving
synthetic mode), outside this phase.

---

# 15. Consent and legal documentation

- The append-only `consent_record` structure of migration 0011 is kept; two
  permissions are declared and assigned to nobody. **No consent catalogue, no
  legal text, no consent screen, no new legal document.**
- Deferred to the legal phase: the consent catalogue and texts; who grants and
  records them; retention, blocking and erasure; confidentiality commitments;
  the authorisation policy, signatures and unanimity for granting access; the
  conditions for long delegations; whether accreditation documents may be
  stored; the final guardian relationship taxonomy.
- Existing RC1 work is located at
  `../Documentos jurídicos/Parpallo_Documentacio_2026_RC1/` (outside this
  repository). Identified by title only, not reviewed for this spec:

| RC1 document | Relevant to |
|---|---|
| `03_Fitxa_inscripcio` | participant and guardian fields |
| `05_Autoritzacio_imatge_veu`, `06_Autoritzacio_activitats_urgencies` | consent catalogue |
| `04_Informacio_proteccio_dades_adults`, `08_Informacio_addicional_privacitat` | privacy information |
| `10_Compromis_confidencialitat_dades_seguretat` | confidentiality of people with access |
| `11_Normes_acces_plataforma`, `12_Matriu_rols_permisos`, `13_Registre_alta_modificacio_revocacio_permisos` | access model, role matrix (no CRM manager post), delegation records — to reconcile |
| `14_Protocol_incidents_bretxes` | escalation |
| `17_Registre_activitats_tractament_RAT`, `18_Politica_conservacio_bloqueig_supressio` | retention |
| `PENDIENTES_ANTES_DE_V1.0`, `QA_RC1`, `Revisión jurídica fase 5/` | open legal points |
| `07_Fitxa_medica`, `19_Protocol_autoritzacio_medicacio` | health — out of scope |

---

# 16. States and errors

## 16.1 Object states

| Object | States |
|---|---|
| Membership | `Actiu`, `De baixa` |
| Completeness | `Fitxa completa`, `Informació pendent` (with the missing items) |
| Guardian relationship | current, ended (`Relacions anteriors`); several episodes per pair over time, one current at most (§9.4) |
| Legal representation | none, `comunicat`, `acreditat`; plus `pendent de revisió` / `revisat per Secretaria` |
| Contact point | current, ended; primary |
| Review task | `Per revisar`, `Vista`, `Incidència`, `Resolta`, `Escalada` |
| Change request | `Enviada`, `Aplicada`, `Rebutjada` |
| Fee (basic) | `Pagada`, `Parcial`, `Pendent`, `Incidència` |

## 16.2 Screen states

As ACTIVITIES.md §20: first load (skeleton), refresh, empty
(`Encara no hi ha participants en les teues seccions.`), filtered empty, error
with retry, partial error per tab or per block (the fee line, the contacts of
one guardian and the review queue fail independently), permission-limited,
mobile, light/dark.

## 16.3 Error copy

| Code | Copy |
|---|---|
| `not_found` (also out of scope) | `No tens accés a aquest participant o ja no existeix.` + `Torna a Participants` |
| `invalid_participant` | `Revisa els camps marcats.` |
| `forbidden` | `No tens permís per a fer aquest canvi.` |
| `stale_participant` | `Esta fitxa ha canviat mentre l'editaves. Actualitza-la abans de guardar.` (input preserved) |
| `guardian_change_requires_request` | `Aquestes dades les gestiona Secretaria. Pots enviar una sol·licitud de canvi.` |
| `section_transfer_requires_both` | `Per a canviar de secció cal la coordinació de les dues seccions o Secretaria.` |
| `accreditation_not_allowed` | not shown: the action is absent without the capability |
| `invalid_transition` | `L'estat ha canviat. S'ha actualitzat la informació.` |
| any other | `No s'ha pogut completar l'acció. Torna-ho a provar.` |

No backend code, UUID or English identifier is ever visible.

---

# 17. Privacy and security

- Every control is server-side, within the participant's current section.
- No indirect access through guardian relationships, duplicate search, the
  Dashboard count or error messages.
- Lists carry no contact data, guardians, birth dates or identifiers.
- Contact consultations are audited; contact values never reach logs or audit
  metadata.
- History of relationships and representation is append-only.
- Technical administration has no access to this module.
- Audit events carry actor, time, action, resource and a reason code; no names,
  contacts or notes.
- Synthetic data only in development and test.

---

# 18. Design, responsive, motion, accessibility

- **Iris as it is**: neutral surfaces, Iris for selection, focus and the
  primary action; semantic dots for status; no new visual language. Reuse the
  3.5D components; add only what §19 lists.
- **Responsive:** desktop ≥ 1180 rows; compact 768–1179 hides secondary
  information first; mobile < 768 compact cards, full-screen detail with sticky
  tabs, the guided flow one step per screen, sheets for confirmations, ≥ 44px
  targets.
- **Motion:** structural only (list, list → detail, drawer, step change, state
  morph, list insert/remove), with reduced-motion and reduced-transparency
  support. No artistic pass.
- **Accessibility:** one link per row named by name + section; status and
  completeness always as text; `Mostra el contacte` is a button with
  `aria-expanded`; the guided flow announces the step; dialogs default to the
  safe choice; focus management as in 3.5D.

---

# 19. Components

Reused from 3.5D: router, PageHeader, FilterBar, SearchField, Drawer/Sheet,
FormSection, Tabs, StatusBadge, ConfirmDialog, ConflictBanner, OverflowMenu,
Toast, EmptyState, InlineError, Skeleton.

New, written to be reusable: ParticipantRow (+ compact card), Avatar,
CompletenessBadge and MissingItems, SectionHistory, GuardianBlock,
RevealableContact (promoted from the 3.5D pattern, now with audit),
RepresentationStatus, FeeStatusLine, GuidedFlow (stepper + summary),
DuplicateNotice, ChangeRequestForm, ReviewQueue and ReviewTask.

Convention: view modules under `gestio/public/views/`, pure model with Node
tests, legacy participants view removed.

---

# 20. Backend requirements

Inspected baseline: `participant` has `id`, `display_name`,
`current_section_id`, `status`, `birth_date` (nullable) and no version or
timestamps; list and detail return only active participants without birth
date; `guardian`, `participant_guardian`, `contact_point` and `consent_record`
exist without endpoints; delegations, catalogue, capabilities, audit and the
basic fee projection exist.

| Id | Requirement | Impact on authorisation or data |
|---|---|---|
| **B1** | Permissions of §3.2 in catalogue, schema and role matrix; grants for holders; delegable list and `SECTION_DELEGATE` matrix extended | append-only migration; `SECRETARY` gains group-wide management; role-matrix tests |
| **B2** | Retirement of `CRM_MANAGER` (§4.3) | service + label + tests; no trigger, no historical change |
| **B3** | Capabilities projection extended (§3.4) | — |
| **B4** | `participant.version`, `created_at`, `updated_at`; write service: create (also provisional), edit, deactivate, reactivate, change section (both-sections rule) | additive migration; audited |
| **B5** | List and detail read model: inactive participants, birth date in detail, **completeness derived server-side** with the permission-dependent missing items, `completitud` filter | no new status |
| **B6** | Guardian and contact read model per participant with the shared-guardian rules; contact values only through an audited consultation endpoint | new audit use of the existing sensitive-read action; audit resource types extended; context as a reason code, since audit metadata accepts no free fields |
| **B7** | Guardian and contact write service, including the "all linked participants in scope" check | `participant_guardian` had a primary key (participant, guardian) and no author, provenance or basis. Resolved: author/provenance/basis in 0016; relationship episodes with a surrogate id in 0017 (§9.4) |
| **B8** | Append-only history of relationships and legal representation (`comunicat` / `acreditat`, who, when, provenance, reference); accreditation limited to `representation.accredit` | new table; the current boolean keeps no history |
| **B9** | Review tasks and change requests: table, service, queue, state machine of §10.3, apply/reject | nothing exists; security incidents are not reused |
| **B10** | Duplicate search for participants and guardians with scope rules | distinct from registration matching |
| **B11** | Atomic guided creation (participant, guardians, relationships, contacts, provenance, reviews) | one batch |
| **B12** | Basic fee status per participant, reusing the existing projection and permissions | new read path only; no new permission |
| **B13** | Dashboard aggregate: scoped counts of incomplete records, open reviews and escalations | numbers only |
| **B14** | Delegation duration: default 90 days, maximum 365 days, no indefinite; same 365-day cap for the delegate role expiry | constants in two services; tests |
| **B15** | Backup/restore invariants and demo dataset for the new tables | recovery script |

Not in 3.5E: consent endpoints, import, export, extraordinary access,
delegation interface (3.5H), per-participant activity read model, server-side
search, any change to ratification.

---

# 21. Real technical contradictions

| # | Contradiction | Consequence |
|---|---|---|
| **T1** | `CRM_MANAGER` is fixed in a `CHECK` constraint of a historical migration | It cannot be removed; it is retired by the service (§4.3) |
| **T2** | Tests and the seed depend on `CRM_MANAGER` and on user 106 as a user without access | Test changes listed in §4.3; user 106 stays as the retired-role fixture |
| **T3** | The 90-day limit is a hard maximum coded twice, and the expiry is mandatory, so no "default" exists; the delegate role expires at most after 90 days too | B14 raises the cap to 365 in both places and adds the 90-day default, so a long delegation keeps its role |
| **T4** | "Other people expressly authorised" vs a delegation that needs a role containing the permission: without a group-wide role only `SECTION_DELEGATE` (one section) fits | Delegated access is section by section |
| **T5** | No delegation interface until 3.5H, yet monitors' access depends on delegations | In 3.5E delegations are managed through the API only |
| **T6** | Any refusal to edit shared guardian data lets the user infer that something lies outside their scope | Mitigated, not eliminated: neutral message, no names, sections or counts |
| **T7** | "Contacts consulted are audited with their context" vs audit metadata that accepts only `count` and `source` | Context is recorded as a reason code and resource identifiers; no free text |
| **T8** | Basic fee status "when authorised": Secretaria has no fee permission | Secretaria sees no fee line unless later granted |
| **T9** | A provisional record has no birth date, and automatic registration matching needs it | Registrations for such participants go to human review (existing behaviour, not a new exclusion) |
| **T10** | The relationship table could not hold a new relationship after an ended one and kept no author or provenance | Resolved: migration 0016 (author, provenance, basis) and 0017 (episodes, §9.4) |
| **T11** | "Notify Secretaria" vs no staff notification mechanism | In-app attention items only |
| **T12** | Initial incorporation of current members vs a synthetic-only environment | The flow is delivered with synthetic data; real entry is a production gate |

---

# 22. Product decisions — all resolved

| Id | Decision | Resolution |
|---|---|---|
| **D1** | Completeness beyond the birth date | **Resolved (2026-10-01):** minors under 18 need a current guardian and a current contact; participants 18+ need only their own current contact, no guardian. Age is derived from the birth date (§8.2) |
| **D2** | Maximum delegation duration | **Resolved (2026-10-01):** maximum **365 days**, default 90 days, always an expiry (§5.2). The conditions to authorise long delegations remain an organisational/legal matter, deferred |

No product decision remains open for 3.5E. Legal-phase matters stay in §15.

---

# 23. Acceptance criteria

1. Each action appears only with its capability, and the server authorises
   every operation again within the participant's current section.
2. Secretaria manages participants, contacts and guardians group-wide and
   reviews changes. "CRM Manager" appears nowhere in the interface; the retired
   role cannot be assigned and grants no participant permission.
3. A monitor without a delegation has no access; with a ratified, unexpired
   delegation they get exactly that permission in that section; expiry and
   revocation end it.
4. Treasury and technical administration cannot list or read participants,
   guardians or contacts.
5. Membership and completeness are shown as separate facts; a provisional
   participant can be created without birth date and is `Actiu` with
   `Informació pendent`; no flow excludes them because of it.
6. Inici shows `n fitxes pendents de completar` only to users who can manage
   participants, counted within their scope, and opens the filtered list.
   Secretaria and general coordination see the group; a section coordinator
   only their section; others nothing.
7. The list shows no contact data, guardians or birth dates; the search text is
   never in the URL.
8. Contact values are returned only on explicit consultation, and each
   consultation leaves an audit event with user, resource, action, date and
   context — and no phone, address or e-mail.
9. Shared guardian data is edited directly only with authority over every
   linked participant; otherwise a request reaches Secretaria, who applies or
   rejects it, with full traceability. Neither the message nor any response
   reveals the identity or existence of participants of other sections.
10. Duplicates are never merged automatically; out-of-scope matches are never
    disclosed and produce a review for Secretaria.
11. A change affecting legal representation keeps the previous state, records
    author, time and provenance, opens a review and notifies Secretaria, in one
    atomic operation.
12. Only Secretaria or general coordination can mark representation as
    accredited. Acknowledging a review never sets it. The interface
    distinguishes `comunicat`, `acreditat` and `revisat per Secretaria`.
13. Disputed cases can be escalated; escalation changes no data.
14. The record shows the basic fee status only to users with the existing
    basic or finance capability over that section, and never amounts.
15. Section change needs manage over both sections and keeps history.
16. Delegations default to 90 days, accept shorter and longer durations up to
    the maximum, and can never be indefinite.
17. Concurrent edits never overwrite silently.
18. No consent catalogue, legal text, import, export, delegation interface or
    extraordinary-access interface is introduced.
19. Refresh, back/forward and deep links work; out-of-scope and missing records
    show the same message.
20. States and errors behave per §16; light/dark and mobile per §18.
21. Existing tests, lint, typecheck, audit and CI stay green; B1–B15 have
    authorisation, scope and regression tests; demo data is synthetic.

---

# 24. Human validation checklist

With the demo dataset, in light and dark, at desktop, compact (~1000) and
mobile (~390):

- [ ] The list is calm and scannable; no contact data anywhere in it.
- [ ] `Actiu`, `Informació pendent` and `De baixa` are understood at a glance
      and do not look like the same kind of thing.
- [ ] A provisional participant does not look like an error.
- [ ] As a Tropa coordinator: only Tropa participants; `Nou participant`
      creates in Tropa; another section's participant link shows the generic
      "no access" message.
- [ ] As Secretaria: whole group, `Revisions`, accreditation available; no
      "CRM" anywhere.
- [ ] As a delegated monitor with read + contacts for Tropa: can consult, cannot
      edit; after revoking the delegation, access disappears.
- [ ] As treasury and as technical administrator: the module is absent.
- [ ] The guided flow can be completed by someone who has never used it, saving
      a provisional record and finishing it later from the record.
- [ ] The completeness step states clearly what is missing.
- [ ] Inici shows `n fitxes pendents de completar` with the right number for
      each profile and opens the right list; Inici looks the same as before.
- [ ] `Mostra el contacte` feels deliberate, not obstructive; values are not
      visible before it.
- [ ] Editing a shared guardian as a section coordinator shows the Secretaria
      message and says nothing about other sections or people.
- [ ] Secretaria receives the request, can apply or reject it, and the
      coordinator sees the outcome.
- [ ] A change of legal representation reads as `comunicat`; after Secretaria
      acknowledges it, it reads as reviewed — and clearly **not** as accredited.
- [ ] Accrediting is only possible for Secretaria or general coordination.
- [ ] Escalating a disputed case changes nothing in the record.
- [ ] The fee line shows a plain state and no amount; Secretaria sees none.
- [ ] Editing the same record in two windows shows the conflict and loses
      nothing.
- [ ] Mobile feels designed for mobile: cards, full-screen detail, one step per
      screen.
- [ ] Keyboard only: list, detail, tabs, guided flow and dialogs are usable;
      focus is always visible.
- [ ] Nothing shows UUIDs, backend codes or English identifiers.
