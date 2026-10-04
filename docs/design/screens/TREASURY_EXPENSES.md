# Gestió — Tresoreria · Despeses

Status: IMPLEMENTED — pending Borja/Atlas functional and visual review
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5G.2A–G.2C functional extension
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
(**"Sense justificant adjunt"** until one is uploaded; private view/download controls), history (created, recognised,
rejected, voided; previous values and superseded receipts live in a secondary history disclosure).

**Reconeix la despesa** (PROPOSED + evidence + expense.manage) → confirmation ("comptaran com a
despesa de la ronda, una sola vegada") → toast "Despesa reconeguda". Own-beneficiary
recognition also requires the explicit non-delegable `finance.reimbursement.self_approve`.

## 3. Nova despesa (drawer)

Two entry points, one form:

- **Manual** (Despeses → Nova despesa): concept, date, total, "Qui ho ha pagat?" (el grup via
  compte/targeta de dèbit = BANK; or a scouter personally = ADVANCED → choose a PERSON),
  counterparty, line split, private receipt and "Reconeix". Without recognition the expense
  stays a proposal and does not count. ADVANCED recognition creates and approves the liability.
- **From a movement** (Classifica → És una despesa): date defaults to the movement's; total defaults to
  the pending amount and cannot exceed it; the method is the position's. The server creates one
  recognised expense and its settlement by the movement in one controlled step with receipt
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

## 4. G.2B reimbursement extension and deferrals

The list filters by group-paid, reimbursements and outstanding reimbursements. Each advanced
expense shows beneficiary and derived outstanding amount; the list groups outstanding debts by
person. Multiple receipts can be uploaded to a proposal or recognised expense, viewed privately or downloaded. The actual bank
transfer happens outside Gestió and is reconciled in Moviments.

Card statements, cash workflow and budget execution remain deferred. The generic CARD/CASH foundation stays in the schema.

## 5. G.2C corrections

- **Edita** on a PROPOSED expense edits the current draft with optimistic versioning; no formal revision row is created.
- **Corregeix despesa** on a RECOGNISED expense requires a short reason. The old state is retained in `finance_expense_revision`; ordinary content shows only current values.
- **Anul·la despesa** requires a reason and confirmation. VOID expenses leave the default list and round economics; the Anul·lades filter and history retain them.
- An unpaid ADVANCED liability follows a corrected amount or beneficiary. A BANK-paid correction closes the unpaid liability. An active reimbursement settlement must be corrected first.
- **Substitueix justificant** uploads the replacement privately before D1 marks the old receipt superseded. Old receipts remain accessible through the authorised history disclosure.
- The service and D1 guards enforce these rules; UI visibility is advisory.

## 6. Responsive

≤1179px hides the line column; ≤767px cards; the drawer becomes a full-screen sheet with the primary
action at the bottom.
