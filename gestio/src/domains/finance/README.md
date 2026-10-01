# Finance domain (3.5G Tresoreria)

Financial foundation implemented in 3.5G.1 ([TREASURY.md](../../../../docs/design/TREASURY.md)): economic rounds,
financial positions, opening balances and reserves, import batches and immutable movements, typed
allocations, counterparties, expenses and the per-round budget. Amounts are integer cents; every operation
authorises a GLOBAL finance permission server-side; audit events carry identifiers and codes only; the money
invariants live in D1 (migrations 0023–0027).

- `shared.js` — validation, authorisation, audit and conflict translation helpers.
- `rounds.js` — rounds, positions, opening balances, reserves.
- `movements.js` — synthetic import, manual movements, allocation sets, internal transfers, duplicates.
- `expenses.js` — counterparties and expenses with versioned lines.
- `budget.js` — catalogue, budget, approval and revisions.
- `routes.js` — `/api/finance/*`.

Annual fees (3B) and activity payments (3.5F) keep their own services; Tresoreria links to them through
allocations in 3.5G.3.
