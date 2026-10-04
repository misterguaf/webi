# Gestió — Tresoreria · Moviments

Status: IMPLEMENTED — pending Borja/Atlas functional and visual review
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5G.2A–G.2C functional extension
Baseline: `phase-3.5g1-complete` (`e1aa9f0`)
Depends on: TREASURY\_HOME.md, TREASURY\_EXPENSES.md, ../TREASURY.md (§7–§11, §27.2), ../UX\_RULES.md

---

## 1. List — `#/tresoreria/moviments`

Columns: **Data · Posició · Descripció · Import · Estat · Acció**.

- Amounts in EUR with grouping and sign: `+1.250,00 €`, `−85,50 €` (incoming in green).
- Description = minimised projection (`Ingrés/Càrrec <date> · ref. <reference>` or the manual label),
  plus one line with the current classification ("Despesa · Autobús…", "Ingrés · Quotes i 1 més").
- Never shown: UUIDs, hashes, fingerprints, versions, the original bank description.
- Status badges (derived on the server, `movementStatus`):

| Code | Badge |
|---|---|
| PENDING | Pendent de classificar |
| PARTIAL | Parcialment imputat (+ "Pendent X €") |
| CLASSIFIED | Classificat |
| POSSIBLE_DUPLICATE | Possible duplicat |
| VOID_DUPLICATE | Anul·lat com a duplicat |

- Action: **Classifica** (pending/partial, with classify capability), **Revisa** (possible duplicate),
  otherwise **Obri**.
- Filters (all applied by the server, kept in the URL): status chips (Tots, Requereixen atenció,
  Pendents, Parcials, Classificats, Possibles duplicats, Anul·lats), position, direction
  (entrades/eixides), date from/to, search. URL keys: `estat`, `posicio`, `sentit`, `des`, `fins`, `q`.
- Search covers the minimised label, the reference and the position name only; LIKE wildcards are
  escaped. The original description is never searched.
- Pagination by cursor ("Carrega’n més"). A voided duplicate leaves the default list (filter Anul·lats).

## 2. Detail — `#/tresoreria/moviments/<id>`

Header: signed amount, status badge, label · position, actions. Facts: date, position (+ kind),
allocated, pending. Sections: description (label, reference, value date, origin + import time),
current classification (kind, target with budget path / expense link / paired movement link, amount),
classification history (each replaced set with its time), duplicate banner.

## 3. Original description

- Button **Mostra descripció original** only with `finance.bank_description.reveal` (nobody holds it by
  default, not even Tresoreria or Coordinació general) and only when a description exists.
- Each click fetches `GET /movements/:id/description`; the server audits every consultation
  (`BANK_DESCRIPTION_REVEALED`, without the text). The value lives only in the DOM until hidden; it is
  never cached, stored or placed in a list. LEGAL DECISION REQUIRED for retention.

## 4. Classifica (drawer)

Choices offered by the current service:

| Movement | Choices |
|---|---|
| Outgoing BANK | És una despesa (needs expense.manage) · Reemborsament a scouter · Paga una despesa existent · És un traspàs intern |
| Outgoing CARD/CASH prepared position | És una despesa · Paga una despesa existent · És un traspàs intern |
| Incoming | Crea un ingrés (income.manage) · Vincula a un ingrés existent (income.read) · És la devolució d’una despesa (proveïdor) · És un traspàs intern |

Never offered: fee, activity, family or card-settlement allocations.

- Crea un ingrés → income form (TREASURY_INCOMES.md); the income is created and reconciled with the movement.
- Vincula a un ingrés existent: incomes pending reconciliation, exact amount first; amount defaults to
  min(income pending, movement pending).
- Paga / Devolució: recognised expenses of the round; for payment only those with the position's
  method and still unpaid.
- Reemborsament a scouter: choose one beneficiary, then one or more of that person's approved
  outstanding expenses and the amount for each. Treasury confirms the semantic bank match;
  imported movement data does not prove the recipient automatically. One movement may settle
  several debts; partial settlement and later correction use the existing versioned set.
- Traspàs intern: unclassified movements of another position with the opposite amount, nearest date
  first; it takes the whole movement (blocked with an explanation when part is already allocated).
- És una despesa → continues in the expense form (TREASURY\_EXPENSES.md §3).
- The new part is added to the current set (the existing parts are kept); `expectedVersion` is the
  movement's allocation version.

## 5. Corregeix classificació (drawer)

Lists the current parts with **Manté** and the amount; unchecking removes a part, the amount can be
changed. A short reason is required to replace an active classification. Saving writes a new set; the previous one stays in the history (nothing is deleted). An internal
transfer keeps its full amount; a hint reminds to review the paired movement.

For an already allocated BANK reimbursement transfer, **Reassigna reemborsaments** allows a different
set of approved debts of one beneficiary in one versioned change. The server rechecks available amount,
recipient consistency and approved current liabilities. Old allocations remain historical; reimbursement
transfers never add another economic expense.

## 6. Duplicates

- Possible duplicate banner: candidates with the same position, date and amount (links).
- **Confirma que és duplicat** → drawer to choose the original → `void-duplicate`. The movement is kept,
  marked "Anul·lat com a duplicat", out of balances and classifications, with a link to the original.
  Refused by the server while it has allocations.
- **És un moviment vàlid** → confirmation → `clear-review`; the movement becomes classifiable.

## 7. Feedback and errors

Toasts: "Classificació actualitzada", "Moviment marcat com a duplicat", "Moviment mantingut com a vàlid",
"Despesa creada". Buttons show a busy state; a drawer cannot submit twice. Server codes map to copy:

| Code | Message |
|---|---|
| allocation\_exceeds\_movement | L’import assignat supera l’import disponible del moviment. |
| stale\_movement / stale\_* | Aquesta informació ha canviat. Torna a carregar-la. |
| 403 | No tens permís per fer aquesta acció. |
| movement\_voided | Aquest moviment està anul·lat com a duplicat i no es pot classificar. |
| invalid\_income\_allocation | Tria una línia d’ingressos activa i assignable de la ronda oberta. |
| other | No s’ha pogut completar l’acció. Torna-ho a provar. |

## 8. Import batches

Visible only (Inici): date, position, format, rows, new, repeated, possible duplicates, status. There is
no upload control, no real bank parser and no stored file in this phase.

## 9. Responsive

≤1179px hides the position column. ≤767px: each movement is a card (label + amount, date + status, full
width action); filters wrap; status chips scroll horizontally; no hover dependence.
