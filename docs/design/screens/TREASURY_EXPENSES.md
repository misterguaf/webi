# Gestió — Tresoreria · Despeses

Status: IMPLEMENTED — pending Borja/Atlas functional and visual review
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5G.2A
Baseline: `phase-3.5g1-complete` (`e1aa9f0`)
Depends on: TREASURY\_HOME.md, TREASURY\_MOVEMENTS.md, ../TREASURY.md (§10 expenses, §10.3 counterparties, §14 budget, I20 self-approval)

---

## 1. List — `#/tresoreria/despeses`

Rows: date · concept (+ counterparty or "Avançada per …" or method) · main budget line path
("i N més") · total · status badge (+ payment state for recognised expenses).

| Status | Badge |
|---|---|
| PROPOSED | Proposta (does not count in the round figures) |
| RECOGNISED | Reconeguda — Pagada / Pagada en part / Sense pagament vinculat |
| REJECTED | Rebutjada |
| VOID | Anul·lada |

Filters (server side, in the URL): status chips (`estat`), budget line (`linia`; a heading selects every
line below it), counterparty (`tercer`), date from/to (`des`, `fins`). Expenses of the OPEN round.
**Nova despesa** with `finance.expense.manage`.

## 2. Detail — `#/tresoreria/despeses/<id>`

Header: concept, status, counterparty / advanced by. Facts: total, date, method, payment state.
Sections: budget lines (code, full path, amount; a warning if they do not add up), payments and refunds
(movement date, position, signed amount, link to the movement, allocated amount), evidence
(**"Sense justificant adjunt"**; no upload control in this phase), history (created, recognised,
rejected, voided, revisions with the previous concept, total and date).

**Reconeix la despesa** (PROPOSED + expense.manage) → confirmation ("comptaran com a despesa de la ronda,
una sola vegada") → toast "Despesa reconeguda". Self-approval is refused by the server and shown as
"No pots aprovar una despesa avançada per tu mateix."

## 3. Nova despesa (drawer)

Two entry points, one form:

- **Manual** (Despeses → Nova despesa): concept, date, total, how it was paid (Banc, Targeta, Efectiu,
  Avançada per una persona → choose the person), counterparty, line split, "Reconeix-la ara" (not for
  advanced money, which is recognised by someone else after review). Without it the expense stays a
  proposal and does not count.
- **From a movement** (Classifica → És una despesa): date defaults to the movement's; total defaults to
  the pending amount and cannot exceed it; the method is the position's. The server creates one
  recognised expense and its settlement by the movement in one atomic step
  (`POST /movements/:id/expense`); the expense counts once.

Line split: rows of (budget line, amount) with **Total / Distribuït / Pendent** always visible.
Confirmation is blocked until it balances ("Falten X € per repartir." / "Has repartit X € de més.").
"Assigna el pendent a l’última línia" fills the remainder.

Budget line picker: hierarchical tree of the round's active lines of the right nature (EXPENSE for
expenses, INCOME for income); headings are shown for orientation and only leaves are selectable; search
by code or name keeps the ancestors. It reads `GET /rounds/:id/assignable-lines` (names and codes only,
no amounts), so people who record expenses do not need to read the budget.

Counterparty: choose an existing one or create a minimal one (Entitat/Persona + name). No IBAN, no contact
data, no CRM. In SYNTHETIC\_ONLY the name must include "(fictici)".

Errors: per field, plus a footer message; server codes map to copy (`invalid_expense_line`: "Una línia de
pressupost no és vàlida…", `expense_lines_total_mismatch`, `allocation_exceeds_movement`, `stale_*`, 403).

## 4. Not in this phase

Evidence upload, reimbursements, card statements, budget execution, rejection/void screens, expense
editing UI (the API revision keeps history and is covered by tests).

## 5. Responsive

≤1179px hides the line column; ≤767px cards; the drawer becomes a full-screen sheet with the primary
action at the bottom.
