// FASE 3.5G.1 — HTTP surface of the financial foundation (/api/finance/*). Authentication happens in the
// worker before this router; every operation authorises itself. Responses are JSON with no-store.
import * as rounds from './rounds.js';
import * as movements from './movements.js';
import * as expenses from './expenses.js';
import * as budget from './budget.js';
import * as incomes from './incomes.js';
import * as evidence from './evidence.js';
import * as reimbursements from './reimbursements.js';
import * as activityInstallments from './activity-installments.js';
import * as familyOverpayments from './family-overpayments.js';
import * as familyRefunds from './family-refunds.js';

const IMPORT_MAX_BYTES = 300 * 1024, BODY_MAX_BYTES = 16 * 1024, EVIDENCE_BODY_MAX_BYTES = 6 * 1024 * 1024;

/** @returns {Promise<Response|null>} null when the path is not a finance route. */
export async function financeRoute({ db, storage, context, requestId, method, path, url, request, readJson, json }) {
  const body = () => readJson(request, BODY_MAX_BYTES);
  const ok = (data, status = 200) => json({ ...data, requestId }, status);
  let match;
  if (path === '/api/finance/family-overpayments' && method === 'POST')
    return ok(await familyOverpayments.createOverpayment(db, context, requestId, await body()), 201);
  if (path === '/api/finance/family-overpayments' && method === 'GET')
    return ok(await familyOverpayments.listOverpayments(db, context, requestId, url.searchParams));
  if ((match = path.match(/^\/api\/finance\/family-overpayments\/([^/]+)\/refund$/)) && method === 'POST')
    return ok(await familyRefunds.refundOverpayment(db, context, requestId, match[1]), 201);
  if ((match = path.match(/^\/api\/finance\/withdrawn-registrations\/([^/]+)\/refund-decision$/)) && method === 'POST')
    return ok(await familyRefunds.decideWithdrawalRefund(db, context, requestId, match[1], await body()), 201);
  if (path === '/api/finance/family-refunds' && method === 'GET')
    return ok(await familyRefunds.listFamilyRefunds(db, context, requestId, url.searchParams));
  if (path === '/api/finance/activity-installment-plans' && method === 'POST')
    return ok(await activityInstallments.authorizeActivityPlan(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/activity-installment-plans\/([^/]+)$/)) && method === 'GET')
    return ok(await activityInstallments.activityPlanDetail(db, context, requestId, match[1]));
  if ((match = path.match(/^\/api\/finance\/activity-installment-plans\/([^/]+)\/revisions$/)) && method === 'POST')
    return ok(await activityInstallments.reviseActivityPlan(db, context, requestId, match[1], await body()), 201);
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
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/close$/)) && method === 'POST')
    return ok(await rounds.closeRound(db, context, requestId, match[1], await body()));
  if ((match = path.match(/^\/api\/finance\/rounds\/([^/]+)\/reserve-operations$/)) && method === 'POST')
    return ok(await rounds.recordReserveOperation(db, context, requestId, match[1], await body()), 201);
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
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/receipt-candidates$/)) && method === 'GET')
    return ok(await movements.receiptCandidates(db, context, requestId, match[1]));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/description$/)) && method === 'GET')
    return ok(await movements.revealDescription(db, context, requestId, match[1]));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/allocations$/)) && method === 'POST')
    return ok(await movements.allocateMovement(db, context, requestId, match[1], await body()));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/expense$/)) && method === 'POST')
    return ok(await movements.expenseFromMovement(db, storage, context, requestId, match[1], await readJson(request, EVIDENCE_BODY_MAX_BYTES)), 201);
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/void-duplicate$/)) && method === 'POST')
    return ok(await movements.voidDuplicate(db, context, requestId, match[1], await body()));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/clear-review$/)) && method === 'POST')
    return ok(await movements.clearReviewFlag(db, context, requestId, match[1], await body()));
  if (path === '/api/finance/internal-transfers' && method === 'POST')
    return ok(await movements.recordInternalTransfer(db, context, requestId, await body()), 201);
  // Counterparties and expenses.
  // General incomes (3.5G.2A extension).
  if (path === '/api/finance/incomes' && method === 'GET') return ok(await incomes.listIncomes(db, context, requestId, url.searchParams));
  if (path === '/api/finance/incomes' && method === 'POST') return ok(await incomes.createIncome(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/incomes\/([^/]+)$/))) {
    if (method === 'GET') return ok(await incomes.incomeDetail(db, context, requestId, match[1]));
    if (method === 'PATCH') return ok(await incomes.reviseIncome(db, context, requestId, match[1], await body()));
  }
  if ((match = path.match(/^\/api\/finance\/incomes\/([^/]+)\/void$/)) && method === 'POST')
    return ok(await incomes.voidIncome(db, context, requestId, match[1], await body()));
  if ((match = path.match(/^\/api\/finance\/movements\/([^/]+)\/income$/)) && method === 'POST')
    return ok(await movements.incomeFromMovement(db, context, requestId, match[1], await body()), 201);
  if (path === '/api/finance/counterparties' && method === 'GET') return ok(await expenses.listCounterparties(db, context, requestId));
  if (path === '/api/finance/counterparties' && method === 'POST') return ok(await expenses.createCounterparty(db, context, requestId, await body()), 201);
  if ((match = path.match(/^\/api\/finance\/counterparties\/([^/]+)$/)) && method === 'PATCH')
    return ok(await expenses.updateCounterparty(db, context, requestId, match[1], await body()));
  if (path === '/api/finance/expenses' && method === 'GET') return ok(await expenses.listExpenses(db, context, requestId, url.searchParams));
  if (path === '/api/finance/expenses' && method === 'POST')
    return ok(await expenses.createExpense(db, storage, context, requestId, await readJson(request, EVIDENCE_BODY_MAX_BYTES)), 201);
  if ((match = path.match(/^\/api\/finance\/expenses\/([^/]+)$/))) {
    if (method === 'GET') return ok(await expenses.expenseDetail(db, context, requestId, match[1]));
    if (method === 'PATCH') return ok(await expenses.reviseExpense(db, context, requestId, match[1], await body()));
  }
  if ((match = path.match(/^\/api\/finance\/expenses\/([^/]+)\/(recognise|reject|void)$/)) && method === 'POST')
    return ok(await expenses.decideExpense(db, storage, context, requestId, match[1], match[2], await body()));
  if ((match = path.match(/^\/api\/finance\/expenses\/([^/]+)\/evidence$/)) && method === 'POST')
    return ok(await evidence.uploadExpenseEvidence(db, storage, context, requestId, match[1], await readJson(request, EVIDENCE_BODY_MAX_BYTES)), 201);
  if ((match = path.match(/^\/api\/finance\/expenses\/([^/]+)\/evidence\/([^/]+)\/replace$/)) && method === 'POST')
    return ok(await evidence.replaceExpenseEvidence(db, storage, context, requestId, match[1], match[2],
      await readJson(request, EVIDENCE_BODY_MAX_BYTES)), 201);
  if ((match = path.match(/^\/api\/finance\/expense-evidence\/([^/]+)$/)) && method === 'GET')
    return evidence.expenseEvidenceRead(db, storage, context, requestId, match[1], url.searchParams.get('mode') ?? 'download');
  if (path === '/api/finance/reimbursements' && method === 'GET')
    return ok(await reimbursements.listReimbursements(db, context, requestId, url.searchParams));
  return null;
}
