// Tresoreria (3.5G.2A, docs/design/screens/TREASURY_*.md) — pure model: money, labels, filters, error
// copy, the line split and the budget tree. Advisory only: the server authorises and validates everything.
import { parseEuros as parsePlainEuros } from '../activities/model.js';

/** Euros typed by a person, also with thousands dots ("1.500", "1.250,50") → cents, or null. */
export function parseEuros(value, options) {
  const text = String(value ?? '').trim().replace(/\s|€/g, '');
  return parsePlainEuros(/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text) ? text.replaceAll('.', '') : text, options);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- money and dates

const euros = new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
/** 125000 → "1.250,00 €"; signed: "+1.250,00 €" / "−1.250,00 €". */
export function formatEur(cents, { signed = false } = {}) {
  const value = Number.isFinite(cents) ? cents : 0;
  const text = `${euros.format(Math.abs(value) / 100)} €`;
  if (signed) return `${value < 0 ? '−' : '+'}${text}`;
  return value < 0 ? `−${text}` : text;
}
export const centsInput = cents => (cents / 100).toFixed(2).replace('.', ',');
const dateFormat = new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "2026-10-03" → "3 d’oct. 2026" (dates are calendar days, not instants). */
export const formatDay = iso => DATE.test(iso ?? '') ? dateFormat.format(new Date(`${iso}T00:00:00Z`)) : '';
/** "2026-10-03" → "03/10/2026" for dense lists. */
export const formatShortDay = iso => DATE.test(iso ?? '') ? iso.split('-').reverse().join('/') : '';
const instantFormat = new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatInstant = ms => Number.isFinite(ms) ? instantFormat.format(new Date(ms)) : '';
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

// ---------------------------------------------------------------- labels

export const POSITION_KIND = { BANK: 'Compte bancari', CARD: 'Targeta', CASH: 'Caixa' };
export const PAYMENT_METHOD = { BANK: 'Compte / targeta de dèbit del grup', CARD: 'Targeta preparada', CASH: 'Caixa preparada', ADVANCED: 'Avançada per un scouter' };
export const ORIGIN = { IMPORT: 'Importació', MANUAL: 'Registre manual' };
export const MOVEMENT_STATUS = {
  PENDING: { label: 'Pendent de classificar', tone: 'attention' },
  PARTIAL: { label: 'Parcialment imputat', tone: 'warning' },
  CLASSIFIED: { label: 'Classificat', tone: 'ok' },
  POSSIBLE_DUPLICATE: { label: 'Possible duplicat', tone: 'warning' },
  VOID_DUPLICATE: { label: 'Anul·lat com a duplicat', tone: 'muted' }
};
export const EXPENSE_STATUS = {
  PROPOSED: { label: 'Proposta', tone: 'attention' },
  RECOGNISED: { label: 'Reconeguda', tone: 'ok' },
  REJECTED: { label: 'Rebutjada', tone: 'muted' },
  VOID: { label: 'Anul·lada', tone: 'muted' }
};
export const SETTLEMENT_STATE = { UNSETTLED: 'Sense pagament vinculat', PARTIAL: 'Pagada en part', SETTLED: 'Pagada' };
export const ALLOCATION_KIND = { INCOME: 'Ingrés', EXPENSE_SETTLEMENT: 'Pagament de despesa', EXPENSE_REFUND: 'Devolució de despesa',
  INTERNAL_TRANSFER: 'Traspàs intern', REIMBURSEMENT_SETTLEMENT: 'Reemborsament a scouter' };
export const BATCH_STATUS = { IMPORTED: 'Importada', PARTIALLY_FLAGGED: 'Amb possibles duplicats' };
export const BATCH_FORMAT = { SYNTHETIC_CSV_V1: 'CSV sintètic' };
export const COUNTERPARTY_KIND = { PERSON: 'Persona', ORGANIZATION: 'Entitat' };
export const movementStatus = code => MOVEMENT_STATUS[code] ?? { label: 'Estat desconegut', tone: 'muted' };
export const expenseStatus = code => EXPENSE_STATUS[code] ?? { label: 'Estat desconegut', tone: 'muted' };

/** Human summary of one current allocation ("Despesa · Material de campament"). */
export function allocationLabel(allocation) {
  if (allocation.kind === 'INCOME') return `Ingrés · ${allocation.income?.concept ?? allocation.budgetLine?.name ?? 'línia de pressupost'}`;
  if (allocation.kind === 'EXPENSE_SETTLEMENT') return `Despesa · ${allocation.expense?.concept ?? 'despesa'}`;
  if (allocation.kind === 'EXPENSE_REFUND') return `Devolució de despesa · ${allocation.expense?.concept ?? 'despesa'}`;
  if (allocation.kind === 'REIMBURSEMENT_SETTLEMENT') return `Reemborsament · ${allocation.reimbursement?.recipientName ?? 'scouter'} · ${allocation.reimbursement?.concept ?? 'despesa'}`;
  if (allocation.kind === 'INTERNAL_TRANSFER') {
    const pair = allocation.pairedMovement;
    return `Traspàs intern${pair ? ` · ${pair.positionName}` : ''}`;
  }
  return 'Classificació';
}
/** One short line for the list column: what the movement was assigned to. */
export function classificationLine(movement) {
  const items = movement.classification ?? [];
  if (!items.length) return null;
  const first = allocationLabel(items[0]);
  return items.length > 1 ? `${first} i ${items.length - 1} més` : first;
}
export const budgetPath = line => line?.path?.length ? line.path.join(' › ') : line?.name ?? '';

// ---------------------------------------------------------------- capabilities (advisory)

const t = caps => caps?.treasury ?? {};
export const treasuryAvailable = caps => !!(t(caps).read || t(caps).readMovements || t(caps).readExpenses || t(caps).readIncomes);
export const TABS = [
  { id: 'inici', label: 'Inici', available: caps => treasuryAvailable(caps) },
  { id: 'moviments', label: 'Moviments', available: caps => !!t(caps).readMovements },
  { id: 'ingressos', label: 'Ingressos', available: caps => !!t(caps).readIncomes },
  { id: 'despeses', label: 'Despeses', available: caps => !!t(caps).readExpenses }
];
export const availableTabs = caps => TABS.filter(tab => tab.available(caps));
export const canClassify = caps => !!t(caps).classifyMovements;
export const canManageExpenses = caps => !!t(caps).manageExpenses;
export const canManageIncomes = caps => !!t(caps).manageIncomes;
export const canReveal = caps => !!t(caps).revealDescriptions;

/**
 * Classification choices offered for a movement. Only the kinds enabled in 3.5G.1 (TREASURY.md §11):
 * never fee, activity, family or card-settlement allocations.
 */
export function classificationOptions(movement, caps) {
  if (!movement || movement.state !== 'ACTIVE' || !canClassify(caps)) return [];
  if (movement.amountCents > 0) return [
    ...(canManageIncomes(caps) ? [{ id: 'NEW_INCOME', label: 'Crea un ingrés', hint: 'Subvenció, donació, loteria, venda… Es crea l’ingrés i queda conciliat amb aquest moviment.' }] : []),
    ...(t(caps).readIncomes ? [{ id: 'LINK_INCOME', label: 'Vincula a un ingrés existent', hint: 'Un ingrés ja registrat que esperava aquest cobrament.' }] : []),
    { id: 'EXPENSE_REFUND', label: 'És la devolució d’una despesa (proveïdor)', hint: 'Un proveïdor torna diners: reduïx una despesa ja reconeguda. No és un ingrés.' },
    { id: 'INTERNAL_TRANSFER', label: 'És un traspàs intern', hint: 'Diners que passen d’una posició del grup a una altra.' }
  ];
  return [
    ...(canManageExpenses(caps) ? [{ id: 'NEW_EXPENSE', label: 'És una despesa', hint: 'Crea la despesa i la reparteix entre línies del pressupost.' }] : []),
    ...(movement.positionKind === 'BANK' && t(caps).readExpenses ? [{ id: 'REIMBURSEMENT_SETTLEMENT',
      label: 'Reemborsament a scouter', hint: 'Concilia una transferència bancària amb una o diverses despeses avançades per la mateixa persona.' }] : []),
    { id: 'EXPENSE_SETTLEMENT', label: 'Paga una despesa existent', hint: 'Vincula el moviment a una despesa ja reconeguda.' },
    { id: 'INTERNAL_TRANSFER', label: 'És un traspàs intern', hint: 'Diners que passen d’una posició del grup a una altra.' }
  ];
}

// ---------------------------------------------------------------- filters (URL ⇄ API)

const MOVEMENT_STATUS_FILTERS = { pendents: 'pending', parcials: 'partial', classificats: 'classified', atencio: 'attention',
  duplicats: 'duplicates', anullats: 'voided' };
export const MOVEMENT_STATUS_CHOICES = [
  { value: '', label: 'Tots' }, { value: 'atencio', label: 'Requereixen atenció' }, { value: 'pendents', label: 'Pendents' },
  { value: 'parcials', label: 'Parcials' }, { value: 'classificats', label: 'Classificats' }, { value: 'duplicats', label: 'Possibles duplicats' },
  { value: 'anullats', label: 'Anul·lats' }];
export const DIRECTION_CHOICES = [{ value: '', label: 'Entrades i eixides' }, { value: 'entrades', label: 'Entrades' }, { value: 'eixides', label: 'Eixides' }];
/** Route query → valid movement filters (unknown values are dropped). */
export function parseMovementFilters(query = {}) {
  return {
    estat: MOVEMENT_STATUS_FILTERS[query.estat] ? query.estat : '',
    posicio: UUID.test(query.posicio ?? '') ? query.posicio : '',
    des: DATE.test(query.des ?? '') ? query.des : '',
    fins: DATE.test(query.fins ?? '') ? query.fins : '',
    sentit: ['entrades', 'eixides'].includes(query.sentit) ? query.sentit : '',
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 80) : ''
  };
}
export const movementFiltersToQuery = filters => Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
export function movementApiQuery(filters) {
  const params = new URLSearchParams();
  if (filters.estat) params.set('status', MOVEMENT_STATUS_FILTERS[filters.estat]);
  if (filters.posicio) params.set('positionId', filters.posicio);
  if (filters.des) params.set('from', filters.des);
  if (filters.fins) params.set('to', filters.fins);
  if (filters.sentit) params.set('direction', filters.sentit === 'entrades' ? 'in' : 'out');
  if (filters.q) params.set('q', filters.q);
  return params.toString();
}

const EXPENSE_STATUS_FILTERS = { propostes: 'PROPOSED', reconegudes: 'RECOGNISED', rebutjades: 'REJECTED', anullades: 'VOID' };
export const EXPENSE_PAYMENT_CHOICES = [{ value: '', label: 'Totes' }, { value: 'grup', label: 'Pagades pel grup' },
  { value: 'reemborsaments', label: 'Reemborsaments' }, { value: 'pendents', label: 'Pendents de reemborsar' }];
export const EXPENSE_STATUS_CHOICES = [{ value: '', label: 'Totes' }, { value: 'reconegudes', label: 'Reconegudes' },
  { value: 'propostes', label: 'Propostes' }, { value: 'rebutjades', label: 'Rebutjades' }, { value: 'anullades', label: 'Anul·lades' }];
export function parseExpenseFilters(query = {}) {
  return {
    estat: EXPENSE_STATUS_FILTERS[query.estat] ? query.estat : '',
    pagament: EXPENSE_PAYMENT_CHOICES.some(choice => choice.value === query.pagament) ? query.pagament : '',
    des: DATE.test(query.des ?? '') ? query.des : '',
    fins: DATE.test(query.fins ?? '') ? query.fins : '',
    linia: UUID.test(query.linia ?? '') ? query.linia : '',
    tercer: UUID.test(query.tercer ?? '') ? query.tercer : ''
  };
}
export const expenseFiltersToQuery = movementFiltersToQuery;
export function expenseApiQuery(roundId, filters) {
  const params = new URLSearchParams({ roundId });
  if (filters.estat) params.set('status', EXPENSE_STATUS_FILTERS[filters.estat]);
  if (filters.pagament === 'grup') params.set('method', 'BANK');
  if (filters.pagament === 'reemborsaments' || filters.pagament === 'pendents') params.set('method', 'ADVANCED');
  if (filters.pagament === 'pendents') params.set('outstanding', '1');
  if (filters.des) params.set('from', filters.des);
  if (filters.fins) params.set('to', filters.fins);
  if (filters.linia) params.set('budgetLineId', filters.linia);
  if (filters.tercer) params.set('counterpartyId', filters.tercer);
  return params.toString();
}

// ---------------------------------------------------------------- error copy

const ERRORS = {
  allocation_exceeds_movement: 'L’import assignat supera l’import disponible del moviment.',
  stale_movement: 'Aquesta informació ha canviat. Torna a carregar-la.',
  stale_expense: 'Aquesta informació ha canviat. Torna a carregar-la.',
  stale_counterparty: 'Aquesta informació ha canviat. Torna a carregar-la.',
  stale_resource: 'Aquesta informació ha canviat. Torna a carregar-la.',
  forbidden: 'No tens permís per fer aquesta acció.',
  self_approval: 'Per a aprovar un reemborsament propi cal l’autorització específica de Tresoreria.',
  expense_evidence_required: 'Adjunta un justificant abans de reconéixer la despesa.',
  expense_correction_reason_required: 'Explica breument el motiu de la correcció.',
  allocation_correction_reason_required: 'Explica breument el motiu de la correcció de la classificació.',
  reimbursement_settlement_locked: 'Aquesta despesa ja té un reemborsament conciliat. Corregeix primer la conciliació abans de modificar-la o anul·lar-la.',
  evidence_already_replaced: 'Aquest justificant ja s’ha substituït. Torna a carregar la despesa.',
  invalid_evidence: 'El justificant ha de ser un PDF o una imatge vàlida.',
  evidence_too_large: 'El justificant supera el límit de 4 MB.',
  synthetic_evidence_required: 'Este entorn només accepta justificants sintètics de prova.',
  invalid_reimbursement_settlement: 'No es pot conciliar este reemborsament: revisa la persona, el pendent i el moviment bancari.',
  reimbursement_expense_locked: 'Esta despesa ja té un reemborsament aprovat i no es pot alterar l’import ni la persona.',
  not_found: 'Aquest element ja no existeix o no hi tens accés.',
  movement_voided: 'Aquest moviment està anul·lat com a duplicat i no es pot classificar.',
  invalid_allocation_direction: 'Aquest tipus de classificació no correspon al sentit del moviment.',
  invalid_income_allocation: 'L’import supera el pendent de l’ingrés, o la partida no és vàlida.',
  invalid_expense_allocation: 'La despesa no admet aquest import: ha de ser reconeguda, del mateix mitjà de pagament i sense superar el total.',
  invalid_internal_transfer: 'El traspàs ha d’unir dos moviments sencers de posicions diferents, amb el mateix import i signe contrari.',
  allocation_kind_not_enabled: 'Aquest tipus de classificació encara no està disponible.',
  invalid_allocation: 'Revisa la classificació: falten dades o no són vàlides.',
  invalid_expense_line: 'Una línia de pressupost no és vàlida: ha de ser una línia de despesa activa i assignable d’esta ronda.',
  expense_lines_total_mismatch: 'La suma de les línies ha de coincidir amb el total de la despesa.',
  invalid_expense: 'Revisa la despesa: falten dades o no són vàlides.',
  advanced_expense_requires_review: 'Una despesa avançada per una persona s’ha de reconéixer després de revisar-la.',
  invalid_transition: 'Aquesta acció ja no és possible en l’estat actual.',
  invalid_duplicate_void: 'No es pot marcar aquest moviment com a duplicat.',
  invalid_counterparty: 'Revisa el nom i el tipus del tercer. En l’entorn de prova el nom ha d’incloure «(fictici)».',
  counterparty_user_linked: 'Aquesta persona ja està vinculada a un altre tercer.',
  finance_round_closed: 'La ronda està tancada: no s’hi poden fer canvis.',
  invalid_filter: 'Algun filtre no és vàlid.',
  invalid_income: 'Revisa l’ingrés: la partida ha de ser una partida d’ingressos activa i final d’esta ronda, i l’import no pot baixar del ja conciliat.',
  income_reconciled: 'Aquest ingrés ja té cobraments vinculats. Corregeix primer la classificació del moviment.',
  stale_income: 'Aquesta informació ha canviat. Torna a carregar-la.',
  invalid_version: 'Aquesta informació ha canviat. Torna a carregar-la.'
};
/** Server error → human Valencian copy; codes never reach the screen. */
export function errorCopy(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code && ERRORS[code]) return ERRORS[code];
  if (error?.status === 403) return ERRORS.forbidden;
  if (error?.status === 404) return ERRORS.not_found;
  if (error?.status === 0) return 'No s’ha pogut connectar amb Gestió. Torna-ho a provar.';
  return 'No s’ha pogut completar l’acció. Torna-ho a provar.';
}

// ---------------------------------------------------------------- line split

/** Total / Distribuït / Pendent of a split. Lines carry `amount` as typed text. */
export function splitState(totalCents, lines) {
  let distributed = 0, invalid = false;
  for (const line of lines) {
    const cents = parseEuros(line.amount);
    if (cents === null || cents <= 0 || !line.budgetLineId) invalid = true;
    else distributed += cents;
  }
  const pending = (totalCents ?? 0) - distributed;
  return { total: totalCents ?? 0, distributed, pending, invalid, balanced: !invalid && totalCents > 0 && pending === 0 && lines.length > 0 };
}

// ---------------------------------------------------------------- budget tree

/** Flat lines (id, code, name, parentId, assignable) → depth-first list with depth and path. */
export function budgetTree(lines) {
  const children = new Map();
  for (const line of lines) {
    const key = line.parentId ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(line);
  }
  const known = new Set(lines.map(line => line.id));
  const roots = lines.filter(line => !line.parentId || !known.has(line.parentId));
  const out = [];
  const walk = (line, depth, path) => {
    const here = [...path, line.name];
    out.push({ ...line, depth, path: here });
    for (const child of children.get(line.id) ?? []) walk(child, depth + 1, here);
  };
  for (const root of roots) walk(root, 0, []);
  return out;
}
/** Assignable leaves matching a search (code or any name on the path). */
export function filterTree(tree, query) {
  const q = normalise(query);
  if (!q) return tree;
  const hits = new Set();
  for (const node of tree) if (normalise(`${node.code} ${node.path.join(' ')}`).includes(q)) node.path.forEach((_, index) => hits.add(node.path.slice(0, index + 1).join('›')));
  return tree.filter(node => hits.has(node.path.join('›')));
}
const normalise = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('ca').trim();

// ---------------------------------------------------------------- expense form

/**
 * Validate the expense form (manual or from a movement). Returns { valid, errors, body }.
 * @param {{concept:string, expenseDate:string, total:string, lines:Array<{budgetLineId:string, amount:string}>,
 *   counterpartyId?:string, paymentMethod?:string}} values
 */
export function validateExpense(values, { fixedTotalCents = null, roundId, manual = false } = {}) {
  const errors = {};
  const concept = String(values.concept ?? '').trim();
  if (!concept) errors.concept = 'Escriu un concepte curt.';
  else if (concept.length > 120) errors.concept = 'Màxim 120 caràcters.';
  if (!DATE.test(values.expenseDate ?? '')) errors.expenseDate = 'Indica la data de la despesa.';
  const total = fixedTotalCents ?? parseEuros(values.total);
  if (!total || total <= 0) errors.total = 'Indica un import positiu.';
  if (manual && !PAYMENT_METHOD[values.paymentMethod]) errors.paymentMethod = 'Tria com s’ha pagat.';
  if (manual && values.paymentMethod === 'ADVANCED' && !values.advancedById) errors.advancedById = 'Tria qui ha avançat els diners.';
  const split = splitState(total ?? 0, values.lines ?? []);
  if (!values.lines?.length) errors.lines = 'Afig almenys una línia de pressupost.';
  else if (split.invalid) errors.lines = 'Cada línia necessita una línia de pressupost i un import.';
  else if (!split.balanced) errors.lines = split.pending > 0 ? `Falten ${formatEur(split.pending)} per repartir.` : `Has repartit ${formatEur(-split.pending)} de més.`;
  const valid = !Object.keys(errors).length;
  const lines = (values.lines ?? []).map(line => ({ budgetLineId: line.budgetLineId, amountCents: parseEuros(line.amount) }));
  const body = valid ? { roundId, expenseDate: values.expenseDate, concept, ...(values.counterpartyId ? { counterpartyId: values.counterpartyId } : {}), lines } : null;
  if (body && manual) Object.assign(body, { totalCents: total, paymentMethod: values.paymentMethod,
    ...(values.paymentMethod === 'ADVANCED' ? { advancedById: values.advancedById } : {}) });
  return { valid, errors, body, split };
}

// ---------------------------------------------------------------- allocation sets

/** Current described allocations → the payload that keeps them when a new set replaces the old one. */
export function allocationPayload(allocations) {
  return allocations.map(item => Object.fromEntries(Object.entries({ kind: item.kind, amountCents: item.amountCents,
    budgetLineId: item.incomeId ? null : item.budgetLineId, expenseId: item.expenseId, pairedMovementId: item.pairedMovementId,
    incomeId: item.incomeId, reimbursementId: item.reimbursementId,
    activityId: item.activityId, sectionId: item.sectionId }).filter(([, value]) => value != null)));
}
/** One new part for a movement, validated against what is still unallocated. */
export function newAllocation({ kind, amount, budgetLineId, expenseId, incomeId, reimbursementId }, unallocatedCents) {
  const cents = parseEuros(amount);
  if (!cents || cents <= 0) return { error: 'Indica un import positiu.' };
  if (cents > unallocatedCents) return { error: 'L’import assignat supera l’import disponible del moviment.' };
  if (kind === 'LINK_INCOME') return incomeId ? { allocation: { kind: 'INCOME', amountCents: cents, incomeId } } : { error: 'Tria l’ingrés.' };
  if (kind === 'INCOME' && incomeId) return { allocation: { kind: 'INCOME', amountCents: cents, incomeId } };
  if (kind === 'INCOME' && !budgetLineId) return { error: 'Tria una línia d’ingressos.' };
  if ((kind === 'EXPENSE_SETTLEMENT' || kind === 'EXPENSE_REFUND') && !expenseId) return { error: 'Tria la despesa.' };
  if (kind === 'REIMBURSEMENT_SETTLEMENT') return reimbursementId ? { allocation: { kind, amountCents: cents, reimbursementId } }
    : { error: 'Tria el reemborsament.' };
  return { allocation: { kind, amountCents: cents, ...(kind === 'INCOME' ? { budgetLineId } : { expenseId }) } };
}
/** Expenses a movement can settle (same method, still unpaid) or refund (recognised). */
export function settleableExpenses(expenses, movement, kind) {
  return expenses.filter(expense => expense.status === 'RECOGNISED' && (kind === 'EXPENSE_REFUND'
    || (expense.paymentMethod === movement.positionKind && expense.settledCents < expense.totalCents)));
}

// ---------------------------------------------------------------- incomes

export const INCOME_STATE = {
  PENDING: { label: 'Pendent de conciliar', tone: 'attention' },
  PARTIAL: { label: 'Conciliat en part', tone: 'warning' },
  RECONCILED: { label: 'Conciliat', tone: 'ok' },
  VOID: { label: 'Anul·lat', tone: 'muted' }
};
export const incomeState = code => INCOME_STATE[code] ?? { label: 'Estat desconegut', tone: 'muted' };
const INCOME_STATE_FILTERS = { pendents: 'PENDING', parcials: 'PARTIAL', conciliats: 'RECONCILED', anullats: 'VOID' };
export const INCOME_STATE_CHOICES = [{ value: '', label: 'Tots' }, { value: 'pendents', label: 'Pendents de conciliar' },
  { value: 'parcials', label: 'Conciliats en part' }, { value: 'conciliats', label: 'Conciliats' }, { value: 'anullats', label: 'Anul·lats' }];
export function parseIncomeFilters(query = {}) {
  return {
    estat: INCOME_STATE_FILTERS[query.estat] ? query.estat : '',
    des: DATE.test(query.des ?? '') ? query.des : '',
    fins: DATE.test(query.fins ?? '') ? query.fins : '',
    linia: UUID.test(query.linia ?? '') ? query.linia : ''
  };
}
export function incomeApiQuery(roundId, filters) {
  const params = new URLSearchParams({ roundId });
  if (filters.estat) params.set('state', INCOME_STATE_FILTERS[filters.estat]);
  if (filters.des) params.set('from', filters.des);
  if (filters.fins) params.set('to', filters.fins);
  if (filters.linia) params.set('budgetLineId', filters.linia);
  return params.toString();
}
/** Validate the income form; returns { valid, errors, body } with integer cents. */
export function validateIncome(values, { roundId, maxCents = null } = {}) {
  const errors = {};
  const concept = String(values.concept ?? '').trim();
  if (!concept) errors.concept = 'Escriu un concepte curt.';
  else if (concept.length > 120) errors.concept = 'Màxim 120 caràcters.';
  if (!DATE.test(values.incomeDate ?? '')) errors.incomeDate = 'Indica la data.';
  const total = parseEuros(values.total);
  if (!total || total <= 0) errors.total = 'Indica un import positiu.';
  else if (maxCents !== null && total > maxCents) errors.total = 'L’import assignat supera l’import disponible del moviment.';
  if (!values.budgetLineId) errors.budgetLineId = 'Tria una partida d’ingressos.';
  const valid = !Object.keys(errors).length;
  return { valid, errors, body: valid ? { roundId, incomeDate: values.incomeDate, concept, totalCents: total, budgetLineId: values.budgetLineId,
    ...(values.counterpartyId ? { counterpartyId: values.counterpartyId } : {}) } : null };
}
