// FASE 3.5G.1 — HTTP surface of the financial foundation (/api/finance/*). Authentication happens in the
// worker before this router; every operation authorises itself. Responses are JSON with no-store.
import * as rounds from './rounds.js';
import * as movements from './movements.js';
import * as expenses from './expenses.js';
import * as budget from './budget.js';

const IMPORT_MAX_BYTES = 300 * 1024, BODY_MAX_BYTES = 16 * 1024;

/** @returns {Promise<Response|null>} null when the path is not a finance route. */
export async function financeRoute({ db, context, requestId, method, path, url, request, readJson, json }) {
  const body = () => readJson(request, BODY_MAX_BYTES);
  const ok = (data, status = 200) => json({ ...data, requestId }, status);
  let match;
  // Tresoreria home (3.5G.2A): only the blocks the person may read.
  if (path === '/api/finance/summary' && method === 'GET') return ok(await movements.treasurySummary(db, context, requestId));
  // Rounds, opening balances, reserves.
  if (path === '/api/finance/rounds' && method === 'GET') return ok(await rounds.listRounds(db, context, requestId));
  if (path === '/api/finance/rounds' && method === 'POST') return ok(await rounds.createRound(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)$/))) {
    if (method === 'GET') return ok(await rounds.roundDetail(db, context, requestId, match[1]));
    if (method === 'PATCH') return ok(await rounds.updateRound(db, context, requestId, match[1], await body()));
  }
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/(open|closing)$/)) && method === 'POST')
    return ok(await rounds.transitionRound(db, context, requestId, match[1], match[2], await body()));
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/opening-balances$/)) && method === 'POST')
    return ok(await rounds.recordOpeningBalance(db, context, requestId, match[1], await body()), 201);
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/reserves$/)) && method === 'POST')
    return ok(await rounds.recordReserves(db, context, requestId, match[1], await body()), 201);
  // Budget.
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/budget$/))) {
    if (method === 'GET') return ok(await budget.getBudget(db, context, requestId, match[1]));
    if (method === 'POST') return ok(await budget.createBudget(db, context, requestId, match[1]), 201);
  }
  if ((match = path.match(/^\/api\/finance\/budgets\/([^/]+)\/(propose|return|approve)$/)) && method === 'POST')
    return ok(await budget.transitionBudget(db, context, requestId, match[1], match[2], await body()));
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/assignable-lines$/)) && method === 'GET')
    return ok(await budget.assignableLines(db, context, requestId, match[1], url.searchParams));
  if (path === '/api/finance/budget-lines' && method === 'POST') return ok(await budget.createLine(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/budget-lines\/([^/]+)$/)) && method === 'PATCH')
    return ok(await budget.updateLine(db, context, requestId, match[1], await body()));
  if (path === '/api/finance/budget-revisions' && method === 'POST') return ok(await budget.proposeRevision(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/budget-revisions\/([^/]+)\/decision$/)) && method === 'POST')
    return ok(await budget.decideRevision(db, context, requestId, match[1], await body()));
  // Positions.
  if (path === '/api/finance/positions' && method === 'GET') return ok(await rounds.listPositions(db, context, requestId, url.searchParams));
  if (path === '/api/finance/positions' && method === 'POST') return ok(await rounds.createPosition(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/positions\/([^/]+)$/)) && method === 'PATCH')
    return ok(await rounds.updatePosition(db, context, requestId, match[1], await body()));
  // Import batches and movements.
  if (path === '/api/finance/import-batches' && method === 'GET') return ok(await movements.listImportBatches(db, context, requestId));
  if (path === '/api/finance/import-batches' && method === 'POST')
    return ok(await movements.importBatch(db, context, requestId, await readJson(request, IMPORT_MAX_BYTES)), 201);
  if (path === '/api/finance/movements' && method === 'GET') return ok(await movements.listMovements(db, context, requestId, url.searchParams));
  if (path === '/api/finance/movements' && method === 'POST') return ok(await movements.createManualMovement(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)$/)) && method === 'GET')
    return ok(await movements.movementDetail(db, context, requestId, match[1]));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/description$/)) && method === 'GET')
    return ok(await movements.revealDescription(db, context, requestId, match[1]));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/allocations$/)) && method === 'POST')
    return ok(await movements.allocateMovement(db, context, requestId, match[1], await body()));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/expense$/)) && method === 'POST')
    return ok(await movements.expenseFromMovement(db, context, requestId, match[1], await body()), 201);
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/void-duplicate$/)) && method === 'POST')
    return ok(await movements.voidDuplicate(db, context, requestId, match[1], await body()));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/clear-review$/)) && method === 'POST')
    return ok(await movements.clearReviewFlag(db, context, requestId, match[1], await body()));
  if (path === '/api/finance/internal-transfers' && method === 'POST')
    return ok(await movements.recordInternalTransfer(db, context, requestId, await body()), 201);
  // Counterparties and expenses.
  if (path === '/api/finance/counterparties' && method === 'GET') return ok(await expenses.listCounterparties(db, context, requestId));
  if (path === '/api/finance/counterparties' && method === 'POST') return ok(await expenses.createCounterparty(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/counterparties\/([^/]+)$/)) && method === 'PATCH')
    return ok(await expenses.updateCounterparty(db, context, requestId, match[1], await body()));
  if (path === '/api/finance/expenses' && method === 'GET') return ok(await expenses.listExpenses(db, context, requestId, url.searchParams));
  if (path === '/api/finance/expenses' && method === 'POST') return ok(await expenses.createExpense(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/expenses\/([^/]+)$/))) {
    if (method === 'GET') return ok(await expenses.expenseDetail(db, context, requestId, match[1]));
    if (method === 'PATCH') return ok(await expenses.reviseExpense(db, context, requestId, match[1], await body()));
  }
  if ((match = path.match(/^\/api\/finance\/expenses\/([^/]+)\/(recognise|reject|void)$/)) && method === 'POST')
    return ok(await expenses.decideExpense(db, context, requestId, match[1], match[2], await body()));
  return null;
}
