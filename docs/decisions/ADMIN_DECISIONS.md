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
