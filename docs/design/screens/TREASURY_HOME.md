# Gestió — Tresoreria · Inici

Status: IMPLEMENTED — pending Borja/Atlas functional and visual review
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5G.2A + G.2B functional extension
Baseline: `phase-3.5g1-complete` (`e1aa9f0`)
Depends on:

- ../DESIGN\_VISION.md, ../DESIGN\_SYSTEM.md, ../UX\_RULES.md
- SHELL.md (navigation, badges), ACTIVITIES.md (shared components)
- ../TREASURY.md (§5 rounds, §6 positions, §7–§11 movements and allocations, §10 expenses, §25 permissions)
- TREASURY\_MOVEMENTS.md, TREASURY\_EXPENSES.md

---

## 1. Purpose

Answer one question: **"Què necessita atenció ara?"** for the people who run the treasury.
It shows only figures that are reliable today. It never shows a result, a profit or budget
consumption: those depend on closing (3.5G.4) and budget execution, which do not exist yet.

## 2. Route and navigation

- `#/tresoreria` (Inici), `#/tresoreria/moviments[/<id>]`, `#/tresoreria/despeses[/<id>]`.
- Shell entry **Tresoreria** (icon `bank`) after Quotes; on mobile it lives under **Més**.
- Offered only when `/api/me` says `treasury.read || treasury.readMovements || treasury.readExpenses`.
  Section coordination, Secretaria and TECH\_ADMIN hold none of them and never see the entry; a direct
  link shows "La tresoreria no està disponible en esta sessió." without calling `/api/finance`.
- Tabs **Inici · Moviments · Despeses**; a tab appears only with its read capability.
- Navigation badge: pending movements + possible duplicates (0 hides it).

## 3. Content (`GET /api/finance/summary`)

The server returns only the blocks the person may read; the UI renders what arrives.

| Block | Capability | Content |
|---|---|---|
| Attention | movement.read / expense.read | Pending movements, partially allocated, possible duplicates, proposed expenses (count + amount, "encara no comptades"). Each item opens the filtered list. Empty: "Res pendent. Tot està classificat i revisat." |
| Posicions | treasury.read | BANK balance is primary (including the real debit card). Prepared CARD/CASH positions, if present in old or synthetic data, sit in a secondary dormant-model disclosure; they are not ordinary v1 workflows. Notes appear when no opening balance is recorded. |
| Moviments recents | movement.read | Last 5 active movements: label, amount, date, position, status. |
| Despeses reconegudes recents | expense.read | Last 5 recognised expenses of the OPEN round. |
| Importacions recents | movement.read | Last 3 batches: date, position, format, rows, new, repeated, possible duplicates, status. Read-only; "La importació d’extractes reals no està disponible en esta fase." |

A movement-only financial delegation sees Attention (movements), recent movements and batches; no
balances and no expenses (`positions` and `expenses` are absent from the response).

## 4. States

- Loading: skeleton in the content area; tabs stay usable.
- Error: inline error with "Torna-ho a intentar"; 401 goes to the session flow.
- No OPEN round: subtitle "Sense ronda econòmica oberta"; positions and expenses blocks are omitted.

## 5. Responsive

Desktop: two columns for recent movements/expenses. ≤1179px: one column. ≤767px: tabs as three equal
segments, position cards stacked, no hover dependence.
