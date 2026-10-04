// FASE 3.5G.1 — economic rounds, financial positions, opening balances and general reserves
// (TREASURY.md §5, §6, §16). Positions belong to the group; balances are derived from movements.
import { versionCas } from '../../concurrency.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, commit, conflict, fail, isDate, keysOnly, notFound, uuid, version } from './shared.js';

const ROUND_FIELDS = `id,code,period_start AS periodStart,period_end AS periodEnd,status,annual_fee_round_id AS annualFeeRoundId,
  version,opened_at AS openedAt,closing_started_at AS closingStartedAt,closed_at AS closedAt`;
const roundCode = value => typeof value === 'string' && /^20\d\d\/20\d\d$/.test(value) && Number(value.slice(5)) === Number(value.slice(0, 4)) + 1;

async function roundRow(db, id) {
  const row = await db.prepare('SELECT * FROM finance_round WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  return row;
}
export async function listRounds(db, context, requestId) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_round');
  return { rounds: (await db.prepare(`SELECT ${ROUND_FIELDS} FROM finance_round ORDER BY period_start DESC`).all()).results };
}
export async function roundDetail(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_round', validUuid(id) ? id : null);
  const round = await db.prepare(`SELECT ${ROUND_FIELDS} FROM finance_round WHERE id=?`).bind(requireUuid(id)).first();
  if (!round) throw notFound();
  const opening = (await db.prepare(`SELECT o.position_id AS positionId,o.revision,o.amount_cents AS amountCents,o.source,o.recorded_at AS recordedAt
    FROM finance_opening_balance_current o WHERE o.round_id=? ORDER BY o.position_id`).bind(id).all()).results;
  const reserves = await db.prepare(`SELECT revision,amount_cents AS amountCents,source,recorded_at AS recordedAt FROM finance_reserve_opening
    WHERE round_id=? ORDER BY revision DESC LIMIT 1`).bind(id).first();
  const economics = await db.prepare(`SELECT income_cents AS incomeCents,expense_gross_cents AS expenseGrossCents,
    expense_refund_cents AS expenseRefundCents,proposed_expense_cents AS proposedExpenseCents FROM finance_round_economics WHERE round_id=?`)
    .bind(id).first();
  const budget = await db.prepare('SELECT id,status,version FROM finance_budget WHERE round_id=?').bind(id).first();
  const close = await db.prepare(`SELECT income_cents AS incomeCents,expense_cents AS expenseCents,result_cents AS resultCents,
    reserves_final_cents AS reservesFinalCents,reserve_contribution_cents AS reserveContributionCents,
    reserve_application_cents AS reserveApplicationCents,result_after_reserves_cents AS resultAfterReservesCents,
    closed_at AS closedAt FROM finance_round_close WHERE round_id=?`).bind(id).first();
  const reserveOperations = (await db.prepare(`SELECT id,kind,amount_cents AS amountCents,created_at AS createdAt
    FROM finance_reserve_operation WHERE round_id=? ORDER BY created_at,id`).bind(id).all()).results;
  const contributionCents = reserveOperations.filter(row => row.kind === 'CONTRIBUTION')
    .reduce((sum, row) => sum + row.amountCents, 0);
  const applicationCents = reserveOperations.filter(row => row.kind === 'APPLICATION')
    .reduce((sum, row) => sum + row.amountCents, 0);
  const resultBeforeReservesCents = economics.incomeCents - (economics.expenseGrossCents - economics.expenseRefundCents);
  return { round, openingBalances: opening, reserves: reserves ?? null,
    economics: { ...economics, expenseNetCents: economics.expenseGrossCents - economics.expenseRefundCents,
      resultBeforeReservesCents, reserveContributionCents: contributionCents,
      reserveApplicationCents: applicationCents,
      resultAfterReservesCents: resultBeforeReservesCents + applicationCents - contributionCents },
    reserveOperations, budget: budget ?? null, officialClose: close ?? null };
}
function validRound(input, creating) {
  if (!keysOnly(input, creating ? ['code', 'periodStart', 'periodEnd', 'annualFeeRoundId']
    : ['code', 'periodStart', 'periodEnd', 'annualFeeRoundId', 'expectedVersion'])) fail('invalid_finance_round');
  if ((creating || input.code !== undefined) && !roundCode(input.code)) fail('invalid_finance_round');
  for (const key of ['periodStart', 'periodEnd']) if ((creating || input[key] !== undefined) && !isDate(input[key])) fail('invalid_finance_round');
  if (input.annualFeeRoundId != null && !validUuid(input.annualFeeRoundId)) fail('invalid_finance_round');
  if (!creating && !version(input.expectedVersion)) fail('invalid_version');
}
export async function createRound(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.round.manage', 'finance_round');
  validRound(input, true);
  if (input.periodEnd <= input.periodStart) fail('invalid_finance_round');
  if (input.annualFeeRoundId && !await db.prepare('SELECT 1 FROM annual_fee_round WHERE id=? AND code=?')
    .bind(input.annualFeeRoundId, input.code).first()) fail('invalid_finance_round');
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_round(id,code,period_start,period_end,annual_fee_round_id,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(id, input.code, input.periodStart, input.periodEnd, input.annualFeeRoundId ?? null, context.userId, now, now),
    audit(db, context, requestId, 'TREASURY_ROUND_CREATED', 'finance_round', id, now)
  ]);
  return { id, status: 'DRAFT', version: 1 };
}
export async function updateRound(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.round.manage', 'finance_round', validUuid(id) ? id : null);
  const row = await roundRow(db, id);
  validRound(input, false);
  if (row.status !== 'DRAFT') throw new AppError(409, 'finance_round_locked');
  const next = { code: input.code ?? row.code, start: input.periodStart ?? row.period_start, end: input.periodEnd ?? row.period_end,
    fee: input.annualFeeRoundId === undefined ? row.annual_fee_round_id : input.annualFeeRoundId };
  if (next.end <= next.start) fail('invalid_finance_round');
  if (next.fee && !await db.prepare('SELECT 1 FROM annual_fee_round WHERE id=? AND code=?').bind(next.fee, next.code).first()) fail('invalid_finance_round');
  await commit(db, [
    db.prepare(`UPDATE finance_round SET ${versionCas('version')},code=?,period_start=?,period_end=?,annual_fee_round_id=?,updated_at=? WHERE id=?`)
      .bind(input.expectedVersion, next.code, next.start, next.end, next.fee, now, id),
    audit(db, context, requestId, 'TREASURY_ROUND_UPDATED', 'finance_round', id, now)
  ], 'stale_round');
  return { id, version: input.expectedVersion + 1 };
}
const TRANSITIONS = {
  open: { from: ['DRAFT', 'CLOSING'], to: 'OPEN', action: row => row.status === 'DRAFT' ? 'TREASURY_ROUND_OPENED' : 'TREASURY_ROUND_CLOSING_CANCELLED' },
  closing: { from: ['OPEN'], to: 'CLOSING', action: () => 'TREASURY_ROUND_CLOSING_STARTED' }
};
/** DRAFT → OPEN, OPEN → CLOSING and CLOSING → OPEN. Closing to CLOSED arrives with the close workflow (3.5G.4). */
export async function transitionRound(db, context, requestId, id, kind, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.round.manage', 'finance_round', validUuid(id) ? id : null);
  const row = await roundRow(db, id);
  if (!keysOnly(input, ['expectedVersion']) || !version(input.expectedVersion)) fail('invalid_version');
  const step = TRANSITIONS[kind];
  if (!step.from.includes(row.status)) throw new AppError(409, 'invalid_transition');
  const opened = step.to === 'OPEN' && row.status === 'DRAFT';
  try {
    await db.batch([
      db.prepare(`UPDATE finance_round SET ${versionCas('version')},status=?,updated_at=?,
        opened_by=${opened ? '?' : 'opened_by'},opened_at=${opened ? '?' : 'opened_at'},
        closing_started_at=${step.to === 'CLOSING' ? '?' : 'NULL'} WHERE id=?`)
        .bind(input.expectedVersion, step.to, now, ...(opened ? [context.userId, now] : []), ...(step.to === 'CLOSING' ? [now] : []), id),
      audit(db, context, requestId, step.action(row), 'finance_round', id, now)
    ]);
  } catch (error) {
    const message = String(error?.message ?? '');
    if (message.includes('finance_round.status')) throw new AppError(409, step.to === 'OPEN' ? 'open_round_exists' : 'closing_round_exists');
    throw conflict(error, 'stale_round');
  }
  return { id, status: step.to, version: input.expectedVersion + 1 };
}

export async function recordReserveOperation(db, context, requestId, roundId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.round.manage', 'finance_reserve_operation');
  const round = await roundRow(db, roundId);
  if (!keysOnly(input, ['kind', 'amountCents']) || !['CONTRIBUTION', 'APPLICATION'].includes(input.kind) ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100000000)
    fail('invalid_reserve_operation');
  if (!['OPEN', 'CLOSING'].includes(round.status)) throw new AppError(409, 'invalid_transition');
  if (input.kind === 'APPLICATION') {
    const available = await db.prepare(`SELECT COALESCE((SELECT amount_cents FROM finance_reserve_opening
      WHERE round_id=? ORDER BY revision DESC LIMIT 1),0)
      +COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation WHERE round_id=? AND kind='CONTRIBUTION'),0)
      -COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation WHERE round_id=? AND kind='APPLICATION'),0) AS cents`)
      .bind(roundId, roundId, roundId).first();
    if (input.amountCents > available.cents) throw new AppError(409, 'insufficient_reserve');
  }
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_reserve_operation(id,round_id,kind,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).bind(id, roundId, input.kind, input.amountCents, context.userId, now),
    audit(db, context, requestId, input.kind === 'CONTRIBUTION' ? 'RESERVE_CONTRIBUTION_RECORDED' :
      'RESERVE_APPLICATION_RECORDED', 'finance_reserve_operation', id, now)
  ]);
  return { id };
}

export async function closeRound(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.round.close', 'finance_round', validUuid(id) ? id : null);
  const round = await roundRow(db, id);
  if (!keysOnly(input, ['expectedVersion']) || !version(input.expectedVersion)) fail('invalid_version');
  if (round.status !== 'CLOSING') throw new AppError(409, 'invalid_transition');
  if (round.version !== input.expectedVersion) throw new AppError(409, 'stale_round');
  const values = await db.prepare(`SELECT income_cents,expense_gross_cents-expense_refund_cents AS expense_cents
    FROM finance_round_economics WHERE round_id=?`).bind(id).first();
  const reserves = await db.prepare(`SELECT
    COALESCE((SELECT amount_cents FROM finance_reserve_opening WHERE round_id=? ORDER BY revision DESC LIMIT 1),0) AS opening,
    COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation WHERE round_id=? AND kind='CONTRIBUTION'),0) AS contribution,
    COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation WHERE round_id=? AND kind='APPLICATION'),0) AS application`)
    .bind(id, id, id).first();
  const result = values.income_cents - values.expense_cents;
  await commit(db, [
    db.prepare(`INSERT INTO finance_round_close(round_id,income_cents,expense_cents,result_cents,reserves_final_cents,
      reserve_contribution_cents,reserve_application_cents,result_after_reserves_cents,closed_by,closed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id, values.income_cents, values.expense_cents, result,
      reserves.opening + reserves.contribution - reserves.application, reserves.contribution, reserves.application,
      result + reserves.application - reserves.contribution, context.userId, now),
    db.prepare(`UPDATE finance_round SET ${versionCas('version')},status='CLOSED',closed_by=?,closed_at=?,updated_at=? WHERE id=?`)
      .bind(input.expectedVersion, context.userId, now, now, id),
    audit(db, context, requestId, 'TREASURY_ROUND_CLOSED', 'finance_round', id, now)
  ], 'stale_round');
  return { id, status: 'CLOSED', version: input.expectedVersion + 1, resultCents: result };
}

// ---------------------------------------------------------------- positions
const POSITION_FIELDS = 'id,kind,name,masked_reference AS maskedReference,status,version';
function validPosition(input, creating) {
  if (!keysOnly(input, creating ? ['kind', 'name', 'maskedReference'] : ['name', 'maskedReference', 'status', 'expectedVersion'])) fail('invalid_position');
  if (creating && !['BANK', 'CARD', 'CASH'].includes(input.kind)) fail('invalid_position');
  if ((creating || input.name !== undefined) && (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 80)) fail('invalid_position');
  if (input.maskedReference != null && (typeof input.maskedReference !== 'string' || !/^\d{1,4}$/.test(input.maskedReference))) fail('invalid_position');
  if (!creating && input.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(input.status)) fail('invalid_position');
  if (!creating && !version(input.expectedVersion)) fail('invalid_version');
}
export async function listPositions(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_position');
  const roundId = params?.get?.('roundId') ?? null;
  const round = roundId ? await roundRow(db, roundId)
    : await db.prepare("SELECT * FROM finance_round WHERE status='OPEN'").first();
  const positions = (await db.prepare(`SELECT ${POSITION_FIELDS} FROM finance_position ORDER BY kind,name,id`).all()).results;
  return { roundId: round?.id ?? null, positions: await Promise.all(positions.map(async row => ({ ...row, balance: round ? await balanceOf(db, row, round) : null }))) };
}
// Balance in a round: current opening balance + Σ ACTIVE movements dated inside the round period.
// For a card the debt is the negated balance (purchases are negative movements).
async function balanceOf(db, position, round) {
  const opening = await db.prepare('SELECT amount_cents FROM finance_opening_balance_current WHERE round_id=? AND position_id=?')
    .bind(round.id, position.id).first();
  const moved = await db.prepare(`SELECT COALESCE(sum(amount_cents),0) AS total FROM finance_movement WHERE position_id=? AND state='ACTIVE'
    AND operation_date>=? AND operation_date<=?`).bind(position.id, round.period_start, round.period_end).first();
  const openingCents = opening?.amount_cents ?? null, balanceCents = (openingCents ?? 0) + moved.total;
  return { openingCents, movementsCents: moved.total, balanceCents, ...(position.kind === 'CARD' ? { debtCents: -balanceCents } : {}) };
}
export async function createPosition(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.position.manage', 'finance_position');
  validPosition(input, true);
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_position(id,kind,name,masked_reference,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(id, input.kind, input.name.trim(), input.maskedReference ?? null, context.userId, now, now),
    audit(db, context, requestId, 'FINANCIAL_POSITION_CREATED', 'finance_position', id, now)
  ]);
  return { id, version: 1 };
}
export async function updatePosition(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.position.manage', 'finance_position', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT * FROM finance_position WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  validPosition(input, false);
  await commit(db, [
    db.prepare(`UPDATE finance_position SET ${versionCas('version')},name=?,masked_reference=?,status=?,updated_at=? WHERE id=?`)
      .bind(input.expectedVersion, input.name?.trim() ?? row.name, input.maskedReference === undefined ? row.masked_reference : input.maskedReference,
        input.status ?? row.status, now, id),
    audit(db, context, requestId, 'FINANCIAL_POSITION_UPDATED', 'finance_position', id, now)
  ], 'stale_position');
  return { id, version: input.expectedVersion + 1 };
}

// ---------------------------------------------------------------- opening balances and reserves
// Append-only revisions; `expectedRevision` is the current revision seen by the caller (0 = none).
export async function recordOpeningBalance(db, context, requestId, roundId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.position.manage', 'finance_opening_balance');
  const round = await roundRow(db, roundId);
  if (!keysOnly(input, ['positionId', 'amountCents', 'expectedRevision']) || !validUuid(input.positionId) ||
      !Number.isSafeInteger(input.amountCents) || Math.abs(input.amountCents) > 100000000 || !version(input.expectedRevision))
    fail('invalid_opening_balance');
  if (!await db.prepare('SELECT 1 FROM finance_position WHERE id=?').bind(input.positionId).first()) throw notFound();
  if (round.status === 'CLOSED') throw new AppError(409, 'finance_round_closed');
  // INITIALISATION while no round has been closed (the first managed round); DERIVED arrives with closing.
  if (await db.prepare("SELECT 1 FROM finance_round WHERE status='CLOSED'").first()) throw new AppError(409, 'opening_balance_derived');
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_opening_balance(id,round_id,position_id,revision,amount_cents,source,recorded_by,recorded_at)
      VALUES(?,?,?,?,?,'INITIALISATION',?,?)`).bind(id, round.id, input.positionId, input.expectedRevision + 1, input.amountCents, context.userId, now),
    audit(db, context, requestId, 'OPENING_BALANCE_RECORDED', 'finance_opening_balance', id, now)
  ], 'stale_opening_balance');
  return { id, revision: input.expectedRevision + 1 };
}
export async function recordReserves(db, context, requestId, roundId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.position.manage', 'finance_reserve_opening');
  const round = await roundRow(db, roundId);
  if (!keysOnly(input, ['amountCents', 'expectedRevision']) || !Number.isSafeInteger(input.amountCents) ||
      Math.abs(input.amountCents) > 100000000 || !version(input.expectedRevision)) fail('invalid_reserves');
  if (round.status === 'CLOSED') throw new AppError(409, 'finance_round_closed');
  if (await db.prepare("SELECT 1 FROM finance_round WHERE status='CLOSED'").first()) throw new AppError(409, 'reserves_derived');
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_reserve_opening(id,round_id,revision,amount_cents,source,recorded_by,recorded_at)
      VALUES(?,?,?,?,'INITIALISATION',?,?)`).bind(id, round.id, input.expectedRevision + 1, input.amountCents, context.userId, now),
    audit(db, context, requestId, 'RESERVES_RECORDED', 'finance_reserve_opening', id, now)
  ], 'stale_reserves');
  return { id, revision: input.expectedRevision + 1 };
}
