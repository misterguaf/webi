# Quotes — functional screen spec (3.5I-Q, v1)

Functional, not artistic: layout and components are those of current Gestió; Phase J restyles.

## Purpose

«Quins educands han pagat la quota anual i quins no?» — the operational annual-fee module. Quotes answers *what is
the state of this participant's quota*; Tresoreria answers *what happened to the money*. Both read the same canonical
obligation/allocation data (no second fee state; Excel stays output only).

## Audiences and projections (server-decided: `GET /api/quotes`, `GET /api/quotes/participants/:id`)

| Viewer | Capability (existing) | Projection |
|---|---|---|
| Coordinació de secció | `finance.fee.status.read` (section) | **basic**: ACTIVE participants of the CURRENT section; name, section, status, counts |
| Group-wide basic reader | `finance.fee.status.read` (group) | basic for every section |
| Tresoreria, Coordinació general (as granted today) | `finance.fee.read` | **financial**: amounts, family, payments, proofs, plan, issues, corrections, overpayment; inactive members too |
| Scoped finance reader | `finance.fee.read` (section) | financial within its sections; siblings outside them are never shown |
| Secretaria (family groups only), CRM, TECH_ADMIN alone | — | no Quotes (Secretaria keeps the family-groups panel) |

The basic projection never carries amounts, payers, evidence, bank data, allocation internals or other sections'
siblings. Actions are offered only from capabilities the server reports (`actions.reviewPayments`, `actions.manage`).

## States

From the authoritative view `annual_fee_obligation_status` (never client arithmetic): **Pagada** (allocated = due),
**Parcial** (0 < allocated < due), **Pendent** (nothing verified), **Incidència** (open issue on the quota or on a
funding payment, or allocated > due). Issue codes are shown as sentences (e.g. «No s’ha pogut determinar encara a
quina quota correspon el pagament.»), never as codes.

## Main list (`#/quotes`)

- Header «Quotes · <curs>», subtitle = scope («Tropa», «Tot el grup»).
- Counts for the scope (allowed to every viewer): Educands, Pagada, Parcial, Pendent, Incidència (clickable filters).
- Money strip only for financial readers (existing `/api/fees/rounds/:id/metrics`: previst, rebut verificat, pendent,
  verificat sense assignar).
- Quick states: Totes · Pendents · Parcials · Incidències · Pagades. Filters: search (accent-insensitive), section (if
  more than one in scope), course (if more than one round). All server-side; URL-backed (`estat`, `seccio`, `ronda`,
  `q`); unknown values dropped. «Carrega’n més» after 100 rows.
- Rows: name, section, status; financial rows add «Rebut X de Y» and «baixa» for former members.

## Detail (`#/quotes/<participant>[?ronda=]`)

- **Basic**: name, section, course, status. Link «Obri la fitxa» only with participant profile access. Nothing else.
- **Financial**: import degut / rebut / pendent, order (1r fill…), applied quota (100 % / 50 %), situation sentence,
  overpayment note («Quota coberta. Hi ha X € addicionals pendents de resoldre.»), family (in-scope siblings with order,
  section, % and status), assigned payments (date, amount, review state, «Veure justificant», «Revisa el pagament»),
  proofs received but not allocated («un justificant no és un pagament verificat»), instalment plan, issues («Resol» /
  «Obri una incidència» with the existing endpoints and permissions), amount corrections, links to the participant,
  Tresoreria and the Treasury tools.

## Treasury tools (`#/quotes/eines`)

The existing 3B fee panel (round configuration, obligations, family grouping, payment review and allocation, issues),
unchanged. «Revisa el pagament» opens it at the payment (`?pagament=<id>`). Redesign is Phase J / later product work.

## Family portal flow (existing, write-only)

`inscripcions` → «Quota anual»: children (name, surnames, birth date, section as an untrusted hint), optional declared
amount, receipt (JPG/PNG/WEBP/PDF ≤ 4 MB), tutor, contact, privacy. No DNI, no health. The answer is always «Comprovant
rebut · Pendent de revisió» with a reference, whatever the matching. Server-side matching (clear → linked; ambiguous or
none → review); candidates are never returned; idempotent replays. The proof creates a payment attempt with private
evidence; the quota changes only after Treasury verifies and allocates it (bank reconciliation stays human).

## Responsive

Desktop, tablet and 375 px: no page overflow; counts wrap to 2–3 columns; quick states scroll horizontally; filters
stack; rows keep name + status; detail facts wrap; actions drop below the row on mobile.

## Boundary with Treasury

Quotes reads; Treasury reconciles. Navigation: Quotes → «Obri Tresoreria» / «Eines de Tresoreria» for financial readers.
