# Gestió — Tresoreria

Status: APPROVED IN CONCEPT — v0.2, contradictions C1–C5 resolved (Borja/Atlas, 3.5G.0-C); pending final documentation commit
Version: 0.2
Project: Grup Scout Parpalló — Gestió
Phase: 3.5G (specification step 3.5G.0-C)
Baseline: branch `phase/3.5g-treasury`, created from `c5c20cd` (`phase/3.5f-registrations`, 3.5F pending review)
Inputs: audit 3.5G.0-A, domain analysis 3.5G.0-B, final decisions of Borja/Atlas (3.5G.0-C)
Depends on:

- ../AUTHORIZATION\_MODEL.md, ../adr/ADR-007, ../adr/ADR-010 (permission catalogue, scopes)
- ../PHASE\_3B\_REPORT.md (annual fees), screens/REGISTRATIONS.md (3.5F payments, §14–§15)
- ../BACKUP\_POLICY\_DRAFT.md, ../DISASTER\_RECOVERY.md
- DESIGN\_VISION.md, DESIGN\_SYSTEM.md, UX\_RULES.md, screens/SHELL.md, screens/DASHBOARD.md (UI only)

This is a **domain and functional specification**. Unlike the screen specifications it
does define financial rules, data invariants and authorisation for 3.5G. Visual design
follows the design system; no artistic redesign belongs to 3.5G (reserved for 3.5J).

Notation used in this document:

- **[D]** decision approved by Borja/Atlas (or already implemented and kept).
- **[S]** specification choice made here to make the decisions implementable. Reviewable,
  but binding for implementation once this document is approved.
- **LEGAL DECISION REQUIRED** — cannot be closed technically.
- **PENDING TREASURY INPUT** — needs Tresoreria to explain current practice (DEV only).
- Entity and field names are conceptual. Final table/column names are chosen in the
  implementing batch, keeping the semantics and invariants written here.
- All amounts are integer cents (EUR). "≤" between amounts always compares cents.

---

# 1. Scope and objectives

Tresoreria is a module of Gestió **[D]**, not a separate application. Gestió becomes the
source of truth for the group's economy; Excel becomes a generated output **[D]**.

3.5G v1 must cover **[D]**:

- economic rounds and their configuration;
- financial positions (bank account, credit card, cash) and their movements;
- bank import;
- allocation (imputació) of every movement;
- income and expenses as economic facts;
- Quotes (annual fees), their generation and the sibling policy;
- integration of 3.5F activity payments;
- payment plans with N instalments;
- expense evidence (tickets) in private R2;
- reimbursements to scouters;
- budget with a versioned catalogue, approval and revisions;
- budget vs actual;
- round result and reserves;
- Excel exports.

Objectives, in priority order: integrity (every euro traceable, nothing counted twice),
privacy (purpose-limited access, minimal audit), correctness of the round result, then
operational convenience.

# 2. Non-goals

Out of v1 **[D]**: generic ERP; full commercial accounting; mandatory double-entry
bookkeeping; electronic invoicing; bank API connection; payment gateway or online payments;
mandatory OCR; AI classification; product inventory/stock; advanced financial automation;
migration of the ~680 historical 2025/26 movements (2025/26 stays as Excel reference);
merging `annual_fee_evidence` and `payment_evidence`; unifying notification systems;
earmarked reserve sub-funds. DEV semantics are not implemented (§37).

# 3. Terminology

| Term (UI, Valencian) | Meaning |
|---|---|
| Ronda | Economic round (October–September by default). The economic unit of time. |
| Posició financera | Where money is: bank account, credit card (debt), cash box. Group level, not per round. |
| Moviment | A financial fact in one position: bank line, card purchase/refund, cash entry/exit. |
| Lot d'importació | One imported bank file. |
| Imputació | The part of a movement assigned to one typed destination. |
| Obligació | Something a family owes: an annual fee obligation (3B) or an activity registration amount (3.5F). |
| Pagament | A payment towards obligations: `annual_fee_payment` (3B) or a verified activity allocation (3.5F). |
| Assignació | Application of a payment to an obligation (existing 3B/3.5F tables). |
| Despesa | Economic fact of spending. *Proposada* (submitted, not counted) or *reconeguda* (counted). |
| Reemborsament | Group debt to a person who advanced money for a recognised expense. |
| Partida | Budget line of the round catalogue. |
| Pressupost inicial / vigent | Approved budget / approved budget plus approved revisions. |
| Verificat / Conciliat | Payment checked by a person / payment linked to a bank movement (§22). |
| Reserves | General accumulated own funds of the group (one general reserve in v1). |
| Contrapart | Minimal economic counterparty: a person (e.g. reimbursement recipient) or an organisation (e.g. supplier). Not a CRM. |
| Tancament oficial / ajust posterior | Immutable close snapshot of a round / later economic effect recorded apart (§5.4). |
| Declaració de preu | What a family declares about the sibling discount in the portal: untrusted input (§21.1). |

# 4. Principles and critical invariants

Principles **[D]**:

- P1 MOVEMENT ≠ ALLOCATION ≠ OBLIGATION ≠ PAYMENT ≠ ASSIGNMENT.
- P2 A movement can be split into several allocations; an obligation can be covered by
  several payments; a payment can cover several obligations where the domain allows it.
- P3 Movement date ≠ economic round. A movement belongs to a position, a date and an origin;
  the round comes from the economic destinations of its allocations.
- P4 Bank sign ≠ economic meaning.
- P5 Raw financial facts are kept gross; presentation may net where correct (supplier
  refunds reduce the expense of their line); economic activities (lottery, clothing) show
  income, cost and margin separately.
- P6 No silent recalculation or overwrite of economic history; every correction is traceable.
- P7 No destructive DELETE of financial history.
- P8 Existing 3B and 3.5F models are not merged; Tresoreria is a layer above them.
- P9 Private R2 for files; structure lives in D1; files never organise the domain.
- P10 Authorisation is server-side with permissions and scopes; roles are maxima only.
- P11 Synthetic-only data during development; real data only at the production gate.

Critical invariants (each must be enforced in D1 where SQLite allows it — constraint,
trigger or guarded view — and always in the service; tests cover each one):

| # | Invariant |
|---|---|
| I1 | Amounts are integer cents within explicit bounds. |
| I2 | AMOUNT DUE ≠ AMOUNT RECEIVED ≠ AMOUNT ALLOCATED. An obligation is never over-allocated (Σ allocations ≤ amount due; existing 3B/3.5F guards kept). The amount due never depends on the money received: money received above what is due is kept as a separate overpayment (§21.4), never as income and never by raising the amount due. |
| I3 | Σ allocations of a movement ≤ absolute movement amount; the unallocated remainder is derivable. |
| I4 | A file or movement is never imported twice (§8). |
| I5 | Imported movements are immutable; a duplicate is marked void, never deleted. |
| I6 | A card settlement allocation never targets a budget line or expense and never exceeds the open amount of its card statement. |
| I7 | A cash withdrawal or re-deposit is an internal transfer pair, never an expense. |
| I8 | Every cash outflow is linked to a recognised expense or an internal transfer; cash balance never negative. |
| I9 | A reimbursement settlement never targets a budget line; Σ settlements ≤ approved amount; one active reimbursement per expense. |
| I10 | A recognised expense counts exactly once in the result, whatever the payment method. |
| I11 | Proposed ≠ recognised. Only a `RECOGNISED` expense counts in the result. A proposed expense (`PROPOSED` / reimbursement `PENDING_REVIEW`) never counts; approval recognises it once; paying or reconciling its reimbursement changes the financial position only and never creates another expense (§10.2). |
| I12 | Σ expense lines = expense total; Σ settlements ≤ expense total. |
| I13 | Fee and activity price snapshots are never recalculated automatically. |
| I14 | Σ instalments = current amount of the obligation; one active plan per obligation. |
| I15 | The approved initial budget is frozen; current = initial + approved revisions. |
| I16 | A budget line in use is never deleted (deactivation only). |
| I17 | States and balances are derived, not stored as primary truth. |
| I18 | Every allocation and assignment is traceable to its origin and actor. |
| I19 | Every correction leaves a revision or a reversal. |
| I20 | Nobody approves their own reimbursement: when the recipient counterparty is linked to a user identity, that user is never the approver (checked server-side). A counterparty without a user can be reimbursed and gains no access to Gestió (§10.3). |
| I21 | Reserves are never ordinary income; a late collection of a closed round is never ordinary income of another round (§5.4). |
| I22 | The official close snapshot of a round is immutable; every later economic effect on a closed round is a separate post-close adjustment (§5.4). |
| I23 | R2 objects are private with opaque keys; access only through authenticated, audited endpoints. |
| I24 | The audit log never contains bank descriptions, names, phones, e-mails, ticket contents or IBAN. |
| I25 | A family's pricing claim is untrusted input; the portal never reads or reveals family-unit data; only the authoritative snapshot computed by Gestió sets the amount owed (§21.1). |
| I26 | A role alone never grants effective financial authority; financial delegations are explicit, capability-limited, scoped where relevant, expiring, revocable and audited (§25.3). |
| I27 | Counterparties store no IBAN or bank data and are not a supplier CRM (§10.3). |
| I28 | At most one `FinancialRound` is `OPEN`; at most one other may be `CLOSING`; economic periods never overlap. No rule ever chooses a round as "the most recent" (§5.1, §5.4). |
| I29 | No activity payment is allocated on the basis of an untrusted pricing claim: allocation happens only after the authoritative pricing snapshot (§21.1). |
| I30 | OBLIGATION STATE ≠ PAYMENT / TREASURY ISSUE STATE. An obligation fully covered by valid allocations stays `PAID` even with an overpayment, an unallocated verified balance or a separate financial issue that does not affect the validity of its own allocations (§17.1). |

# 5. Round model

## 5.1 Round

`FinancialRound` **[D]**: code `AAAA/AAAA`, period start and end (default 1 October –
30 September), state `OPEN` → `CLOSING` → `CLOSED` **[S]**. One round per code; periods do not
overlap **[D]**. At most **one** round is `OPEN` for ordinary economic operation; another round may
be `CLOSING` at the same time when the closing workflow needs it, but never two `OPEN` rounds
(I28) **[D]**. Opening a round while another is `OPEN` is refused (409). The round owns its configuration, pricing policy, family units, budget catalogue,
budget, obligations, opening balances and result. Positions and movements do **not** belong
to a round **[D]**.

Link with 3B **[S]**: each `annual_fee_round` is linked 1:1 to its `FinancialRound`
(additive link; `annual_fee_round` keeps its contract — base amount, deadline, account holder,
IBAN, concept template, one open fee round).

## 5.2 Economic round of each amount **[D]**

| Economic fact | Round |
|---|---|
| Income linked to an obligation (fee, activity) | Round of the obligation, whatever the movement date. Example: a 2025/26 fee collected on 02/10/2026 is 2025/26 income; the movement stays dated 02/10/2026. If that round is already closed, it is a post-close adjustment (§5.4). |
| Activity income | Round of the activity: the round whose period contains the activity start date **[S]**. |
| Generic income (lottery, clothing, grants…) | Explicit round, given by its budget line. |
| Expense | Explicit round on the expense. Proposed from the expense date, the related activity and the context; correctable explicitly and audited. Never simply the bank movement date. |

One movement may carry allocations to several rounds **[D]**.

## 5.3 Round initialisation (first round 2026/27) **[D]**

2026/27 is the first round fully managed in Gestió. Initialisation, in order:
positions → opening balances (authorised initialisation operation) → initial general reserve
(authorised initialisation operation) → budget catalogue → budget (proposal and approval) →
round configuration and pricing policy → family units → obligations (§18). No retrospective
migration of 2025/26.

## 5.4 Round closing and post-close adjustments

Closing workflow **[S]**: `OPEN → CLOSING` blocks nothing but starts the closing checklist
(unallocated movements, open overpayments, unreconciled card statements, cash balance ≠ 0, proposed expenses,
approved but unpaid reimbursements, verified-unreconciled payments, open pricing reviews, open
issues). `CLOSING → CLOSED` requires an authorised actor (§25) and writes the
**official close snapshot**. Warnings may be accepted explicitly (recorded).

Three distinct figures exist for every closed round **[D]**:

| Figure | Content | Mutability |
|---|---|---|
| `official_close_snapshot` | Income, expenses, result, reserve application/contribution, final reserves, financial position at period end, as at closing | **Immutable** |
| `post_close_adjustments` | Each later economic effect that belongs to the closed round | Append-only (corrected by reversal) |
| Effective / cumulative figures | Official snapshot + Σ post-close adjustments | Derived |

Rules **[D]**:

- An economic fact that belongs to a closed round after its closing — a late collection of
  one of its obligations, a supplier refund of one of its expenses, an approval of one of its
  proposed expenses, a correction of one of its allocations or expenses — is recorded as a
  `PostCloseAdjustment` of that round. The official snapshot is never rewritten.
- The movement keeps its own date. Example: bank +100 € on 02/10/2027 allocated to a 2026/27
  fee obligation → the movement is dated 02/10/2027 (part of the 2027/28 period's financial
  position); the income belongs economically to 2026/27; it is shown in 2026/27 as a post-close
  adjustment, separate from the official close.
- The carry effect ("ajust de rondes tancades") is a reserve adjustment, never ordinary income
  or expense of another round (I21) **[D]**:
  - **A)** if a round is `OPEN`, the carry is reflected in that round;
  - **B)** if no round is `OPEN`, the adjustment stays recorded against the closed round with its
    carry **pending**, and the pending carries are applied when the next round opens (recorded
    in it at opening).
  No round is ever chosen as "the most recent" (I28).
- Effective reserves and the bridge of financial positions include the adjustment; the official
  close of the closed round does not.
- A `PostCloseAdjustment` records: closed round, kind (`LATE_INCOME`, `LATE_EXPENSE`,
  `REFUND`, `CORRECTION`), signed amount, source (allocation, expense, reversal), carry state
  (`CARRIED` with the round that carries it, or `PENDING_CARRY`), actor, time. It requires `finance.round.manage` or is created
  automatically by the operation that causes it, always audited
  (`POST_CLOSE_ADJUSTMENT_RECORDED`).
- A closed round never reopens.

# 6. Financial positions

`FinancialPosition` **[D]**: group level; kind `BANK`, `CARD` (credit card; its balance is a
debt) or `CASH`; display name; state active/archived. Today: one bank account, one credit card,
one cash box; the model allows more of each **[D]**. No full IBAN or card number is stored on
the position (masked last digits at most) **[S]**.

Balances are derived from movements: balance(position, date) = opening reference + Σ movements
up to that date **[S]**. For `CARD`, positive balance = amount owed to the card issuer.

`OpeningBalance` **[D]**: per round and position, the financial position at the round period
start. For 2026/27 it is entered by an authorised initialisation operation; for later rounds it
is derived from movements (the effective position at the period start). A movement dated inside
a closed round's period but recorded after its closing (e.g. a late import) does not change the
official close snapshot: it appears as a post-close difference of that period's position, and
the next opening balance follows the effective position with the difference shown (§5.4).

# 7. Movements

`FinancialMovement`:

| Field | Note |
|---|---|
| position | required |
| operation date, value date | value date optional for manual movements |
| amount | signed cents relative to the position (bank: + in, − out; card: − purchase, + refund; cash: + in, − out) |
| origin | `IMPORT` (batch, row ordinal) or `MANUAL` (actor) |
| bank reference | when the source provides one |
| fingerprint | §8 |
| state | `ACTIVE` or `VOID_DUPLICATE` (with link to the original and actor) |
| auxiliary balance | as imported; never an identifier, only a continuity check |
| protected description | see §27 (not in the general projection) |

Invariants: I3, I4, I5. A movement has no round and no economic meaning by itself. Manual
movements: cash movements; card purchases/refunds when not importable; bank movements only by
an authorised actor when no import exists yet (marked as manual, replaceable by the imported
twin through the duplicate flow).

# 8. Import batches

`ImportBatch`: position, format adapter and version, file SHA-256, row count, created /
duplicate / flagged counts, actor, timestamps, state (`IMPORTED`, `PARTIALLY_FLAGGED`,
`ROLLED_BACK` **[S]**). The original file is kept in private R2 only if the legal decision
allows it (§36, §27); otherwise only its hash and counts.

Importer requirements **[D]**: preserve the original; idempotent; detect duplicates; never rely
on a stable description or its case; operation and value dates; cents; balance only auxiliary;
source position; batch; audit.

Specification **[S]**:

- Format adapters translate a file into canonical rows. v1 ships a **synthetic CSV adapter**
  (documented columns, synthetic marker required, same synthetic-only policy as evidence). The
  real bank adapter is added when the bank export is known, before production.
- Same file hash already imported → rejected (409), nothing written.
- Row fingerprint = position + operation date + value date + amount + bank reference (if any)
  + normalised description digest + ordinal among identical rows of the same file. An
  incoming row whose fingerprint exists → skipped as duplicate. A near match (same position,
  date and amount, different description digest) → imported **flagged** for human review,
  never silently dropped.
- Description normalisation for matching only: Unicode NFKC, case-folded, whitespace collapsed.
- Balance continuity is checked against previous rows; a jump creates a warning on the batch.
- A batch can be rolled back only while none of its movements has allocations; otherwise
  duplicates are voided individually (§24).

# 9. Allocations

`Allocation` explains "this amount of this movement belongs to this destination".

Typed destination **[S]**: an allocation has a `kind` and exactly one typed reference column
filled, enforced by a CHECK per kind. No generic `target_id` string.

| Kind | Destination | Direction | Counts in result as |
|---|---|---|---|
| `FEE_PAYMENT` | `annual_fee_payment` | bank/cash in | — (income is counted from fee assignments, §17) |
| `ACTIVITY_PAYMENT` | `activity_payment_allocation` | in | — (income from activity allocations, §21) |
| `INCOME` | income budget line (+ optional activity, section) | in | income of the line's round |
| `EXPENSE_SETTLEMENT` | recognised expense | out | — (expense counted from the expense) |
| `EXPENSE_REFUND` | recognised expense (or expense line) | in | reduces that expense's line (gross and refund both visible) |
| `REIMBURSEMENT_SETTLEMENT` | reimbursement | bank out | — |
| `INTERNAL_TRANSFER` | the paired movement in another position | opposite signs, equal amounts | — |
| `CARD_SETTLEMENT` | card statement | bank out | — |
| `FAMILY_OVERPAYMENT` | overpayment record (§21.4) | in | — (held money, never income) |
| `FAMILY_REFUND` | reversal of a fee/activity assignment (§24), or an open overpayment (§21.4) | out | reduces income of that obligation's round; refunding an overpayment has no income effect |
| `RESERVED_CREDIT` | reserved, disabled in v1 | — | PENDING TREASURY INPUT (§37) |

Rules:

- Kind/direction/position compatibility is validated (e.g. `CARD_SETTLEMENT` only from a bank
  movement, `INTERNAL_TRANSFER` pairs must be in different positions).
- Economic figures come only from `INCOME`, `EXPENSE_REFUND` and `FAMILY_REFUND` allocations and
  from the obligation/expense entities (fee assignments, activity allocations, recognised
  expenses); settlement and transfer kinds can never touch a budget line (I6, I7, I9).
- Allocations of one movement form an **allocation set** with a version; changing them creates a
  new set revision (§24). `expectedVersion` is required (409 `stale_movement`).
- When the economic destination belongs to a closed round, the allocation is still recorded
  and its economic effect is a post-close adjustment of that round (§5.4).
- Unallocated remainder = absolute amount − Σ current allocations; the "Pendent de classificar" queue
  lists movements with remainder > 0.

The four reference cases:

- **A** +250 € → one `FEE_PAYMENT` of 250 € to a fee payment whose existing 3B assignments are
  100 € (child A) + 100 € (child B) + 50 € (child C).
- **B** −100 € → one expense with lines 60 € Estiu/Cuina and 40 € Tropa/Material, settled by one
  `EXPENSE_SETTLEMENT` of 100 €.
- **C** −150 € card settlement → `CARD_SETTLEMENT` to the card statement whose purchases total
  150 €. No new expense.
- **D** −500 € cash withdrawal → `INTERNAL_TRANSFER` paired with cash +500 €. No expense.

# 10. Expenses

## 10.1 Expense

`Expense` (economic fact) **[D]**:

| Field | Note |
|---|---|
| economic round | explicit (§5.2) |
| expense date | |
| supplier | optional `ORGANIZATION` counterparty (§10.3) or a short commercial label |
| total | cents |
| lines | budget line (leaf, `EXPENSE` nature, same round), amount, optional activity, optional section |
| payment method | `BANK`, `CARD`, `CASH`, `ADVANCED` (paid by a person) |
| advanced by | only for `ADVANCED` — the `PERSON` counterparty who will be reimbursed (§11) |
| evidence | 0..N (§23) |
| state | `PROPOSED`, `RECOGNISED`, `REJECTED`, `VOID` |
| version | optimistic concurrency |

Derived: settled amount (Σ settlements by kind), settlement state (`UNSETTLED`, `PARTIAL`,
`SETTLED`), evidence state (with/without ticket). Invariants I10–I12.

Classifying a bank or card movement as an expense creates the expense and its settlement
allocation in one transaction **[S]**.

## 10.2 Proposed vs recognised (invariant I11) **[D]**

| Path | Step | Result | Financial position |
|---|---|---|---|
| Advanced by a scouter | submitted → `PROPOSED` (reimbursement `PENDING_REVIEW`) | **not counted** | no change |
| | approved → `RECOGNISED` (reimbursement `APPROVED`) | **counted once** | debt to the person opens |
| | paid → reimbursement `PAID` | no new expense | bank decreases, debt decreases |
| | reconciled → reimbursement `RECONCILED` | no new expense | linked to the bank movement |
| | rejected → `REJECTED` | never counted | no change |
| Direct by Tresoreria (bank, card, cash) | recorded with a valid classification (lines on active expense lines of the round, settlement allocation) | `RECOGNISED` directly, counted once | the settling movement |
| Any | voided → `VOID` (reason code, history kept) | removed from the result (post-close adjustment if the round is closed) | unchanged |

`PROPOSED` and `RECOGNISED` are never mixed in any figure: budget vs actual shows proposed
expenses in a separate, uncounted row (§15); the result counts recognised expenses only (§16).

## 10.3 Counterparties **[D]**

`FinancialCounterparty`: id, type `PERSON` or `ORGANIZATION`, display name, optional link to a
user identity, state (`ACTIVE`, `INACTIVE`).

- Stores only what is needed to recognise who was paid or reimbursed. No IBAN, no bank data,
  no contact data, no address; not a supplier CRM (I27).
- A `PERSON` counterparty may be linked to a Gestió user identity; the link is optional.
  Without it, the person can still be reimbursed and gains no access to Gestió.
- An `ORGANIZATION` counterparty can be used for suppliers when useful; otherwise a short label
  on the expense is enough.
- Created and edited with `finance.expense.manage`; listed only to holders of treasury read
  permissions. Never deleted when referenced (deactivation only). Display names are personal
  data for `PERSON` and never enter the audit log (I24).

# 11. Reimbursements

Workflow **[D]**: scouter pays → delivers ticket → Tresoreria reviews → approves → reimburses →
the bank movement settles the debt. The reimbursement is never a second expense.

`Reimbursement` **[S]**:

| Field | Note |
|---|---|
| expense | exactly one; method `ADVANCED` |
| recipient | a `PERSON` counterparty (§10.3), with or without a user identity |
| amount | = expense total unless partially approved |
| state | `PENDING_REVIEW` → `APPROVED` / `REJECTED`; `APPROVED` → `PAID` (derived from settlements) → `RECONCILED` |
| approved by / at | never the recipient's linked user (I20) |

- `PENDING_REVIEW`: the expense is `PROPOSED`; nothing counts.
- `APPROVED`: the expense becomes `RECOGNISED` in the same transaction; the debt to the
  recipient is open. Approvers: Tresoreria, Coordinació general or any user with the explicit
  permission **[D]**. One approval is enough **[D]**.
- Self-approval check **[D]**: if the recipient counterparty is linked to a user identity, the
  server rejects an approval by that user (403, `AUTHZ_DENY` reason `SELF_APPROVAL`). Linking or
  unlinking a counterparty's user identity is audited, and changing the link of a counterparty
  with a pending reimbursement is refused (409), so the check cannot be bypassed by editing the
  link. A recipient without a user identity cannot use Gestió, so cannot approve.
- `PAID`/`RECONCILED`: a bank movement allocated `REIMBURSEMENT_SETTLEMENT`; `PAID` while
  Σ settlements < amount is shown as partially paid; `RECONCILED` when fully settled by bank
  movements. **[S]** If a settlement is recorded before the bank import exists (manual bank
  movement), the state is `PAID`; linking the imported movement makes it `RECONCILED`.
- `REJECTED`: the expense becomes `REJECTED`; nothing counts; the ticket is kept per retention.
- No reimbursing twice: one active reimbursement per expense; Σ settlements ≤ amount (I9).
- No IBAN of the recipient is stored; the transfer is made in the bank.
- Paying or reconciling never creates another expense (I11, §10.2).
- An approval after the round of the expense was closed is a post-close adjustment (§5.4).

Self-submission by scouters inside Gestió is not in v1 **[S]**: Tresoreria (or a financial
delegate) records the proposal with the ticket.

# 12. Credit card

The card is a position whose balance is a debt **[D]**.

- **Purchases**: card movements (−). Classifying a purchase creates a recognised expense with
  method `CARD` and an `EXPENSE_SETTLEMENT` from the card movement.
- **Refunds**: card movements (+) allocated `EXPENSE_REFUND` to the original expense.
- **Fees**: a card fee movement is classified as an expense (line "Comissions" or as defined in
  the catalogue); a bank fee is a bank movement classified the same way.
- **Card statement** (`CardStatement`) **[S]**: period, set of card movements, total (derived).
  The bank settlement movement is allocated `CARD_SETTLEMENT` to it.

Reconciliation of a statement (derived):

| Situation | Rule |
|---|---|
| Exact | Σ settlements = statement total → `SETTLED` |
| Partial | Σ settlements < total → `PARTIAL`, remainder owed |
| Refund inside the period | reduces the statement total |
| Fee | a card movement inside the statement |
| Discrepancy | settlement > open amount → rejected (I6); missing purchases → statement stays open and appears in the queue |

Purchases enter by import when the bank provides card detail, otherwise manually from the
ticket **[S]**. Double counting is impossible by construction: the purchase is the expense
(once), the settlement is a debt payment (never a line).

# 13. Cash (Caixa / Efectiu)

**[D]** Withdrawal = bank → cash internal transfer; expense recognised when cash is spent;
all surplus re-deposited (cash → bank).

- Cash movements are manual. Kinds: in from bank, out to bank, expense payment, cash income
  (e.g. money collected by hand, allocated `INCOME` or to a fee/activity payment), count
  adjustment.
- Withdrawal: bank −500 (imported) ↔ cash +500 (manual), allocated as an `INTERNAL_TRANSFER`
  pair. Re-deposit: cash −70 ↔ bank +70. A side without its twin is shown "en trànsit" until
  paired.
- Expense paid in cash: cash −430 → `EXPENSE_SETTLEMENT` of a recognised expense (method `CASH`).
- Cash balance is derived and never negative (I8). It can reach zero after re-depositing the
  surplus; a non-zero balance is a closing warning.
- Cash count (`arqueig`) **[S]**: optional record of a physical count; a difference requires an
  explicit authorised adjustment movement, never a silent correction.

# 14. Budget

## 14.1 Catalogue

Per round **[D]**, cloned optionally from the previous round keeping `previous_line_id` for
year-to-year comparison **[S]**.

`BudgetLine`:

| Field | Note |
|---|---|
| id | stable within the round |
| code | displayed numbering (e.g. `2.3.5`); data, not hard-coded, revisable |
| name | Valencian |
| parent | hierarchy of N levels (at least three) |
| order | among siblings |
| nature | `INCOME`, `EXPENSE`, `RESERVE_USE`, `RESERVE_CONTRIBUTION` |
| economic activity group | optional, e.g. Loteria, Roba (§15) |
| optional links | activity, section (for reporting and filters) |
| state | `ACTIVE`, `INACTIVE` |
| initial amount | set at approval (leaves only) |
| current amount | derived: initial + approved revisions |

Amounts live on leaves only; parents sum their children **[S]**. Structural changes during the
round (add, rename, move, renumber, deactivate) are revisions with history **[D]**; a line in
use is never deleted (I16).

## 14.2 Approval workflow **[D]**

Tresoreria prepares the budget → Coordinació general approves → initial budget frozen.
Revisions: Tresoreria proposes → Coordinació general approves → `BudgetRevision`.

`BudgetRevision`: line(s), amount delta or new amount, proposed by/at, approved by/at, state
(`PROPOSED`, `APPROVED`, `REJECTED`), optional `external_approval_date` and
`external_approval_reference` (Assemblea or another body when legally required; authority TBD
in the legal phase). No personal explanation is required or stored.

Budget states: `DRAFT` → `PROPOSED` → `APPROVED` → `CLOSED` (with the round) **[S]**.
Reserve use planned in the budget (`RESERVE_USE`) and planned saving (`RESERVE_CONTRIBUTION`)
are lines of their own nature, never income or expense **[D]**.

# 15. Budget vs actual

At every level of the hierarchy **[D]**: initial, current, actual, difference, % executed,
available.

Actual **[S]**:

- Expense lines: Σ recognised expense lines − Σ `EXPENSE_REFUND` on them (gross and refunds
  visible separately).
- Income lines: Σ fee assignments, activity allocations and `INCOME` allocations of the round
  mapped to the line − `FAMILY_REFUND`.
- Fees and activities map to budget lines through configuration: the fee round maps to an
  income line (e.g. 1.1 Quotes); each paid activity maps to an income line (e.g. 2.3 Estiu);
  missing mapping → shown in "Ingressos sense partida" and blocks closing.
- Available = current − actual (expense); pending to collect = current − actual (income).

Also shown: "Pendent de classificar" (unallocated movements, not distributed), proposed
expenses (not counted, separate row), recognised but unsettled expenses (counted, flagged),
pending obligations (not income, shown as "pendent de cobrament"). Overspent lines are warned,
never blocked **[D]**. Economic activity groups show income, cost and margin **[D]**.

# 16. Result and reserves

Statement of a round **[D]**:

```
A  POSICIÓ FINANCERA INICIAL     bank + cash − card debt (opening balances)
B  RESERVES INICIALS             general reserve at start (initialised once, then = final
                                 reserves of the previous round's official close)
B' AJUSTOS DE RONDES TANCADES    Σ post-close adjustments of closed rounds carried in this
                                 round (§5.4) — reserves, never income or expense
   INGRESSOS DE LA RONDA         recognised (collected/verified) income of this round
   DESPESES DE LA RONDA          recognised expenses of this round (net of refunds)
C  RESULTAT ABANS DE RESERVES    income − expenses
D  APLICACIÓ / (APORTACIÓ) DE RESERVES   = −C (deficit uses reserves, surplus adds)
   RESULTAT DESPRÉS DE RESERVES  C + D (normally 0)
   RESERVES FINALS               B + B' + C
E  POSICIÓ FINANCERA FINAL       derived from positions at period end
   Pont: A → E                   income collected in other periods, collections of closed
                                 rounds, unsettled expenses, card debt, cash in transit,
                                 overpayments held for families
```

For a closed round the statement shows three columns: official close, post-close adjustments,
effective (§5.4): official close snapshot + post-close adjustments = effective historical
figures, without reopening the close. While the previous round is still `CLOSING` (the new one
being `OPEN`), B is shown as provisional and amounts of the previous round are ordinary
income/expense of that round (not post-close adjustments).

Example (2025/26 values, illustrative): income 67.096,90; expenses 70.446,99; result
−3.350,09; application of reserves 3.350,09; result after reserves 0.

Rules: reserves ≠ financial balance **[D]**; reserves never appear as income (I21); income =
collected/verified, pending obligations are not income **[D]**; expenses = recognised **[D]**;
economic result is kept separate from cash/position movement **[D]**. v1 has one general
reserve, no earmarked funds **[D]**. 2026/27 initial reserves are set by an authorised
operation; later rounds take them from the previous round's official close, and post-close
adjustments enter as B' **[D]**. The Excel RESULTAT can show "5. Reserves pròpies" as the
labelled application to keep the historical layout (§29).

# 17. Quotes (annual fees)

The 3B model stays (obligation snapshot, explicit family units, payments with matching and
verified amount, N:M assignments with revisions, issues, derived status) **[D]**. 3.5G adds:

- generation flow (§18), pricing policy from the round (§19), N-instalment plans (§20);
- link of fee payments to movements (`FEE_PAYMENT`) and verification vs reconciliation (§22);
- exceptional adjustment through the adjustment permission (§25), keeping original computed
  amount, current amount, actor, date (existing `annual_fee_amount_revision`); the amount due is
  independent of the money received: lowering it below the allocated amount first revises the
  allocations (existing 3B allocation revision) so that the excess becomes the payment's
  unallocated balance (§21.4), never a floor on the amount due;
- late joiner: full fee per round rules, no automatic proration; exceptional adjustment only
  by authorised actors **[D]**;
- partial payment without a plan: accepted, status `PARTIAL`, listed in "Parcials sense pla";
- one transfer for several siblings: one fee payment assigned to several obligations;
- several transfers for one obligation: several payments assigned;
- issues and corrections: existing 3B flows plus §24.

Derived status stays `PENDING`, `PARTIAL`, `PAID`, `ISSUE` **[D]** with the semantics of §17.1;
"overdue instalment" is a separate derived signal (§20). An obligation counts as paid once its payments are verified,
before bank reconciliation **[D]**. Fee income of a round = Σ assignments of verified payments
to that round's obligations (I2 guarantees ≤ due).

## 17.1 Obligation state vs financial issues **[D]**

The obligation state (fees and activity registrations) and the payment/treasury issue state are
two separate dimensions (I30).

| State | Meaning |
|---|---|
| `PENDING` | No valid allocated amount yet |
| `PARTIAL` | Some amount validly allocated, part of the amount due still missing |
| `PAID` | Allocated amount reaches the amount due, never exceeding it |
| `ISSUE` | An issue prevents determining or accepting the state of **this** obligation (e.g. an allocation whose payment is disputed: bank not found, evidence problem, unidentified transfer, or a discrepancy on the obligation itself) |

Overpayments, unallocated verified balances and financial issues that do not affect the validity
of the obligation's own allocations are shown alongside, never instead of the state:

```
Obligació: PAID · Incidències financeres: 1 · Excés pendent: 50,00 €
```

Example: obligations A 100 € and B 100 €, payment received 250 €, allocated A 100 € and B 100 €,
excess 50 € → A `PAID`, B `PAID`, overpayment 50 € `OPEN` pending Tresoreria. The excess never
turns A or B into `ISSUE`.

**LEGACY IMPLEMENTATION GAP (3B).** Today `annual_fee_obligation_status` shows the obligations
funded by a payment as `ISSUE` while that payment has an open issue with no obligation, which
includes `ALLOCATION_UNCLEAR` raised for an unallocated verified balance — even when the
obligations are fully covered. This is not the target semantics. 3.5G.3 (Integrations) aligns
it: keep 3B contracts and data, separate the obligation state from the unallocated balance /
overpayment, keep the audit trail, and replace the affected legacy tests only with tests of the
newly approved semantics (never drop them silently).

# 18. Fee generation

Flow **[D]**: create round → configure rules → build family units → preview → review →
generate. No silent debt creation.

- **Preview** **[S]**: a `FeeGenerationRun` stores its input fingerprint (policy version, base
  amount, family-unit versions, participant set) and the computed rows (participant, unit,
  ordinal, base, discount, amount). It creates no obligation.
- **Generate**: commits the run in one transaction if the fingerprint is unchanged; otherwise
  409 `stale_generation` and a new preview is required. Idempotent: existing obligations
  (one per round and participant) are skipped and reported.
- **Late joiner**: the same computation for one participant (single-row run), audited.
- Participants without a family unit are ordinal 1.

# 19. Sibling pricing policy

`RoundPricingPolicy` **[D]**: per round, versioned, immutable once used. v1 policy:
ordinal 1 = 100 %, ordinal 2 = 100 %, ordinal ≥ 3 = 50 %. Applies to annual fees and to every
paid activity/camp by default.

- The ordinal is the ordinal of the **family unit of the round** (existing
  `annual_fee_family_group`/`member`, which becomes the round's economic family unit) **[D]**.
  It is never recomputed among the siblings attending an activity: if only the third child
  attends, 50 % applies **[D]**.
- 3B evolution **[S]**: the hard-coded CHECKs (`discount_from_ordinal=3`, `discount_percent=50`)
  and the trigger formula are replaced, by an additive migration, with a reference to the
  policy version; existing rounds map to "policy v1" with identical results. Existing
  obligations are not touched (I13). Rounding: discount = floor(base × percent / 100) cents
  (current behaviour kept).
- Exceptions to the policy are explicit, authorised and audited adjustments (§21.2), never a
  free toggle **[D]**.
- Correcting a family unit is itself an explicit, authorised and audited operation. For fees it
  keeps the existing 3B behaviour (obligations of that unit are recomputed in the same
  transaction with revisions, and a `DISCREPANCY` issue opens when assignments exist). For
  activities it never changes prices: it creates "revisar preu" items (§21.1). Nothing is
  recomputed outside that explicit operation (I13).

# 20. Payment plans with N instalments

`PaymentPlan` **[D]**: target obligation (typed: fee obligation or activity registration), state
`ACTIVE` / `SUPERSEDED`, authorised by/at, 1..N `Installment`s (id, order, amount, due date).

- Exceptional; prior authorisation by Tresoreria, Coordinació general or an explicit financial
  delegation (§25) **[D]**; no economic reason stored **[D]**.
- Σ instalments = current amount of the obligation (I14); one active plan per obligation.
- Immutable; a change creates a new plan that supersedes the previous one (history kept).
- Instalment state (derived) **[S]**: verified amounts are applied to instalments in order;
  `PAID`, `PARTIAL`, `PENDING`, `OVERDUE` (due date passed and not fully paid). Overdue is a
  signal for Tresoreria, never a family-facing penalty.
- Partial payment without a plan: accepted, appears in "Parcials sense pla" **[D]**.
- 3B two-part plans: kept readable and presented through the same projection (read
  unification, no data migration) **[S]**. New plans use the N-part model. Amount changes of an
  obligation with an active plan require superseding the plan (current 3B rule kept).

# 21. Activities (3.5F integration)

3.5F tables and contracts stay **[D]**: `activity_registration`, `payment_evidence`,
`activity_payment_allocation`, `activity_payment_balance`, the purpose-limited payment
projection and the global queue. No merge with Quotes.

## 21.1 Sibling pricing at registration **[D]**

The portal is public/write-only: it never reads or reveals the internal family unit (I25).

**Portal.** It shows only the base price (with transport options) and the published policy
("1r i 2n germà: 100 % · 3r i següents: 50 %"). The family may declare that it considers the
discount applicable (**pricing claim**: "és el 3r germà o següent"). The portal may show a
provisional amount computed from the claim when the UX needs it (e.g. to know what to transfer).
The portal never reveals how many siblings are registered, names, the internal ordinal or the
existence of other participants, and its answer is the same neutral answer as today whatever
the claim and the internal reality.

**Flow.** submitted pricing claim (untrusted) → internal matching → validation against the
round's family unit → **authoritative pricing snapshot**.

| Registration at creation | Pricing state |
|---|---|
| Matched (`CLEAR`) | Authoritative snapshot computed at creation |
| Unmatched (`NEEDS_PARTICIPANT_REVIEW`) | `PROVISIONAL` (claim only); authoritative snapshot computed when the match is resolved |

Authoritative snapshot (new pricing record linked 1:1 to the registration **[S]**): base price,
transport adjustment, policy version, family unit used (or none → ordinal 1), family ordinal,
percentage, computed amount, the claim received, time.

- Claim = snapshot → nothing else happens.
- Claim ≠ snapshot (e.g. discount claimed but ordinal < 3, or not claimed but ordinal ≥ 3, or no
  family unit exists) → `PRICING_REVIEW_REQUIRED` for Tresoreria, never revealed to the portal.
  The authoritative snapshot stands; Tresoreria resolves explicitly (build or correct the family
  unit, authorised adjustment §21.2, or confirm), audited.
- `expected_amount_cents` keeps its meaning (current amount due): while `PROVISIONAL` it holds
  the provisional amount; when the snapshot is fixed it **takes the authoritative amount,
  whatever money has been received** (I2). The amount due is independent of the amount received.
- Order **[D]**: submitted claim → matching → family-unit validation → authoritative snapshot →
  **then** payment allocation (I29). While pricing is `PROVISIONAL` the family may send proofs and
  real money may arrive, but no allocation is made (3.5F already allows verification only once
  the registration is matched).
- Allocation is limited to the amount due. Money received above it is kept as a separate
  financial reality — an overpayment (§21.4) — never assigned to the obligation, never income,
  never refunded automatically. Money below it leaves the obligation `PARTIAL`.
- After the authoritative snapshot is fixed nothing recalculates it (I13). A later change of the
  family unit creates a "revisar preu" item only.
- The provisional → authoritative step is the single consolidation of the price, not a
  recalculation.

## 21.2 Adjustments and exceptions

An activity price exception (e.g. a half place) or a correction is an explicit, authorised,
audited adjustment **[D]**: `ActivityAmountRevision` (previous, new, actor, date, no reason
text) **[S]**. The new amount is independent of the money received. If it falls below the
amount already allocated, the allocations above the new amount are reversed in the same
transaction (§24) and that money becomes an overpayment (§21.4); nothing is refunded
automatically. A plan, if any, must be superseded.

## 21.3 Payments, joint transfers, corrections

- Bank-checked payment: an activity allocation with `evidence_id` NULL (already supported) plus
  an `ACTIVITY_PAYMENT` allocation of the movement.
- One transfer for several registrations (siblings): several `ACTIVITY_PAYMENT` allocations of
  the same movement, one per activity allocation.
- Each activity allocation is linked to at most one movement allocation; the link may be added
  later (reconciliation, §22).
- Corrections: reversal entries (negative allocation linked to the original) — 3.5F allocations
  are append-only today and gain this capability (§24).
- Credits/transfers between activities: reserved (§37).
- Income of an activity = Σ its allocations (net of reversals), in the round of the activity
  (§5.2), mapped to its income budget line (§15).

## 21.4 Overpayments (money received above the amount due)

**[D]** AMOUNT DUE ≠ AMOUNT RECEIVED ≠ AMOUNT ALLOCATED.

Example: base price 400 €; the family declares no discount and pays 400 €; after matching the
participant is the 3rd child; authoritative price 200 €. Result: amount due 200 €, money
received 400 €, allocated 200 €, overpayment 200 €. The obligation is **not** 400 €.

`Overpayment` **[S]**: the registration it came from, source (the payment attempt and/or the
movement allocation), amount, state, actor, time. For fees the existing 3B unallocated balance
of the fee payment plays this role (see below); a bank movement exceeding the fee payments it
funds uses `FAMILY_OVERPAYMENT` as well.

- How it arises: at verification, the received amount of an attempt exceeds what can be
  allocated (remaining due); or an authorised adjustment lowers the amount due below the
  allocated amount (§21.2); or a bank movement carries more than the obligations it pays
  (allocation kind `FAMILY_OVERPAYMENT`, §9).
- 3.5F verification therefore records, per attempt, the **amount received** and the **amount
  allocated** (≤ remaining due) separately; the difference is the overpayment. Fees already
  have the equivalent amount (`annual_fee_payment_balance.unallocated_cents`, with an
  `ALLOCATION_UNCLEAR` issue as the treasury-side follow-up).
- It is held money owed to or kept for the family: not income, not part of any obligation,
  visible in the financial position bridge, in the Tresoreria queue "Excessos pendents" and as
  a closing warning.
- States: `OPEN` → `RESOLVED`. v1 resolution: refund to the family (outgoing movement with a
  `FAMILY_REFUND` allocation against the overpayment). Credit for a later obligation and
  authorised reassignment are prepared but not enabled until Tresoreria defines them (§37); no
  DEV semantics is implied.
- An overpayment never changes the obligation state (§17.1, I30): a fully allocated obligation
  stays `PAID` and the overpayment is reported apart, for activities and fees alike. For fees
  this is the target semantics; the current 3B projection is a LEGACY IMPLEMENTATION GAP closed
  in 3.5G.3 (§17.1).

# 22. Verification vs reconciliation

**[D]** A payment can be `VERIFICAT` without being `CONCILIAT`. Verification does not require a
bank movement; it keeps the current Quotes and Inscripcions flows. The obligation counts as paid
once verified.

- Reconciliation = linking the verified payment (fee payment or activity allocation) to a
  movement allocation (`FEE_PAYMENT` / `ACTIVITY_PAYMENT`). Σ linked amounts ≤ verified amount
  and ≤ movement remainder.
- Queue "Verificats sense conciliar" for Tresoreria; reconciling moves the item out.
- A verified payment that cannot be found in the bank becomes an issue (existing
  `BANK_NOT_FOUND` for fees; payment incidence for activities); verified amounts are never
  silently removed.
- Bank-first flow: an unclassified incoming movement can be allocated directly to obligations,
  creating a verified fee payment (source bank, no evidence) or an activity allocation without
  evidence — verified and reconciled in one step.
- Implementation note for 3.5G.3 **[S]**: `annual_fee_payment` currently requires family
  declaration fields (receipt e-mail, submitter, idempotency key, privacy notice) and every
  listing joins `annual_fee_evidence`. A bank-origin fee payment needs an additive
  representation that keeps those contracts for family submissions (no fake declaration data,
  no dummy evidence); the batch designs it.
- Permission: `finance.reconcile` (§25), replacing the reserved `finance.fee.reconcile`.

# 23. Expense evidence and R2

`ExpenseEvidence` **[D]**: expense 1 → N evidence. D1 keeps relation, opaque R2 key, SHA-256,
detected MIME, size, created at, actor, state (`ACTIVE`, `PURGED` with reason).

- Reused from 3.5F: signature-based validation (PDF, PNG, JPEG, WebP), size limit, safe file
  name, synthetic marker in development, opaque keys, authenticated view/download with safe
  headers, audit of view/download, purge-once rule, client-side image optimisation **[D]**.
  The evidence service is shared; the tables are not merged **[D]**.
- Search by round, month, activity, budget line, section, amount, category, supplier through
  D1 metadata joined with expenses — never through R2 prefixes **[D]**.
- Expenses are never deleted; a `VOID` expense keeps its evidence until retention.
- Retention and purge: LEGAL DECISION REQUIRED (§36).

# 24. Corrections and reversals

Approved pattern **[D]**:

| What changes | Pattern |
|---|---|
| Interpretation (allocation set of a movement, expense lines, expense round, budget line structure, budget amounts) | **Revision log**: new version, previous version kept, actor, time |
| Money applied to an obligation (fee assignment, activity allocation), reimbursement settlement | **Reversal**: append-only negative entry linked to the original + new entry if reapplied, sharing a correction id |
| A new real financial fact (refund to a family, supplier credit, returned cash) | **New compensating movement** with its own allocation |

Cases **[S]**:

| Case | Handling |
|---|---|
| Imported duplicate | `VOID_DUPLICATE` with link to the kept movement; allowed only if it has no allocations (otherwise reallocate first) |
| Wrong classification | new allocation-set revision |
| Assignment to the wrong child | fees: existing 3B allocation revision (its revision table already keeps previous and new amounts; kept as the 3B equivalent of a reversal); activities: reversal + new allocation |
| Expense on the wrong line / wrong round | expense revision |
| Wrong expense amount | expense revision; settlements revalidated (Σ ≤ total) |
| Payment applied to the wrong activity | reversal + new allocation on the right registration |
| Refund to a family | outgoing movement + `FAMILY_REFUND` allocation + reversal of the assignment |
| Reimbursement linked to the wrong movement | reversal of the settlement + new settlement |
| Wrong manual cash movement | compensating cash movement (cash movements are immutable too) |
| Any correction whose economic effect belongs to a closed round | the correction as above + a post-close adjustment of that round (§5.4); the official close never changes |

No destructive DELETE of financial history (P7). Every correction is audited.

# 25. Permissions and scopes

Server-side policy as today (ADR-007/ADR-010): effective role **and** explicit grant; GLOBAL
permissions need a group-wide holder; SCOPED permissions declare their scope; the UI reads
capabilities from `/api/me` and never probes with 403s.

## 25.1 Catalogue **[S]** (codes final in 3.5G.1A/1)

| Permission | Kind | Purpose |
|---|---|---|
| `finance.treasury.read` | GLOBAL | Treasury home, positions, balances, result, budget vs actual |
| `finance.position.manage` | GLOBAL | Positions, opening balances, initial reserves, cash count adjustments |
| `finance.movement.read` | GLOBAL | Movements (minimised projection) |
| `finance.movement.import` | GLOBAL | Import batches, rollback |
| `finance.movement.classify` | GLOBAL | Allocations, manual movements, duplicates, internal transfers, card statements |
| `finance.bank_description.reveal` | GLOBAL | Reveal the protected original description (audited, purpose) |
| `finance.reconcile` | GLOBAL | Link verified payments to movements (replaces reserved `finance.fee.reconcile`) |
| `finance.budget.read` | GLOBAL | Budget and catalogue |
| `finance.budget.propose` | GLOBAL | Prepare budget, propose revisions and catalogue changes |
| `finance.budget.approve` | GLOBAL | Approve budget and revisions |
| `finance.expense.read` / `.manage` | GLOBAL | Expenses (record, classify, revise, void) and counterparties |
| `finance.evidence.read` | GLOBAL | View/download expense evidence (audited) |
| `finance.reimbursement.approve` | GLOBAL | Approve/reject reimbursements (never own) |
| `finance.adjustment.authorize` | SCOPED | Exceptional fee amount and activity price adjustments |
| `finance.plan.authorize` | SCOPED | Payment plans (fees and activities; supersedes `finance.fee.installment.authorize`) |
| `finance.fee.generate` | GLOBAL | Fee generation preview/commit |
| `finance.round.manage` | GLOBAL | Round configuration, pricing policy versions, closing, manual post-close adjustments |
| `finance.export` | GLOBAL | Generate exports |
| existing `finance.fee.*`, `finance.payment.verify` | as today | kept |

## 25.2 Role maxima **[D]** rules / **[S]** matrix

| Capability | Tresoreria | Coord. general | Coord. secció | Secretaria | Delegació financera | TECH_ADMIN |
|---|---|---|---|---|---|---|
| Treasury home, positions, result | ✓ | ✓ | — | — | G | — |
| Movements read / classify | ✓ | ✓ | — | — | G | — |
| Import | ✓ | G | — | — | G | — |
| Reveal bank description | G | G | — | — | — | — |
| Reconcile | ✓ | ✓ | — | — | G | — |
| Budget read | ✓ | ✓ | — | — | G | — |
| Budget propose | ✓ | ✓ | — | — | — | — |
| Budget approve | — | ✓ | — | — | — | — |
| Quotes full / generate | ✓ | ✓ | — | — | G | — |
| Basic fee status (scoped) | ✓ | ✓ | ✓·S | — | G·S | — |
| Exceptional adjustments | ✓ | ✓ | — | — | G | — |
| Payment plans | ✓ | ✓ | — | — | G | — |
| Verify payments | ✓ | ✓ | — | — | G·S | — |
| Expenses / evidence | ✓ | ✓ | — | — | G | — |
| Approve reimbursements (not own) | ✓ | ✓ | — | — | G | — |
| Round configuration / closing | ✓ | ✓ | — | — | — | — |
| Export / reports | ✓ | ✓ | — | — | G | — |

✓ = in the role maximum (still needs the explicit grant); G = only through an explicit
financial delegation (§25.3); S = section scope; — = never through this role (the same person
may still act through another role or an explicit financial delegation, §25.3).

Rules **[D]**: Tresoreria broad economic access; Coordinació general broad economic authority
(and approves the budget); Coordinació secció only basic fee status in scope unless granted;
**section delegation never implies financial permissions**; a financial delegation can receive
concrete financial permissions; TECH_ADMIN never receives financial data for being TECH_ADMIN.
Budget proposal and approval are different permissions; Tresoreria does not approve its own
budget **[S]**.

## 25.3 Financial delegation **[D]**

Required security outcome:

- A financial delegation is **explicit**, limited to **concrete capabilities** (one or more
  permissions of §25.1 marked delegable), **scoped** where the permission is SCOPED, with an
  **expiry**, **revocable**, and **audited** (grant, revocation, expiry, use).
- **A role alone never grants effective financial authority (I26).** Holding a role — including
  any future `FINANCE_DELEGATE` role used as eligibility or permission ceiling — does not give
  financial powers; only a current delegation of a concrete capability does.
- `SECTION_DELEGATE` never carries financial permissions; its current `finance.payment.verify`
  and `finance.fee.payment.review` are removed from its maximum (3.5G.1A). Existing grants are
  revoked or converted into explicit financial delegations, audited.
- Delegable financial capabilities **[S]**: verification and fee payment review, reconciliation,
  movement read/classify/import, expenses and evidence, reimbursement approval (never own),
  payment plans, exceptional adjustments, budget read, exports. Not delegable: budget approval,
  round configuration and closing, bank description reveal, position/opening balance/reserve
  initialisation.
- The section-coordinator basic fee status stays role-based (approved scope).

**G.1A AUTHORIZATION DESIGN TASK.** Today the engine computes effective scopes from
`user_role ⨝ role_permission ⨝ user_permission_grant` and from `delegated_permission`, which also
requires a role whose maximum contains the permission. 3.5G.1A designs the minimal change that
delivers the outcome above (e.g. a ceiling that is eligibility only, plus a capability-limited,
expiring delegation record), including any rebuild implied by the role-code CHECK of migration
0001. This document fixes the outcome, not the SQL.

**Resolved in 3.5G.1A (migration 0022).** No new role and no rebuild of `role`. Permissions marked
`financialDelegation` in `gestio/src/permissions.js` (today `finance.payment.verify`,
`finance.fee.payment.review`, `finance.fee.contact.read`) are effective for a user through either
(a) a role that contains them plus an individual grant (Tresoreria, Coordinació general), or (b) a
ratified, expiring, capability-limited `delegated_permission`, evaluated **without** any role ceiling.
An undated delegation is never effective. The named authoriser must hold the same capability (role +
grant) over the delegated scope. `SECTION_DELEGATE` no longer carries any financial permission, and
grants it can no longer support were revoked. Later treasury permissions join the same mechanism by
being marked `financialDelegation`.

# 26. Audit

Audit events contain identifiers, action, actor, session, result and reason code only **[D]**.
Never: bank descriptions, names, phones, e-mails, ticket contents, IBAN or free text. Previous
and new values live in revision tables, not in the audit log.

| Area | Events |
|---|---|
| Round | `TREASURY_ROUND_CREATED`, `TREASURY_ROUND_CLOSING_STARTED`, `TREASURY_ROUND_CLOSED`, `PRICING_POLICY_VERSIONED`, `OPENING_BALANCE_INITIALISED`, `RESERVES_INITIALISED`, `POST_CLOSE_ADJUSTMENT_RECORDED`, `RESERVE_CARRY_ADJUSTMENT` |
| Budget | `BUDGET_CREATED`, `BUDGET_PROPOSED`, `BUDGET_APPROVED`, `BUDGET_LINE_CREATED`, `BUDGET_LINE_REVISED`, `BUDGET_LINE_DEACTIVATED`, `BUDGET_REVISION_PROPOSED`, `BUDGET_REVISION_APPROVED`, `BUDGET_REVISION_REJECTED` |
| Movements | `BANK_IMPORT_CREATED`, `BANK_IMPORT_ROLLED_BACK`, `MOVEMENT_IMPORTED` (one summary per batch with counts), `MOVEMENT_CREATED_MANUAL`, `MOVEMENT_VOIDED_DUPLICATE`, `MOVEMENT_CLASSIFIED`, `MOVEMENT_RECLASSIFIED`, `BANK_DESCRIPTION_REVEALED` |
| Card / cash | `CARD_STATEMENT_CREATED`, `CARD_STATEMENT_RECONCILED`, `CASH_TRANSFER_PAIRED`, `CASH_COUNT_RECORDED` |
| Expenses | `EXPENSE_PROPOSED`, `EXPENSE_RECOGNISED`, `EXPENSE_REVISED`, `EXPENSE_REJECTED`, `EXPENSE_VOIDED`, `EVIDENCE_UPLOADED`, `EVIDENCE_VIEWED`, `EVIDENCE_DOWNLOADED`, `EVIDENCE_PURGED` |
| Reimbursements | `REIMBURSEMENT_REQUESTED`, `REIMBURSEMENT_APPROVED`, `REIMBURSEMENT_REJECTED`, `REIMBURSEMENT_PAID`, `REIMBURSEMENT_RECONCILED`, `REIMBURSEMENT_REVERSED`, `AUTHZ_DENY` with reason `SELF_APPROVAL` |
| Quotes | `FEE_GENERATION_PREVIEWED`, `FEE_OBLIGATIONS_GENERATED`, `FEE_AMOUNT_ADJUSTED`, `FEE_EVIDENCE_VIEWED`, `FEE_EVIDENCE_DOWNLOADED`, `FEE_CONTACT_REVEALED` (existing FEE_* kept) |
| Payments | `INSTALLMENT_PLAN_AUTHORIZED`, `INSTALLMENT_PLAN_SUPERSEDED`, `PAYMENT_VERIFIED`, `PAYMENT_ALLOCATED`, `PAYMENT_RECONCILED`, `PAYMENT_REVERSED`, `FAMILY_REFUND_RECORDED`, `ACTIVITY_PRICE_COMPUTED`, `ACTIVITY_PRICE_ADJUSTED` |
| Counterparties | `COUNTERPARTY_CREATED`, `COUNTERPARTY_REVISED`, `COUNTERPARTY_USER_LINKED`, `COUNTERPARTY_USER_UNLINKED`, `COUNTERPARTY_DEACTIVATED` |
| Overpayments | `OVERPAYMENT_RECORDED`, `OVERPAYMENT_RESOLVED` |
| Activity pricing | `PRICING_CLAIM_RECEIVED`, `PRICING_SNAPSHOT_FIXED`, `PRICING_REVIEW_REQUIRED`, `PRICING_REVIEW_RESOLVED` (claims recorded as a code, never as free text) |
| Financial delegation | `FINANCIAL_DELEGATION_GRANTED`, `FINANCIAL_DELEGATION_REVOKED`, `FINANCIAL_DELEGATION_EXPIRED` (use is attributed through the normal events of each operation) |
| Export | `EXPORT_GENERATED` |

Every denial keeps the existing `AUTHZ_DENY` behaviour (403 for missing capability, same 404
for missing and out-of-scope, then 409 for state/version).

# 27. Privacy

## 27.1 Debt of 3B (mandatory in 3.5G.1A) **[D]**

- `feePaymentDetail` stops returning `SELECT *`: an explicit field list without phone, e-mail,
  idempotency key or payload hash.
- `listFeePayments` stops returning the receipt e-mail.
- Contact (submitter name, phone, e-mail) only on demand, by purpose, with an explicit
  permission and audit (`FEE_CONTACT_REVEALED`), coherent with 3.5F
  `activities.registration.contact.read`.
- Fee evidence view/download audited (`FEE_EVIDENCE_VIEWED/DOWNLOADED`) with the same safe
  serving as 3.5F (detected MIME, view/download modes).
- Retention defined later (§36).

## 27.2 Bank descriptions — LEGAL DECISION REQUIRED

Bank descriptions contain payer names and sometimes minors' names. Preferred technical
candidate (not a final decision): **protected original + minimised projection for the UI +
later minimisation/purge according to the legal policy**.

- The original description is stored apart from the movement (protected store), readable only
  through `finance.bank_description.reveal`, with purpose and audit.
- The general projection shows a minimised label (movement type, counterparty reduced to a
  commercial name or initials, no minors' names) derived at import.
- After reconciliation + a legally defined period the original is minimised or purged; the
  fingerprint and the minimised label remain.

Alternatives kept for the legal phase: full original with very restricted access; minimisation
right after reconciliation. Implementation must keep the original behind one access point so
any of them can be applied without changing the domain.

## 27.3 Other rules

Counterparties (§10.3): minimum identification only (type, display name, optional user link);
no IBAN, bank data, contact data or address; `PERSON` display names are personal data, shown
only to treasury permission holders and never written to the audit log. A counterparty without
a user identity gains no access to Gestió.
The portal pricing claim (§21.1) is a closed code; the portal never receives family-unit data.
Exports containing personal data (Quotes) are generated on demand and not stored (§29).
No IBAN of families or scouters is stored by Tresoreria.

# 28. Backup and recovery

D1 **[D]**: all new tables, revision tables, views, triggers and indexes are added to
`scripts/recovery.js` (`TABLES`, `REQUIRED_OBJECTS`) with invariant checks: allocation sums
≤ movement, balanced internal pairs, reimbursement settlements ≤ approved, instalments = obligation,
non-negative cash, no orphan allocation targets, single active plan, budget current = initial +
approved revisions.

R2 **[S]** (today not backed up):

- an object manifest (key, SHA-256, size, owning table and id) generated with every D1 backup;
- object copy to a separate private backup location;
- verification: missing object (metadata without object), orphan object (object without
  metadata), hash mismatch, non-synthetic keys in development;
- restore order: D1 → R2 → cross-verification; any mismatch is reported, never auto-repaired;
- periodic drills with synthetic data, documented in `DISASTER_RECOVERY.md`.

# 29. Excel and exports

Principle **[D]**: GESTIÓ CALCULA, EXCEL REPRESENTA.

Layers **[S]**:

1. **Report model**: pure computed structures from the domain (budget tree with figures,
   round result, ledger of income/expenses, Quotes list, per-activity statement).
2. **Template mapping**, versioned per output: sheet names, Valencian titles, numbering from
   line codes, column order, number formats, print setup, Ingressos | Despeses layout.
3. **Writer**: produces `.xlsx` with values and totals; optional SUM formulas only for user
   convenience, never as the source of figures; no dependence on fixed column letters.
   The xlsx library/dependency is chosen and approved in 3.5G.4 (CSP and supply-chain review).

v1 outputs **[D]**: PRESSUPOST, RESULTAT, Quotes, Ingressos i Despeses (movements ledger by
line), per-camp statements as filtered views if still needed. Not reproduced: recomputing
formulas, manual duplication, historical errors.

`ExportRecord` **[S]**: type, round, parameters, template version, data hash, actor, time. The
file is regenerated on demand and not stored. `EXPORT_GENERATED` audited.

# 30. States and state machines

| Entity | States | Notes |
|---|---|---|
| FinancialRound | `OPEN` → `CLOSING` → `CLOSED` | at most one `OPEN` and one other `CLOSING` (I28); `CLOSING → OPEN` allowed (audited) only if no other round is `OPEN`; `CLOSED` is terminal |
| Official close snapshot | written once at `CLOSED` | immutable |
| PostCloseAdjustment | recorded (append-only); carry `PENDING_CARRY` → `CARRIED` | carried in the `OPEN` round, or pending until the next round opens; corrected only by a reversing adjustment |
| Budget | `DRAFT` → `PROPOSED` → `APPROVED` → `CLOSED`; `PROPOSED` → `DRAFT` on rejection | |
| BudgetRevision | `PROPOSED` → `APPROVED` / `REJECTED` | |
| ImportBatch | `IMPORTED`, `PARTIALLY_FLAGGED`, `ROLLED_BACK` | rollback only without allocations |
| FinancialMovement | `ACTIVE` → `VOID_DUPLICATE` | allocation state derived: unallocated / partial / allocated |
| Expense | `PROPOSED` → `RECOGNISED` / `REJECTED`; `RECOGNISED` → `VOID` | settlement state derived |
| Reimbursement | `PENDING_REVIEW` → `APPROVED` / `REJECTED`; `APPROVED` → `PAID` → `RECONCILED` | PAID/RECONCILED derived from settlements |
| CardStatement | derived `OPEN` / `PARTIAL` / `SETTLED` | |
| PaymentPlan | `ACTIVE` → `SUPERSEDED` | instalment states derived |
| Fee obligation / activity payment | derived `PENDING` / `PARTIAL` / `PAID` / `ISSUE` | semantics §17.1; overpayments and unrelated financial issues are a separate dimension (I30); 3B legacy gap closed in 3.5G.3 |
| Payment reconciliation | derived `VERIFICAT_SENSE_CONCILIAR` / `CONCILIAT` | |
| FeeGenerationRun | `PREVIEW` → `COMMITTED` / `STALE` | |
| Activity pricing | `PROVISIONAL` (claim only) → `AUTHORITATIVE`; review flag `PRICING_REVIEW_REQUIRED` → `RESOLVED` | snapshot never recalculated after `AUTHORITATIVE`; no allocation while `PROVISIONAL` |
| Overpayment | `OPEN` → `RESOLVED` (v1: refund; credit/reassignment reserved, §37) | never income; never changes the obligation state (I30; 3B legacy gap §17.1) |
| Counterparty | `ACTIVE` → `INACTIVE` | never deleted when referenced; user link changes audited, refused with a pending reimbursement |
| Financial delegation | `ACTIVE` → `REVOKED` / `EXPIRED` | capability-limited, scoped, audited |

# 31. Functional views (no visual design)

Navigation **[S]**: a `Tresoreria` module for users with any treasury capability; `Quotes`
becomes a section of it (the current `#/quotes` route keeps working). Section coordinators
keep only the basic fee status in their current place. Actionable queues first; no decorative
metrics.

| View | Responsibility |
|---|---|
| Inici Tresoreria | Work queues: pendent de classificar, verificats sense conciliar, excessos pendents, despeses proposades, reemborsaments pendents, extractes de targeta oberts, caixa ≠ 0 / en trànsit, terminis vençuts, parcials sense pla, incidències, partides excedides, despeses sense justificant. Summary: bank balance (last import date), result to date, budget execution. |
| Moviments | Movements by position, filters, allocation editor, internal transfers, duplicates, import batches. |
| Pressupost | Catalogue and budget, proposal/approval, revisions, budget vs actual tree. |
| Quotes | Existing Quotes features, generation preview/commit, plans, adjustments, reconciliation of fee payments. |
| Pagaments d'activitats | Treasury view of 3.5F payments: verification (existing), reconciliation, price adjustments, refunds. |
| Despeses | Expenses list/record, lines, method, round, evidence. |
| Reemborsaments | Proposals, approval (not own), payment and reconciliation. |
| Justificants | Search of expense evidence by round, month, activity, line, section, amount, supplier. |
| Resultat | Round result, reserves, bridge to financial position, closing checklist. |
| Exportacions | Generate PRESSUPOST, RESULTAT, Quotes, Ingressos i Despeses. |
| Configuració de ronda | Round, pricing policy versions, positions, opening balances, initial reserves, income-line mapping of fees and activities. |

# 32. Edge cases

1. Fee of 2026/27 collected on 02/10/2027 after 2026/27 closed → movement dated 02/10/2027;
   income of 2026/27 as a post-close adjustment; official close unchanged; carried into the
   `OPEN` round as a reserve adjustment (or `PENDING_CARRY` if none is open), never as its income.
2. One movement with fee allocations of two rounds → each income in its round.
3. One transfer for three siblings' fees → Case A.
4. One transfer for two siblings' camp registrations → two `ACTIVITY_PAYMENT` allocations.
5. Third child attends a camp alone → 50 % (family-unit ordinal).
6. Registration unmatched at creation → pricing `PROVISIONAL` from the claim; authoritative
   snapshot at match resolution.
7. Sibling withdraws after registration → no recalculation; "revisar preu" item.
8. Price exception after partial payment below paid amount → refused; refund flow instead.
9. Card purchases 30 + 50 + 70, settlement −150 → expenses 150, not 300.
10. Card settlement −160 for a 150 statement → rejected (over open amount); discrepancy queue.
11. Card refund +20 → reduces the original expense line; gross visible.
12. Withdrawal 500, expense 430, re-deposit 70 → expense 430, cash 0.
13. Re-deposit imported before the cash entry is recorded → bank side "en trànsit".
14. Scouter expense rejected → nothing counted; ticket kept per retention.
15. Treasurer's own reimbursement (counterparty linked to the treasurer's user) → the treasurer's
    approval is refused; another holder approves (I20).
16. Reimbursement paid in two transfers → `PAID` partial, then `RECONCILED`.
17. Same bank file imported twice → rejected by hash.
18. Overlapping bank files → duplicate rows skipped by fingerprint, near matches flagged.
19. Duplicate already classified → reallocate, then void.
20. Lottery: sales and purchase both gross; result shows income, cost, margin.
21. Supplier refund in a later round → `EXPENSE_REFUND` follows the expense's round.
22. Budget line deactivated with movements → kept in reports, no new allocations.
23. Overspent line → warning only.
24. Income without budget-line mapping → "Ingressos sense partida", blocks closing.
25. Verified fee payment not found in the bank → issue, verification kept.
26. Plan superseded after one instalment paid → new plan covers the remaining amount.
27. ASDE fee → recognised expense on its expense line (never a family obligation).
28. Opening balance of 2026/27 mistyped → corrected by an authorised revision, audited.
29. Family claims the 3rd-child discount but the family unit gives ordinal 2 → authoritative
    100 %, `PRICING_REVIEW_REQUIRED`, neutral portal answer.
30. Family claims the discount, pays 200 € of a 400 € base, authoritative ordinal 2 → due 400 €,
    allocated 200 €, `PARTIAL`, review required; no refund or debt invented.
31. Family claims no discount and pays 400 €; authoritative ordinal 3 → due 200 €, received
    400 €, allocated 200 €, overpayment 200 € (`OPEN`), registration `PAID`; Tresoreria resolves
    the overpayment later. The amount due is never raised to 400 €.
32. Family claims the discount and no family unit exists → ordinal 1, review required.
33. Reimbursement to a scouter without a Gestió account → `PERSON` counterparty without user;
    reimbursed normally; no access granted.
34. Attempt to relink a counterparty to another user while its reimbursement is pending → 409.
35. A user with only the `SECTION_DELEGATE` role, or only a finance ceiling role without a
    current delegation → no financial capability.
36. Financial delegation expired → the next operation is denied (403), audited.
37. Supplier refund of a closed round's expense → post-close adjustment of that round.
38. Scouter expense of a closed round approved after closing → recognised as a post-close
    adjustment of that round.
39. Proof sent while pricing is `PROVISIONAL` (unmatched) → kept; no allocation until the
    authoritative snapshot exists.
40. Authorised price adjustment from 400 € to 200 € after 400 € allocated → 200 € of allocations
    reversed, 200 € overpayment `OPEN`, nothing refunded automatically.
41. Bank transfer of 450 € for a 400 € registration → `ACTIVITY_PAYMENT` 400 € +
    `FAMILY_OVERPAYMENT` 50 €.
42. Post-close adjustment while a round is `OPEN` → carried in that round as reserves.
43. Post-close adjustment while no round is `OPEN` (previous closed, next not yet opened) →
    recorded against the closed round with `PENDING_CARRY`; carried when the next round opens.
44. Attempt to open a round while another is `OPEN` → refused (409).
45. Fee payment of 250 € for two 100 € obligations → both `PAID`, 50 € unallocated balance
    shown as excess pending and a financial issue for Tresoreria; neither obligation becomes
    `ISSUE` (target semantics; 3B legacy gap until 3.5G.3).

# 33. Acceptance criteria (whole 3.5G)

- [ ] Every invariant I1–I30 enforced and covered by tests (D1 direct writes included where
      SQLite allows).
- [ ] Cases A–D, card, cash and reimbursement flows end to end without double counting.
- [ ] Round result statement reproduces the structure of §16 with synthetic data, separating
      reserves from income and result from financial position.
- [ ] Budget vs actual at every hierarchy level with initial, current, actual, difference,
      % executed and available.
- [ ] Fee generation preview/commit, N-part plans, sibling policy shared by fees and activities.
- [ ] Verified-unreconciled queue and reconciliation for fees and activities.
- [ ] 3B and 3.5F test suites unchanged and green; their contracts preserved.
- [ ] Privacy debt of 3B fixed (§27.1); section delegation without finance permissions.
- [ ] Audit catalogue implemented without personal data.
- [ ] Backup/restore drill covers D1 and the R2 manifest.
- [ ] Exports PRESSUPOST, RESULTAT, Quotes, Ingressos i Despeses generated from the report
      model.
- [ ] Synthetic-only policy respected everywhere (imports, evidence, exports).
- [ ] Closed rounds: official close immutable; post-close adjustments shown apart and carried
      as reserves in the `OPEN` round (or pending until one opens), never as income of another
      round; never two `OPEN` rounds.
- [ ] Amount due, received and allocated kept independent: authoritative price applied whatever
      was received; allocation ≤ due; excess kept as an overpayment, never income, never an
      automatic refund; no allocation while pricing is provisional.
- [ ] A fully covered obligation stays `PAID` with an overpayment or an unrelated financial
      issue shown alongside, for activities and fees (3B legacy gap closed, legacy tests
      replaced only by tests of the approved semantics).
- [ ] Portal pricing: claim untrusted, no family data revealed, authoritative snapshot, review
      flow, no silent recalculation.
- [ ] Proposed vs recognised expenses never mixed; reimbursement payment never adds an expense.
- [ ] Counterparties without IBAN; self-approval refused for linked users.
- [ ] No financial capability from a role alone; financial delegations explicit, scoped,
      expiring, revocable, audited.

# 34. Roadmap

| Step | Scope | Depends on | Main risks | Exit criteria |
|---|---|---|---|---|
| **3.5G.0-C** TREASURY.md | This document | 3.5G.0-A/B | — | Approved by Borja/Atlas |
| **3.5G.1A** Security corrections | 3B privacy debt (§27.1); fee evidence audit; `SECTION_DELEGATE` without finance permissions; **G.1A AUTHORIZATION DESIGN TASK** (financial delegation outcome of §25.3); permission catalogue entries reserved for 3.5G | 0-C | Quotes UI regressions; authorization engine change; possible role table rebuild (0001 CHECK on role codes) | Permission/privacy tests; no contact data in fee projections |
| **3.5G.1** Financial foundation | FinancialRound; positions; opening balances and initial reserves; movements; import batches with synthetic adapter; typed allocations; expenses (proposed/recognised); budget catalogue, budget, revisions and approval; audit; recovery D1 | 1A | Invariant complexity in D1; migration discipline (additive only) | Invariants enforced; recovery drill; CI green |
| **3.5G.2** Daily operations | UI: Inici Tresoreria, Moviments, Despeses, Reemborsaments, Justificants; counterparties; card statements; cash; reimbursement workflow with self-approval rule; expense evidence in R2; corrections | 1 | Classification UX | Cases A–D, card, cash, reimbursement end to end |
| **3.5G.3** Integrations | Obligation state separated from overpayment / unallocated balance in 3B (legacy gap §17.1); pricing policy (3B evolution + activities); portal pricing claim, authoritative snapshot and pricing review; fee generation; N-part plans; verification vs reconciliation for fees and 3.5F; activity price adjustments; reversals and family refunds | 1, 2 | 3B/3.5F contracts | Legacy suites green; new scenarios green |
| **3.5G.4** Reports and Excel | Budget vs actual; result and reserves; closing with official close snapshot and post-close adjustments; report model; template mapping; xlsx writer; exports | 1–3 | Output fidelity; xlsx dependency | Four outputs generated and checked against the historical structure |
| **3.5G.5** Integral validation | Full synthetic year with the 2025/26 patterns; R2 backup and drills; privacy review; legal gate list | all | Real data forbidden | Synthetic year reconciles; checklist approved |

# 35. Deferred debt

| Item | Decision |
|---|---|
| `annual_fee_evidence` / `payment_evidence` duplication | Not merged; shared service only **[D]** |
| Three notification systems | Not unified **[D]** |
| Retention of fee and activity evidence, bank data | After the legal decision |
| Earmarked reserve sub-funds | Future |
| Scouter self-submission of tickets in Gestió | Future |
| Inventory/stock for lottery and clothing | Future |
| Real bank format adapter | Before production, when the export format is known |

Not deferred (fixed during 3.5G): 3B obligation `ISSUE` caused by an unallocated balance /
`ALLOCATION_UNCLEAR` on covered obligations (3.5G.3, §17.1); hard-coded discount (3.5G.3), two-part plan (3.5G.3),
`feePaymentDetail SELECT *` and fee evidence audit (3.5G.1A), activity allocations without
reversal (3.5G.3), `expected_amount_cents` without adjustment (3.5G.3), reserved
`finance.fee.reconcile` (replaced in 3.5G.1A/3), empty `src/domains/finance` (hosts the new
domain from 3.5G.1), R2 backup (3.5G.5, requirements from 3.5G.1).

# 36. LEGAL DECISION REQUIRED

1. Keeping the original bank description (§27.2): retention, access, minimisation/purge
   moment.
2. Keeping original imported bank files.
3. Retention of expense evidence (tickets), fee evidence and activity payment evidence.
4. Retention of financial records and audit for treasury.
5. Body and formalities for budget approval beyond Coordinació general
   (`external_approval_*`).
6. Identification data kept for `PERSON` counterparties (reimbursement recipients, natural-person suppliers) and its retention.

# 37. PENDING TREASURY INPUT

Only: the exact meaning of **DEV**, **DEV Cuota 3r hijo** and similar historical
credits/adjustments.

The model is prepared without semantics: a reserved allocation kind (`RESERVED_CREDIT`),
reversal + reapplication linked by a correction id (reassignment between obligations), and
`FAMILY_REFUND` (refund). Overpayments (§21.4) are recorded and refundable in v1; their credit
and authorised-reassignment resolutions stay disabled until Tresoreria defines them. No DEV
behaviour is implemented until Tresoreria explains it.

# 38. Resolved contradictions (Borja/Atlas, 3.5G.0-C)

| # | Topic | Resolution | Where |
|---|---|---|---|
| C1 | Late collection of a closed round | Immutable official close snapshot; post-close adjustments recorded apart; effective figures derived; carried as reserves in the single `OPEN` round, or pending until the next round opens; never income of another round | §5.1, §5.4, §16, I21, I22, I28 |
| C2 | Sibling price in the portal | Portal shows base price and published policy only; family pricing claim is untrusted; authoritative snapshot after matching against the family unit; `PRICING_REVIEW_REQUIRED` without revealing the cause; allocation only after the snapshot; amount due independent of money received, excess kept as an overpayment, no refund invented | §21.1, §21.4, I2, I25, I29 |
| C3 | Reimbursement recipient without a Gestió account | Minimal `FinancialCounterparty` (`PERSON` / `ORGANIZATION`, optional user link, no IBAN, not a CRM); self-approval checked when a user is linked; no access granted otherwise | §10.3, §11, I20, I27 |
| C4 | Financial delegation | Outcome fixed (explicit, capability-limited, scoped, expiring, revocable, audited; a role alone never grants financial authority); exact mechanism is a **G.1A AUTHORIZATION DESIGN TASK** | §25.3, I26 |
| C5 | Design index scope | "Domain specifications" section in `DESIGN_INDEX.md` | DESIGN_INDEX.md |

No functional decision remains open for this specification. Open items are only LEGAL DECISION
REQUIRED (§36) and PENDING TREASURY INPUT (§37).
