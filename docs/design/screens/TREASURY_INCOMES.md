# Gestió — Tresoreria · Ingressos

Status: IMPLEMENTED — pending Borja/Atlas review
Version: 0.1
Phase: 3.5G.2A (income extension)
Depends on: TREASURY_HOME.md, TREASURY_MOVEMENTS.md, TREASURY_EXPENSES.md, ../TREASURY.md §34.3

## Purpose

The bank export does not say what a movement is. Ingressos holds the economic meaning of general incomes
(grants, donations, lottery, sales, other ordinary incomes). Fees and activity payments are 3.5G.3.

## List — `#/tresoreria/ingressos`

Data · Concepte (+ who pays) · Partida (path) · Import · Estat. States (derived): Pendent de conciliar,
Conciliat en part (+ pending), Conciliat, Anul·lat. Filters: state chips, income line (a heading selects its
subtree), dates. **Nou ingrés** with `finance.income.manage`. Tab shown only with `finance.income.read`.

## Nou ingrés (drawer)

Concepte, data, import (euros; thousands dots accepted), partida d’ingressos (tree picker, active INCOME leaves
of the round only), qui aporta (optional minimal counterparty, no IBAN or contact). Saving creates the income
pending reconciliation; no movement is invented. From a movement (Classifica → Crea un ingrés) the import is
capped at the movement's pending amount and the income is reconciled at once ("Crea i concilia").

## Detail — `#/tresoreria/ingressos/<id>`

Status sentence ("Esperem encara un moviment bancari de 1.500,00 €." / "Conciliat amb el moviment del
02/10/2026."), facts (import, data, conciliat, pendent), line and counterparty, movements that collect it
(links), history (registered, corrections with previous concept/amount/line, voided).
Actions: **Concilia amb un moviment** (incoming, active, not flagged movements with something unallocated;
exact amount first; the movement's other parts are kept) and **Anul·la l’ingrés** (only while pending; never
deleted).

## Home

Attention items "ingressos pendents de conciliar (amount)" and "moviments d’entrada sense identificar".
