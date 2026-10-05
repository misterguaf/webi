# Decisions — Administració (3.5H.1)

Status: CLOSED for H.1 (product decisions from the 3.5H.1 brief). Implementation: migration 0043,
`gestio/src/access-model.js`, `gestio/src/services/access-admin-service.js`, `security-service.js`,
`delegation-service.js`, `gestio/public/views/administration.js`. Tests: `test/gestio-access-admin*.test.js`.

## Model (G.1A preserved)

1. Effective access is derived server-side on every request from three sources only: **role ceiling + individual
   grant**, **delegation** (inside a role ceiling) and **financial delegation**. No fourth layer.
2. A person may hold **several roles at once** (e.g. SECRETARY + SECTION_DELEGATE Tropa). There is no "primary role".
3. A role is the **base permission set** (ceiling). Assigning a role from Administració grants its **default**
   permissions as *role-sourced grants* (they end with the role). Permissions that need an explicit decision are never
   default: bank-description reveal, own-reimbursement approval, health, ratification authority, movement import for
   Coordinació general and the whole user-administration ceiling of TECH_ADMIN. The legacy API without `permissions`
   keeps assigning a pure ceiling.
4. A **direct grant** is an individual permission inside one of the person's role ceilings, optionally limited to one
   **section**; a section-scoped grant never becomes group-wide (scope = the narrower of grant and role). GLOBAL
   permissions are never section-scoped.
5. Role-sourced permissions are informational in the access detail: they change by changing the role. **No negative
   overrides** in v1.
6. **Access packages** are UI presets that select existing roles, permissions and section; they are never stored and
   never authorise anything.
7. The permission catalogue stays in code/schema. Administració assigns existing permissions; it never creates them.
   New permission in H.1: `auth.session.revoke`.

## Authority to change access

8. **Accounts** are provisioned by **Secretaria**, **Coordinació general**, or a person explicitly granted the
   user-administration capability (`auth.user.manage`, with `auth.role.manage` / `auth.permission.manage`). Tresoreria
   does not get it. **TECH_ADMIN alone is not a superuser**: its ceiling contains user administration, but it is
   effective only through an explicit individual grant by Coordinació general; it never opens participants, finance,
   health, contacts, evidence or admissions.
9. Identity stays with Cloudflare Access: an account is created in Gestió and invited by verified e-mail; Gestió has no
   passwords.
10. **Origin authority**: nobody grants a permission they do not hold themselves (role + grant, never through a
    delegation) over a scope at least as wide. Coordinació general is the group's originating authority. **3.5H.2
    correction:** no role name gates who assigns a role (elevated roles included); assignment is capability-based
    (`auth.role.manage`) and limited only by origin authority. Elevated assignments stay audited as `ELEVATED_ROLE`.
11. **No self-escalation**: nobody changes their own roles, grants or delegations (server-side).
12. `authorized_by` (whose authority justifies the act) ≠ `granted_by`/`provisioned_by` (who performs it); both are kept.

## Delegations

13. Temporary and scoped; **default 90 days, maximum 365**; revocable at once; **never sub-delegable**; the named
    authoriser must hold the capability by role + grant.

## Ratification

14. An authorised role assignment, direct grant or delegation is **effective immediately**
    (`ACTIVE_PENDING_RATIFICATION`). A delegation is authorised when its named authoriser confirms it (at once when the
    provisioner is the authoriser).
15. Administració → Ratificacions lists pending acts; authorised people **RATIFY** (with the Council act reference) or
    **REVOKE**. Nobody ratifies an act they provisioned or that benefits them.
16. **Nothing is revoked automatically for lack of ratification**: pending acts older than 90 days are flagged as
    overdue — a UI attention signal only, with no effect on authority and no legal meaning. Gestió does not judge whether a Council meeting was valid. Temporary delegations still expire on their date.

## Revocation and sessions

17. Removing a role (with its role-sourced grants), a direct grant or a delegation takes effect on the next request:
    authority is never cached in the session.
18. Everyone manages their own sessions. Revoking **another person's** sessions needs `auth.session.revoke`
    (Coordinació general; explicit grant for user administrators). It shows only session dates and never gives access to
    that person's data.

## Audit

19. Audited: account provisioned (`USER_CREATED` / `ACCOUNT_PROVISIONED`), role assigned/removed, permission
    granted/revoked, delegation granted/confirmed/ratified/revoked, role/permission ratified, sessions revoked
    (`ADMIN_REVOKED`). No tokens, secrets or contact data in audit payloads.

## Out of scope (H.1)

Noves altes (3.5H.2; the "Noves altes" package is a disabled placeholder), global Activitat, the Incidències domain,
Health, negative overrides, Council/quorum management.

# H.2 — Noves altes (CLOSED)

Implementation: migration 0044, `gestio/src/services/admissions-service.js`, `PortalIntake /v1/admissions`,
`api/_lib/handler.js`, `gestio/public/views/participants/admissions*.js`. Tests: `test/gestio-admissions*.test.js`.

1. **One public form**: the existing «Fer-se scout» form (`/api/alta`) is the only intake. With the `GESTIO_INTAKE`
   service binding it writes an `AdmissionRequest` in Gestió (operational source) through the existing PortalIntake
   boundary. Without the binding (the current public deployment, real data) the legacy Apps Script/Sheets write stays as a
   **transitional, non-authoritative** path until cut-over; Sheets is never the admissions database of record.
2. **Minimal data**: the form's existing fields only (name, surnames, birth date, optional section, guardian name, phone,
   e-mail, how they heard, two consents). **No health data, no DNI.** Gestió stays SYNTHETIC_ONLY.
3. **States** `PENDING → IN_REVIEW ⇄ WAITLISTED`, then `ACCEPTED | REJECTED | WITHDRAWN` (final). WAITLISTED is an active
   state; REJECTED (a category, never free text) ≠ WITHDRAWN (the family withdrew). Requests are never deleted; every
   change is an immutable event with actor and time. No participant is created except by ACCEPT.
4. **Section**: the public choice (labels mapped to MANADA/TROPA/ESCOLTA/CLAN) is untrusted; the operational section is
   confirmed internally before acceptance. Scope = confirmed section, or the requested one until confirmed; a request
   without section is group-wide only.
5. **Permissions** `admissions.read / manage / decide` (SCOPED, delegable). Secretaria and Coordinació general: whole group.
   Coordinació de secció: its section, **including accept/reject** (Gestió records a decision; it does not run the
   Council). Anyone else: through H.1 grants or delegations (SECTION_DELEGATE holds the ceiling, never by default).
6. **Matching** before ACCEPT, server-side, against every participant (exact name key + birth date): **NONE** → explicit
   creation; **CLEAR** → link only after explicit confirmation of that participant (a former member is reactivated);
   **AMBIGUOUS** → blocked and flagged inside Admissions until a group-wide reviewer (who can see every participant)
   resolves it as a different or the same person. No automatic merge, no fuzzy identity, candidates never leave Gestió
   and never reach section coordinators or the public.
7. **Acceptance is atomic**: participant + enrolment episode in the confirmed section + (minor) guardian with phone/e-mail,
   or (adult) own contact + provenance (`COMUNICACIO_FAMILIA`, «Noves altes», request linked). The request's contact is
   cleared once it lives in Participants (not kept twice). A stale accept writes nothing.
8. **Public answer is neutral**: same message whatever happens internally; no ids, matches, waitlist or other requests;
   no status browsing.
9. **Audit**: received, review started, waitlisted, returned, section confirmed, match resolved, accepted (new/linked),
   rejected (category), withdrawn — minimal payload, no contact data or free text.
10. Out of scope: Activitat (H.3), general Incidències (H.3), Health (Phase 5), retention of rejected/withdrawn intake
    data (LEGAL DECISION REQUIRED).

## H.3 — Activitat i Incidències i millores (CLOSED)

0. **Corrections to H.2.** Noves altes depends only on `admissions.read / manage / decide` + scope, never on
   `participants.profile.read` because it lives under Participants: a person with only `admissions.read` (Tropa) uses the
   inbox without the participant list. An accepted request's participant is navigable only if the viewer can read that
   participant independently; otherwise «Vinculada a una persona de Participants» (no link, no id). The legacy public label
   «Estol (8-11)» keeps mapping to MANADA (no ESTOL section). The visible section name is **Esculta** (migration 0045);
   the internal code stays `ESCOLTA`.
1. **Three distinct things.** Raw audit (`audit_event`) stays the authoritative technical/security history. **Activitat**
   is a read-only *projection* of it (no table, no second truth). An **incident** (`work_incident`) is an operational work
   item. Security incidents (`security_incident`) are unrelated and unchanged.
2. **Activitat is for every signed-in user** (no capability). Only a closed whitelist of meaningful actions is projected
   (participants, guardians/contacts, admissions, activities, registration decisions, meaningful payment/treasury actions,
   round close, users/roles/permissions/delegations, ratification/revocation, other people's session revocation, sensitive
   reads/reveals/downloads the audit already records, exports, incidents). Logins, own-session housekeeping, AUTHZ
   decisions, list loads, notifications, automatic intakes, retention and debug events are omitted (omission over noise).
3. **Actor always named** (accountability). **Subject named only if the viewer could identify it through their own normal
   permissions** (participant → `participants.profile.read` on its current section; admission → `admissions.read` on its
   section; activity → `activities.read`); otherwise a generic noun («un educand», «una persona», «una activitat»). Gestió
   user names (targets of access changes) are visible like actors.
4. **Never content**: no metadata, amounts, contact values, health, evidence, original bank descriptions, free-text
   reasons, finance resource ids, session or request ids. Future Health events follow the same rule (only that access
   changed). Search runs server-side over the *projected* text only; filters: module, kind, actor, dates.
5. **Links are decided by the server**: only to a resource the viewer can already open (participant, request, activity,
   own/managed incident, user administration with `auth.user.manage`, Tresoreria module with `finance.treasury.read`).
   Activitat is never a permission bypass.
6. **Incidències i millores**: types ERROR / IMPROVEMENT / ACCESS / DATA / OTHER; origins MANUAL / SYSTEM; states
   OPEN → IN_PROGRESS → RESOLVED (also OPEN → RESOLVED and a simple reopen). **No priority/severity**, no attachments,
   screenshots, comments, assignee or notifications in v1. Minimal fields: type, title, optional description, module
   (pre-filled from the page the person came from), reporter, timestamps, optional resource reference, short resolution
   (≤ 280). Facts immutable, no delete.
7. **Everyone reports and sees only their own** (state and short answer); another person's report is indistinguishable
   from a missing one. **Management needs `admin.incidents.manage`** (GLOBAL — incidents are not owned by a section):
   Secretaria and Coordinació general hold it; **TECH_ADMIN only has the ceiling** and manages incidents only after an
   explicit individual grant (H.1 origin authority, no self-grant). OPEN badge only for managers.
8. **SYSTEM incidents only for deterministic blockers.** H.3 wires the ambiguous admission match: the blocked accept opens
   exactly one incident keyed `ADMISSION_MATCH_AMBIGUOUS:<request>` (unique; reused, never duplicated; opening the request
   writes nothing). It references the request and copies none of its personal data. Resolving the match (or rejecting /
   withdrawing the request) resolves it with a short system answer.
9. Activitat shows «X ha reportat / començat / resolt una incidència»; titles and descriptions never reach it.
10. Out of scope: notifications, Health (Phase 5), retention of incidents and of the activity projection beyond the audit's
    own (LEGAL DECISION REQUIRED, as for audit retention).
11. **Incident environment (CLOSED).** Every work incident records, from server configuration only, the deployment
    that created it: `LOCAL / STAGING / PRODUCTION` (`environment-policy.js` `deploymentEnvironment`: development/test
    runtimes are LOCAL; a production runtime is PRODUCTION unless its deployment declares
    `DEPLOYMENT_ENVIRONMENT="STAGING"`; contradictory values fail closed). Users never choose or submit it (an
    `environment` field in a report is rejected); SYSTEM incidents use the same value. Immutable after creation
    (migration 0047; legacy rows are LOCAL, the only place Gestió has run). Managers see a discreet badge
    (PRODUCCIÓ / PROVES / LOCAL) and can filter by it; reporters see it only in their own detail. **Real staging
    infrastructure is future infrastructure/hardening work.**

## Phase H boundary and pending reviews

- Phase H implementation spans `5e56046c0e5fd86ae7e8f5b6d5d01d914f50b96b..` the final `phase/3.5h-admin` SHA (tag
  `phase-3.5h-complete`). **Independent audit: PENDING.**
- Legal retention periods for admissions (rejected/withdrawn intake data), work incidents and the audit that Activitat
  projects remain **pending legal/hardening review** (LEGAL DECISION REQUIRED).
