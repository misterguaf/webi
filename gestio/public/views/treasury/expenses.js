// Tresoreria · Despeses (3.5G.2A, docs/design/screens/TREASURY_EXPENSES.md): list with server-side
// filters, detail (lines with budget paths, settlements, history), manual creation and recognition.
import { confirmDialog, h, icon, toast } from '../../ui.js';
import { openExpenseForm, receiptPayload } from './expense-form.js';
import { fact, infoRow, markRefocus, restoreFocus, statusBadge } from './movements.js';
import {
  ALLOCATION_KIND, COUNTERPARTY_KIND, EXPENSE_STATUS_CHOICES, EXPENSE_PAYMENT_CHOICES, PAYMENT_METHOD, SETTLEMENT_STATE, budgetPath, budgetTree, canManageExpenses,
  errorCopy, expenseApiQuery, expenseFiltersToQuery, expenseStatus, formatDay, formatEur, formatShortDay, formatInstant, parseExpenseFilters
} from './model.js';

export async function renderExpenseList(root, ctx, query) {
  const filters = parseExpenseFilters(query);
  if (JSON.stringify(expenseFiltersToQuery(filters)) !== JSON.stringify(query)) { ctx.go({ path: ['despeses'], query: expenseFiltersToQuery(filters) }, { replace: true }); return; }
  const round = ctx.summary()?.round;
  if (!round) { root.replaceChildren(h('div', { className: 'activity-surface' }, h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: 'No hi ha cap ronda econòmica oberta.' })))); return; }
  const setFilter = (key, value) => { markRefocus(key); ctx.go({ path: ['despeses'], query: expenseFiltersToQuery({ ...filters, [key]: value }) }, { replace: true }); };
  const lineSelect = h('select', { dataset: { filter: 'linia' }, attrs: { 'aria-label': 'Línia del pressupost' }, on: { change: event => setFilter('linia', event.target.value) } }, h('option', { text: 'Totes les línies', attrs: { value: '' } }));
  const partySelect = h('select', { dataset: { filter: 'tercer' }, attrs: { 'aria-label': 'Tercer' }, on: { change: event => setFilter('tercer', event.target.value) } }, h('option', { text: 'Tots els tercers', attrs: { value: '' } }));
  const date = (key, label) => h('label', { className: 'select-field date-field' }, h('span', { text: label }),
    h('input', { dataset: { filter: key }, attrs: { type: 'date', value: filters[key] }, on: { change: event => setFilter(key, event.target.value) } }));
  const create = canManageExpenses(ctx.caps()) ? h('button', { className: 'btn btn-primary', attrs: { type: 'button' },
    on: { click: () => void openExpenseForm({ ctx, onDone: created => { void ctx.refreshSummary(); ctx.go({ path: ['despeses', created.id] }); } }) } }, icon('plus'), 'Nova despesa') : null;
  const toolbar = h('div', { className: 'activity-toolbar treasury-toolbar' },
    h('div', { className: 'toolbar-row' },
      h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Estat' } }, EXPENSE_STATUS_CHOICES.map(choice =>
        h('button', { className: 'filter-chip', dataset: choice.value === filters.estat ? { filter: 'estat' } : {}, text: choice.label, attrs: { type: 'button', 'aria-pressed': String(choice.value === filters.estat) },
          on: { click: () => setFilter('estat', choice.value) } }))), create),
    h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Qui ha pagat' } }, EXPENSE_PAYMENT_CHOICES.map(choice =>
      h('button', { className: 'filter-chip', text: choice.label, attrs: { type: 'button', 'aria-pressed': String(choice.value === filters.pagament) },
        on: { click: () => setFilter('pagament', choice.value) } }))),
    h('div', { className: 'activity-filters' },
      h('label', { className: 'select-field' }, lineSelect), h('label', { className: 'select-field' }, partySelect), date('des', 'Des de'), date('fins', 'Fins a')));
  const listNode = h('div', { className: 'activity-surface tx-surface' }, h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
  root.replaceChildren(toolbar, listNode);
  restoreFocus(toolbar);
  // Filter options (names only) load beside the list; a failure only leaves the selects empty.
  void ctx.call(`/api/finance/rounds/${round.id}/assignable-lines?nature=EXPENSE`).then(data => {
    lineSelect.append(...budgetTree(data.lines).map(node => h('option', { text: `${'· '.repeat(node.depth)}${node.code} ${node.name}`, attrs: { value: node.id, selected: node.id === filters.linia } })));
  }).catch(() => {});
  void ctx.call('/api/finance/counterparties').then(data => {
    partySelect.append(...data.counterparties.map(row => h('option', { text: `${row.displayName} · ${COUNTERPARTY_KIND[row.kind]}`, attrs: { value: row.id, selected: row.id === filters.tercer } })));
  }).catch(() => {});
  try {
    const { expenses } = await ctx.call(`/api/finance/expenses?${expenseApiQuery(round.id, filters)}`);
    if (!expenses.length) {
      const filtered = Object.values(filters).some(Boolean);
      listNode.replaceChildren(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: filtered ? 'Cap despesa coincideix amb els filtres.' : 'Encara no hi ha despeses en esta ronda.' }),
        filtered ? h('button', { className: 'btn btn-secondary', text: 'Neteja els filtres', attrs: { type: 'button' }, on: { click: () => ctx.go({ path: ['despeses'] }, { replace: true }) } }) : null));
      return;
    }
    const owing = new Map();
    for (const row of expenses) if (row.reimbursementStatus === 'APPROVED' && row.outstandingCents > 0) {
      const item = owing.get(row.advancedById) ?? { name: row.advancedByName, count: 0, cents: 0 };
      item.count++; item.cents += row.outstandingCents; owing.set(row.advancedById, item);
    }
    listNode.replaceChildren(
      ...(owing.size ? [h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Pendents de reemborsar' }),
        h('ul', { className: 'allocation-list', attrs: { role: 'list' } }, [...owing.values()].map(item => h('li', { className: 'allocation-item' },
          h('span', { className: 'allocation-target', text: item.name ?? 'Scouter' }),
          h('span', { className: 'tx-sub', text: `${item.count} despeses` }),
          h('strong', { className: 'allocation-amount', text: formatEur(item.cents) })))))] : []),
      h('div', { className: 'tx-head ex-head', attrs: { 'aria-hidden': 'true' } }, ['Data', 'Concepte', 'Línia', 'Import', 'Estat'].map(text => h('span', { text }))),
      h('ul', { className: 'tx-list', attrs: { role: 'list', 'aria-label': 'Despeses' } }, expenses.map(row => expenseRow(row, ctx))));
  } catch (error) {
    listNode.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }),
      h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void renderExpenseList(root, ctx, query) } })));
  }
}
function expenseRow(row, ctx) {
  const status = expenseStatus(row.status);
  const line = row.mainLine ? `${budgetPath(row.mainLine)}${row.lineCount > 1 ? ` i ${row.lineCount - 1} més` : ''}` : 'Sense línies';
  const settlement = row.reimbursementId ? (row.outstandingCents === 0 ? 'Reemborsada' : row.reimbursedCents > 0
    ? `Reemborsada en part · pendent ${formatEur(row.outstandingCents)}` : `Pendent de reemborsar · ${formatEur(row.outstandingCents)}`)
    : row.status === 'RECOGNISED' ? (row.settledCents >= row.totalCents ? 'Pagada' : row.settledCents > 0
      ? `Pagada en part · ${formatEur(row.settledCents)}` : 'Sense pagament vinculat') : null;
  return h('li', { className: 'tx-row ex-row' },
    h('span', { className: 'tx-date', text: formatShortDay(row.expenseDate) }),
    h('a', { className: 'tx-label', attrs: { href: `#/tresoreria/despeses/${row.id}` }, on: { click: event => { event.preventDefault(); ctx.go({ path: ['despeses', row.id] }); } } },
      h('span', { className: 'tx-label-text', text: row.concept ?? row.supplierLabel ?? row.counterpartyName ?? 'Despesa' }),
      h('span', { className: 'tx-sub', text: [row.counterpartyName ?? row.supplierLabel, row.advancedByName ? `Avançada per ${row.advancedByName}` : PAYMENT_METHOD[row.paymentMethod]].filter(Boolean).join(' · ') })),
    h('span', { className: 'tx-line', text: line }),
    h('span', { className: 'amount', text: formatEur(row.totalCents) }),
    h('span', { className: 'tx-status' }, statusBadge(status), settlement ? h('span', { className: 'tx-sub', text: settlement }) : null));
}

export async function renderExpenseDetail(root, ctx, id) {
  root.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2, 3].map(() => h('span', { className: 'skeleton-line' }))));
  const back = h('a', { className: 'back-link', attrs: { href: '#/tresoreria/despeses' }, on: { click: event => { event.preventDefault(); ctx.back('despeses'); } } }, icon('arrow-left'), 'Despeses');
  let data;
  try { data = await ctx.call(`/api/finance/expenses/${id}`); }
  catch (error) { root.replaceChildren(back, h('div', { className: 'activity-surface' }, h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) })))); return; }
  const e = data.expense, status = expenseStatus(e.status);
  const reload = () => { void ctx.refreshSummary(); return renderExpenseDetail(root, ctx, id); };
  const actions = [];
  if (e.status === 'PROPOSED' && data.evidence.some(item => !item.purged) && canManageExpenses(ctx.caps())) actions.push(h('button', { className: 'btn btn-primary', text: 'Reconeix la despesa', attrs: { type: 'button' }, on: { click: async event => {
    const trigger = event.currentTarget;
    if (!await confirmDialog({ title: 'Reconéixer la despesa?', body: `A partir d’ara ${formatEur(e.totalCents)} comptaran com a despesa de la ronda, una sola vegada.`, confirm: 'Reconeix' })) return;
    trigger.setAttribute('aria-busy', 'true');
    try { await ctx.call(`/api/finance/expenses/${e.id}/recognise`, { method: 'POST', body: JSON.stringify({ expectedVersion: e.version }) }); toast('Despesa reconeguda'); await reload(); }
    catch (error) { trigger.removeAttribute('aria-busy'); toast(errorCopy(error), { tone: 'danger', timeout: 6000 }); }
  } } }));
  const linesTotal = data.lines.reduce((sum, line) => sum + line.amountCents, 0);
  root.replaceChildren(back,
    h('header', { className: 'detail-header treasury-detail-header' },
      h('div', { className: 'detail-title-row' }, h('h2', { className: 'detail-title', text: e.concept ?? e.supplierLabel ?? e.counterpartyName ?? 'Despesa', attrs: { tabindex: '-1' } }), statusBadge(status)),
      h('p', { className: 'detail-context', text: [e.counterpartyName ?? e.supplierLabel, e.advancedByName ? `Avançada per ${e.advancedByName}` : null].filter(Boolean).join(' · ') || 'Sense tercer' }),
      e.status === 'PROPOSED' ? h('p', { className: 'field-hint', text: 'Proposta: encara no compta en les xifres de la ronda.' }) : null,
      actions.length ? h('div', { className: 'detail-actions' }, actions) : null),
    h('div', { className: 'summary-strip' },
      fact('Total', formatEur(e.totalCents)), fact('Data', formatDay(e.expenseDate)), fact('Mitjà', PAYMENT_METHOD[e.paymentMethod] ?? ''),
      e.status === 'RECOGNISED' ? fact(e.paymentMethod === 'ADVANCED' ? 'Reemborsament' : 'Pagament',
        data.reimbursement ? data.reimbursement.paymentState === 'PAID' ? 'Reemborsat' : data.reimbursement.paymentState === 'PARTIAL'
          ? 'Reemborsat en part' : 'Pendent de reemborsar' : SETTLEMENT_STATE[e.settlementState] ?? '') : fact('Estat', status.label)),
    h('div', { className: 'activity-surface info-surface' },
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Línies del pressupost' }),
        h('ul', { className: 'allocation-list', attrs: { role: 'list' } }, data.lines.map(line => h('li', { className: 'allocation-item' },
          h('span', { className: 'allocation-kind', text: line.budgetLine?.code ?? '' }), h('span', { className: 'allocation-target', text: budgetPath(line.budgetLine) }),
          h('span', { className: 'allocation-amount', text: formatEur(line.amountCents) })))),
        linesTotal !== e.totalCents ? h('p', { className: 'field-error', text: `Les línies sumen ${formatEur(linesTotal)} i el total és ${formatEur(e.totalCents)}.` }) : null),
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Pagaments i devolucions' }),
        data.settlements.length ? h('ul', { className: 'allocation-list', attrs: { role: 'list' } }, data.settlements.map(item => h('li', { className: 'allocation-item' },
          h('span', { className: 'allocation-kind', text: ALLOCATION_KIND[item.kind] }),
          h('a', { className: 'allocation-target', attrs: { href: `#/tresoreria/moviments/${item.movementId}` }, text: `${formatDay(item.operationDate)} · ${item.positionName} · ${formatEur(item.movementAmountCents, { signed: true })}`,
            on: { click: event => { event.preventDefault(); ctx.go({ path: ['moviments', item.movementId] }); } } }),
          h('span', { className: 'allocation-amount', text: formatEur(item.amountCents) }))))
          : h('p', { className: 'empty-detail', text: 'Cap moviment vinculat.' })),
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Justificants' }),
        data.evidence.some(item => !item.purged) ? h('ul', { className: 'allocation-list', attrs: { role: 'list' } }, data.evidence.filter(item => !item.purged).map(item =>
          h('li', { className: 'allocation-item' }, h('span', { className: 'allocation-target', text: `${item.mime === 'application/pdf' ? 'PDF' : 'Imatge'} · ${formatInstant(item.createdAt)}` }),
            h('a', { className: 'link-button', text: 'Veure', attrs: { href: `/api/finance/expense-evidence/${item.id}?mode=view`, target: '_blank', rel: 'noopener' } }),
            h('a', { className: 'link-button', text: 'Descarrega', attrs: { href: `/api/finance/expense-evidence/${item.id}?mode=download` } }))))
          : h('p', { className: 'empty-detail', text: 'Sense justificant adjunt. Cal adjuntar-lo abans de reconéixer la despesa.' }),
        ['PROPOSED', 'RECOGNISED'].includes(e.status) && canManageExpenses(ctx.caps()) ? h('label', { className: 'field-label' }, 'Afig justificant',
          h('input', { attrs: { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp' },
            on: { change: async event => {
              const file = event.currentTarget.files?.[0]; if (!file) return;
              try { await ctx.call(`/api/finance/expenses/${e.id}/evidence`, { method: 'POST', body: JSON.stringify(await receiptPayload(file)) });
                toast('Justificant adjunt'); await reload(); }
              catch (error) { toast(error instanceof Error && !error.code && !error.status ? error.message : errorCopy(error), { tone: 'danger' }); }
            } } })) : null),
      data.reimbursement ? h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Reemborsament' }),
        h('dl', { className: 'info-list' }, infoRow('Beneficiari', e.advancedByName ?? 'Scouter'),
          infoRow('Aprovat', formatEur(data.reimbursement.amountCents)), infoRow('Reemborsat', formatEur(data.reimbursement.settledCents)),
          infoRow('Pendent', formatEur(data.reimbursement.outstandingCents)))) : null,
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Historial' }),
        h('dl', { className: 'info-list' },
          infoRow('Creada', formatInstant(e.createdAt)),
          e.recognizedAt ? infoRow('Reconeguda', formatInstant(e.recognizedAt)) : null,
          e.rejectedAt ? infoRow('Rebutjada', formatInstant(e.rejectedAt)) : null,
          e.voidedAt ? infoRow('Anul·lada', formatInstant(e.voidedAt)) : null,
          ...data.revisions.map(rev => infoRow(`Revisió ${formatInstant(rev.changedAt)}`,
            [rev.previousConcept ? `Concepte anterior: ${rev.previousConcept}` : null, `Total anterior: ${formatEur(rev.previousTotalCents)}`, `Data anterior: ${formatDay(rev.previousExpenseDate)}`].filter(Boolean).join(' · ')))))));
  root.querySelector('.detail-title')?.focus({ preventScroll: true });
}
