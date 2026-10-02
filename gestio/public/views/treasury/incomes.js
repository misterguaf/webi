// Tresoreria · Ingressos (3.5G.2A extension, docs/design/screens/TREASURY_INCOMES.md): general incomes as
// economic facts. Reconciliation is derived from the movements that collect them; it can start from the
// movement (Classifica) or from here (Concilia), with the same allocation endpoint.
import { confirmDialog, h, icon, toast } from '../../ui.js';
import { field, moneyInput, openDrawer } from './forms.js';
import { openIncomeForm } from './income-form.js';
import { fact, infoRow, markRefocus, restoreFocus, statusBadge } from './movements.js';
import {
  INCOME_STATE_CHOICES, allocationPayload, budgetPath, budgetTree, canClassify, canManageIncomes, centsInput, errorCopy, expenseFiltersToQuery,
  formatDay, formatEur, formatInstant, formatShortDay, incomeApiQuery, incomeState, newAllocation, parseIncomeFilters
} from './model.js';

export async function renderIncomeList(root, ctx, query) {
  const filters = parseIncomeFilters(query);
  if (JSON.stringify(expenseFiltersToQuery(filters)) !== JSON.stringify(query)) { ctx.go({ path: ['ingressos'], query: expenseFiltersToQuery(filters) }, { replace: true }); return; }
  const round = ctx.summary()?.round;
  if (!round) { root.replaceChildren(h('div', { className: 'activity-surface' }, h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: 'No hi ha cap ronda econòmica oberta.' })))); return; }
  const setFilter = (key, value) => { markRefocus(key); ctx.go({ path: ['ingressos'], query: expenseFiltersToQuery({ ...filters, [key]: value }) }, { replace: true }); };
  const lineSelect = h('select', { dataset: { filter: 'linia' }, attrs: { 'aria-label': 'Partida' }, on: { change: event => setFilter('linia', event.target.value) } },
    h('option', { text: 'Totes les partides', attrs: { value: '' } }));
  const date = (key, label) => h('label', { className: 'select-field date-field' }, h('span', { text: label }),
    h('input', { dataset: { filter: key }, attrs: { type: 'date', value: filters[key] }, on: { change: event => setFilter(key, event.target.value) } }));
  const create = canManageIncomes(ctx.caps()) ? h('button', { className: 'btn btn-primary', attrs: { type: 'button' },
    on: { click: () => void openIncomeForm({ ctx, onDone: created => { void ctx.refreshSummary(); ctx.go({ path: ['ingressos', created.id] }); } }) } }, icon('plus'), 'Nou ingrés') : null;
  const toolbar = h('div', { className: 'activity-toolbar treasury-toolbar' },
    h('div', { className: 'toolbar-row' },
      h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Estat' } }, INCOME_STATE_CHOICES.map(choice =>
        h('button', { className: 'filter-chip', dataset: choice.value === filters.estat ? { filter: 'estat' } : {}, text: choice.label,
          attrs: { type: 'button', 'aria-pressed': String(choice.value === filters.estat) }, on: { click: () => setFilter('estat', choice.value) } }))), create),
    h('div', { className: 'activity-filters' }, h('label', { className: 'select-field' }, lineSelect), date('des', 'Des de'), date('fins', 'Fins a')));
  const listNode = h('div', { className: 'activity-surface tx-surface' }, h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
  root.replaceChildren(toolbar, listNode);
  restoreFocus(toolbar);
  void ctx.call(`/api/finance/rounds/${round.id}/assignable-lines?nature=INCOME`).then(data => {
    lineSelect.append(...budgetTree(data.lines).map(node => h('option', { text: `${'· '.repeat(node.depth)}${node.code} ${node.name}`, attrs: { value: node.id, selected: node.id === filters.linia } })));
  }).catch(() => {});
  try {
    const { incomes } = await ctx.call(`/api/finance/incomes?${incomeApiQuery(round.id, filters)}`);
    if (!incomes.length) {
      const filtered = Object.values(filters).some(Boolean);
      listNode.replaceChildren(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: filtered ? 'Cap ingrés coincideix amb els filtres.' : 'Encara no hi ha ingressos en esta ronda.' }),
        filtered ? h('button', { className: 'btn btn-secondary', text: 'Neteja els filtres', attrs: { type: 'button' }, on: { click: () => ctx.go({ path: ['ingressos'] }, { replace: true }) } }) : null));
      return;
    }
    listNode.replaceChildren(
      h('div', { className: 'tx-head ex-head', attrs: { 'aria-hidden': 'true' } }, ['Data', 'Concepte', 'Partida', 'Import', 'Estat'].map(text => h('span', { text }))),
      h('ul', { className: 'tx-list', attrs: { role: 'list', 'aria-label': 'Ingressos' } }, incomes.map(row => h('li', { className: 'tx-row ex-row' },
        h('span', { className: 'tx-date', text: formatShortDay(row.incomeDate) }),
        h('a', { className: 'tx-label', attrs: { href: `#/tresoreria/ingressos/${row.id}` }, on: { click: event => { event.preventDefault(); ctx.go({ path: ['ingressos', row.id] }); } } },
          h('span', { className: 'tx-label-text', text: row.concept }), row.counterpartyName ? h('span', { className: 'tx-sub', text: row.counterpartyName }) : null),
        h('span', { className: 'tx-line', text: budgetPath(row.budgetLine) }),
        h('span', { className: 'amount amount-in', text: formatEur(row.totalCents) }),
        h('span', { className: 'tx-status' }, statusBadge(incomeState(row.state)),
          row.state === 'PARTIAL' ? h('span', { className: 'tx-sub', text: `Pendent ${formatEur(row.pendingCents)}` }) : null)))));
  } catch (error) {
    listNode.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }),
      h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void renderIncomeList(root, ctx, query) } })));
  }
}

export async function renderIncomeDetail(root, ctx, id) {
  root.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2, 3].map(() => h('span', { className: 'skeleton-line' }))));
  const back = h('a', { className: 'back-link', attrs: { href: '#/tresoreria/ingressos' }, on: { click: event => { event.preventDefault(); ctx.back('ingressos'); } } }, icon('arrow-left'), 'Ingressos');
  let data;
  try { data = await ctx.call(`/api/finance/incomes/${id}`); }
  catch (error) { root.replaceChildren(back, h('div', { className: 'activity-surface' }, h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) })))); return; }
  const income = data.income, state = incomeState(income.state);
  const reload = () => { void ctx.refreshSummary(); return renderIncomeDetail(root, ctx, id); };
  const open = income.state === 'PENDING' || income.state === 'PARTIAL';
  const actions = [];
  if (open && canClassify(ctx.caps()) && data.candidates.length)
    actions.push(h('button', { className: 'btn btn-primary', text: 'Concilia amb un moviment', attrs: { type: 'button' }, on: { click: () => openReconcile(data, ctx, reload) } }));
  if (income.state === 'PENDING' && canManageIncomes(ctx.caps()))
    actions.push(h('button', { className: 'btn btn-secondary', text: 'Anul·la l’ingrés', attrs: { type: 'button' }, on: { click: async event => {
      const trigger = event.currentTarget;
      if (!await confirmDialog({ title: 'Anul·lar l’ingrés?', body: 'L’ingrés no s’esborra: queda anul·lat i fora de les xifres. Fes-ho només si es va registrar per error.', confirm: 'Anul·la', tone: 'danger' })) return;
      trigger.setAttribute('aria-busy', 'true');
      try { await ctx.call(`/api/finance/incomes/${id}/void`, { method: 'POST', body: JSON.stringify({ expectedVersion: income.version }) }); toast('Ingrés anul·lat'); await reload(); }
      catch (error) { trigger.removeAttribute('aria-busy'); toast(errorCopy(error), { tone: 'danger', timeout: 6000 }); }
    } } }));
  const status = income.state === 'VOID' ? 'Aquest ingrés està anul·lat i no compta.'
    : income.state === 'RECONCILED' ? `Conciliat amb ${data.movements.length === 1 ? `el moviment del ${formatShortDay(data.movements[0].operationDate)}` : `${data.movements.length} moviments`}.`
      : `Esperem encara ${income.state === 'PARTIAL' ? 'cobraments' : 'un moviment bancari'} de ${formatEur(income.pendingCents)}.`;
  root.replaceChildren(...[back,
    h('header', { className: 'detail-header treasury-detail-header' },
      h('div', { className: 'detail-title-row' }, h('h2', { className: 'detail-title', text: income.concept, attrs: { tabindex: '-1' } }), statusBadge(state)),
      h('p', { className: 'detail-context', text: status }),
      actions.length ? h('div', { className: 'detail-actions' }, actions) : null),
    h('div', { className: 'summary-strip' },
      fact('Import', formatEur(income.totalCents)), fact('Data', formatDay(income.incomeDate)),
      fact('Conciliat', formatEur(income.reconciledCents)), fact('Pendent', formatEur(income.pendingCents))),
    h('div', { className: 'activity-surface info-surface' },
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Dades' }),
        h('dl', { className: 'info-list' }, infoRow('Partida', budgetPath(income.budgetLine)), infoRow('Qui aporta', income.counterpartyName ?? 'Sense tercer'))),
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Moviments que el cobren' }),
        data.movements.length ? h('ul', { className: 'allocation-list', attrs: { role: 'list' } }, data.movements.map(item => h('li', { className: 'allocation-item' },
          h('span', { className: 'allocation-kind', text: formatDay(item.operationDate) }),
          h('a', { className: 'allocation-target', attrs: { href: `#/tresoreria/moviments/${item.movementId}` }, text: `${item.positionName} · ${formatEur(item.movementAmountCents, { signed: true })}`,
            on: { click: event => { event.preventDefault(); ctx.go({ path: ['moviments', item.movementId] }); } } }),
          h('span', { className: 'allocation-amount', text: formatEur(item.amountCents) }))))
          : h('p', { className: 'empty-detail', text: 'Cap moviment vinculat encara.' })),
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Historial' }),
        h('dl', { className: 'info-list' }, infoRow('Registrat', formatInstant(income.createdAt)),
          income.voidedAt ? infoRow('Anul·lat', formatInstant(income.voidedAt)) : null,
          ...data.revisions.map(rev => infoRow(`Correcció ${formatInstant(rev.changedAt)}`,
            [`Concepte anterior: ${rev.previousConcept}`, `Import anterior: ${formatEur(rev.previousTotalCents)}`,
              rev.previousBudgetLine ? `Partida anterior: ${budgetPath(rev.previousBudgetLine)}` : null].filter(Boolean).join(' · '))))))].filter(Boolean));
  root.querySelector('.detail-title')?.focus({ preventScroll: true });
}

/** Concilia from the income: choose an incoming movement; its current parts are kept and one is added. */
function openReconcile(data, ctx, onDone) {
  const income = data.income;
  const radios = data.candidates.map((c, index) => h('label', { className: 'candidate' },
    h('input', { attrs: { type: 'radio', name: 'movement', value: c.id, checked: index === 0 }, dataset: { unallocated: String(c.unallocatedCents) } }),
    h('span', { className: 'candidate-name', text: `${formatEur(c.amountCents, { signed: true })} · ${formatShortDay(c.operationDate)} · ${c.positionName}` }),
    h('span', { className: 'candidate-meta', text: `${c.label} · per assignar ${formatEur(c.unallocatedCents)}` })));
  const money = moneyInput(centsInput(Math.min(income.pendingCents, data.candidates[0]?.unallocatedCents ?? income.pendingCents)), { 'aria-label': 'Import a conciliar' });
  const content = [
    h('p', { className: 'form-notice', text: `Pendent de l’ingrés: ${formatEur(income.pendingCents)}. Es mostren entrades sense classificar del tot; primer les de l’import exacte.` }),
    h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label', text: 'Moviment bancari' }), radios),
    field('amount', 'Import a conciliar', money)];
  const drawer = openDrawer({ title: 'Concilia l’ingrés', content, primary: 'Concilia', onSubmit: async () => {
    const chosen = drawer.submit.form.querySelector('input[name="movement"]:checked');
    if (!chosen) { drawer.showError('Tria el moviment.'); return false; }
    const limit = Math.min(income.pendingCents, Number(chosen.dataset.unallocated));
    const result = newAllocation({ kind: 'LINK_INCOME', amount: money.querySelector('input').value, incomeId: income.id }, limit);
    if (result.error) { drawer.showError(result.error); return false; }
    const movement = await ctx.call(`/api/finance/movements/${chosen.value}`);
    await ctx.call(`/api/finance/movements/${chosen.value}/allocations`, { method: 'POST', body: JSON.stringify({ expectedVersion: movement.movement.allocationVersion,
      allocations: [...allocationPayload(movement.allocations), result.allocation] }) });
    toast('Ingrés conciliat'); await onDone?.(); return true;
  } });
}
