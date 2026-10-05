// Tresoreria · Moviments (3.5G.2A, docs/design/screens/TREASURY_MOVEMENTS.md): list with server-side
// filters, detail, classification (enabled kinds only), correction keeping history, duplicate review and
// the audited, on-demand original description. Nothing here is a security boundary.
import { confirmDialog, h, icon, toast } from '../../ui.js';
import { field, moneyInput, openDrawer, budgetLineButton } from './forms.js';
import { openExpenseForm } from './expense-form.js';
import { openIncomeForm } from './income-form.js';
import {
  ALLOCATION_KIND, BATCH_FORMAT, BATCH_STATUS, DIRECTION_CHOICES, MOVEMENT_STATUS_CHOICES, ORIGIN, POSITION_KIND, allocationLabel, allocationPayload,
  budgetPath, canClassify, canReveal, centsInput, classificationLine, classificationOptions, errorCopy, formatDay, formatEur, formatShortDay, formatInstant,
  movementApiQuery, movementFiltersToQuery, movementStatus, newAllocation, parseEuros, parseMovementFilters, settleableExpenses
} from './model.js';

export const statusBadge = ({ label, tone }) => h('span', { className: `badge tone-${tone}`, text: label });
const amountNode = cents => h('span', { className: `amount ${cents < 0 ? 'amount-out' : 'amount-in'}`, text: formatEur(cents, { signed: true }) });

// ---------------------------------------------------------------- list

// A filter change re-renders the list; focus returns to the control that changed it.
let refocus = null;
export function restoreFocus(toolbar) {
  if (!refocus) return;
  const control = toolbar.querySelector(`[data-filter="${refocus}"]`);
  refocus = null;
  if (!control) return;
  control.focus({ preventScroll: true });
  if (control.type === 'search') control.setSelectionRange(control.value.length, control.value.length);
}
export const markRefocus = key => { refocus = key; };
export async function renderMovementList(root, ctx, query) {
  const filters = parseMovementFilters(query);
  if (JSON.stringify(movementFiltersToQuery(filters)) !== JSON.stringify(query)) { ctx.go({ path: ['moviments'], query: movementFiltersToQuery(filters) }, { replace: true }); return; }
  const setFilter = (key, value) => { refocus = key; ctx.go({ path: ['moviments'], query: movementFiltersToQuery({ ...filters, [key]: value }) }, { replace: true }); };
  const positions = ctx.summary()?.positionOptions ?? [];
  const search = h('input', { dataset: { filter: 'q' }, attrs: { type: 'search', value: filters.q, placeholder: 'Busca per descripció o referència', 'aria-label': 'Busca moviments', maxlength: 80 } });
  let debounce = null;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => setFilter('q', search.value.trim()), 350); });
  const select = (key, options, label) => h('label', { className: 'select-field' }, h('span', { className: 'visually-hidden', text: label }),
    h('select', { dataset: { filter: key }, attrs: { 'aria-label': label }, on: { change: event => setFilter(key, event.target.value) } },
      options.map(option => h('option', { text: option.label, attrs: { value: option.value, selected: option.value === filters[key] } }))));
  const date = (key, label) => h('label', { className: 'select-field date-field' }, h('span', { text: label }),
    h('input', { dataset: { filter: key }, attrs: { type: 'date', value: filters[key] }, on: { change: event => setFilter(key, event.target.value) } }));
  const toolbar = h('div', { className: 'activity-toolbar treasury-toolbar' },
    h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Estat' } }, MOVEMENT_STATUS_CHOICES.map(choice =>
      h('button', { className: 'filter-chip', dataset: choice.value === filters.estat ? { filter: 'estat' } : {}, text: choice.label, attrs: { type: 'button', 'aria-pressed': String(choice.value === filters.estat) },
        on: { click: () => setFilter('estat', choice.value) } }))),
    h('div', { className: 'activity-filters' },
      h('div', { className: 'search-field' }, icon('search'), search),
      select('posicio', [{ value: '', label: 'Totes les posicions' }, ...positions.map(p => ({ value: p.id, label: p.name }))], 'Posició'),
      select('sentit', DIRECTION_CHOICES, 'Sentit'), date('des', 'Des de'), date('fins', 'Fins a')));
  const listNode = h('div', { className: 'activity-surface tx-surface' }, skeleton());
  root.replaceChildren(toolbar, listNode);
  restoreFocus(toolbar);
  const rows = [];
  let cursor = null;
  const more = h('button', { className: 'btn btn-secondary list-more', text: 'Carrega’n més', attrs: { type: 'button', hidden: true }, on: { click: () => void page() } });
  async function page() {
    more.setAttribute('aria-busy', 'true');
    try {
      const qs = movementApiQuery(filters);
      const data = await ctx.call(`/api/finance/movements?${[qs, cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&')}`);
      rows.push(...data.movements); cursor = data.nextCursor ?? null;
      paint();
    } catch (error) {
      listNode.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }),
        h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void renderMovementList(root, ctx, query) } })));
    } finally { more.removeAttribute('aria-busy'); }
  }
  function paint() {
    if (!rows.length) {
      const filtered = Object.values(filters).some(Boolean);
      listNode.replaceChildren(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: filtered ? 'Cap moviment coincideix amb els filtres.' : 'Encara no hi ha moviments.' }),
        filtered ? h('button', { className: 'btn btn-secondary', text: 'Neteja els filtres', attrs: { type: 'button' }, on: { click: () => ctx.go({ path: ['moviments'] }, { replace: true }) } }) : null));
      return;
    }
    more.hidden = !cursor;
    listNode.replaceChildren(
      h('div', { className: 'tx-head', attrs: { 'aria-hidden': 'true' } }, ['Data', 'Posició', 'Descripció', 'Import', 'Estat', ''].map(text => h('span', { text }))),
      h('ul', { className: 'tx-list', attrs: { role: 'list', 'aria-label': 'Moviments' } }, rows.map(row => movementRow(row, ctx))), more);
  }
  await page();
}
function movementRow(row, ctx) {
  const status = movementStatus(row.status), detail = classificationLine(row);
  const open = event => { if (event) event.preventDefault(); ctx.go({ path: ['moviments', row.id] }); };
  const actionable = canClassify(ctx.caps()) && (row.status === 'PENDING' || row.status === 'PARTIAL');
  const action = row.status === 'POSSIBLE_DUPLICATE' && canClassify(ctx.caps()) ? 'Revisa'
    : actionable ? 'Classifica' : 'Obri';
  return h('li', { className: 'tx-row' },
    h('span', { className: 'tx-date', text: formatShortDay(row.operationDate) }),
    h('span', { className: 'tx-position', text: row.positionName }),
    h('a', { className: 'tx-label', attrs: { href: `#/tresoreria/moviments/${row.id}` }, on: { click: open } },
      h('span', { className: 'tx-label-text', text: row.label }),
      detail ? h('span', { className: 'tx-sub', text: detail }) : null),
    amountNode(row.amountCents),
    h('span', { className: 'tx-status' }, statusBadge(status),
      row.status === 'PARTIAL' ? h('span', { className: 'tx-sub', text: `Pendent ${formatEur(row.unallocatedCents)}` }) : null),
    h('span', { className: 'tx-action' }, h('button', { className: `btn btn-small ${action === 'Obri' ? 'btn-quiet' : 'btn-secondary'}`, text: action,
      attrs: { type: 'button', 'aria-label': `${action}: ${row.label}, ${formatEur(row.amountCents, { signed: true })}` },
      on: { click: () => action === 'Classifica' ? void quickClassify(row, ctx) : open() } })));
}
async function quickClassify(row, ctx) {
  try { const detail = await ctx.call(`/api/finance/movements/${row.id}`); openClassify(detail, ctx, () => ctx.go({ path: ['moviments', row.id] })); }
  catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
}
const skeleton = () => h('ul', { className: 'skeleton-rows', attrs: { 'aria-busy': 'true', 'aria-label': 'Carregant' } },
  [1, 2, 3, 4].map(() => h('li', { className: 'skeleton-row' }, h('span', { className: 'skeleton-lines' }, h('span', { className: 'skeleton-line' }), h('span', { className: 'skeleton-line short' })))));

// ---------------------------------------------------------------- detail

export async function renderMovementDetail(root, ctx, id) {
  root.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2, 3].map(() => h('span', { className: 'skeleton-line' }))));
  let data;
  try { data = await ctx.call(`/api/finance/movements/${id}`); }
  catch (error) {
    root.replaceChildren(backLink(ctx), h('div', { className: 'activity-surface' }, h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }))));
    return;
  }
  const reload = () => { void ctx.refreshSummary(); return renderMovementDetail(root, ctx, id); };
  const m = data.movement, status = movementStatus(m.status), caps = ctx.caps();
  const actions = [];
  const unallocated = m.state === 'ACTIVE' && m.unallocatedCents > 0;
  const privateReimbursements = data.allocations.some(item => item.kind === 'REIMBURSEMENT_SETTLEMENT') && !caps.treasury?.readExpenses;
  if (canClassify(caps) && !privateReimbursements && m.state === 'ACTIVE' && unallocated && !m.reviewFlag)
    actions.push(h('button', { className: 'btn btn-primary', text: 'Classifica', attrs: { type: 'button' }, on: { click: () => openClassify(data, ctx, reload) } }));
  if (canClassify(caps) && !privateReimbursements && m.state === 'ACTIVE' && data.allocations.length)
    actions.push(h('button', { className: 'btn btn-secondary', text: 'Corregeix classificació', attrs: { type: 'button' }, on: { click: () => openCorrection(data, ctx, reload) } }));
  if (canClassify(caps) && caps.treasury?.readExpenses && m.state === 'ACTIVE' && m.positionKind === 'BANK' &&
      data.allocations.some(item => item.kind === 'REIMBURSEMENT_SETTLEMENT'))
    actions.push(h('button', { className: 'btn btn-secondary', text: 'Reassigna reemborsaments', attrs: { type: 'button' },
      on: { click: () => void openReimbursementReassignment(data, ctx, reload) } }));
  root.replaceChildren(...[
    backLink(ctx),
    h('header', { className: 'detail-header treasury-detail-header' },
      h('div', { className: 'detail-title-row' }, h('h2', { className: 'detail-title', text: formatEur(m.amountCents, { signed: true }), attrs: { tabindex: '-1' } }), statusBadge(status)),
      h('p', { className: 'detail-context', text: `${m.label} · ${m.positionName}` }),
      actions.length ? h('div', { className: 'detail-actions' }, actions) : null),
    h('div', { className: 'summary-strip' },
      fact('Data', formatDay(m.operationDate)), fact('Posició', `${m.positionName} · ${POSITION_KIND[m.positionKind] ?? ''}`),
      fact('Assignat', formatEur(m.allocatedCents)), fact('Pendent', formatEur(m.state === 'ACTIVE' ? m.unallocatedCents : 0))),
    duplicateBlock(data, ctx, reload),
    h('div', { className: 'activity-surface info-surface' },
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Descripció' }),
        h('dl', { className: 'info-list' },
          infoRow('Descripció', m.label), m.reference ? infoRow('Referència', m.reference) : null,
          m.valueDate ? infoRow('Data valor', formatDay(m.valueDate)) : null,
          infoRow('Origen', `${ORIGIN[m.origin] ?? m.origin}${m.importedAt ? ` · ${formatInstant(m.importedAt)}` : ''}`)),
        revealBlock(m, ctx)),
      h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Classificació actual' }),
        data.allocations.length ? allocationList(data.allocations, ctx)
          : h('p', { className: 'empty-detail', text: m.state === 'ACTIVE' ? 'Encara no està classificat.' : 'Els moviments anul·lats no es classifiquen.' })),
      data.history.length ? h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Historial de classificació' }),
        h('ol', { className: 'history-list' }, data.history.map(entry => h('li', {},
          h('span', { className: 'history-when', text: entry.replacedAt ? `Substituïda el ${formatInstant(entry.replacedAt)}` : 'Versió anterior' }),
          entry.allocations.length ? h('ul', { className: 'history-items' }, entry.allocations.map(item => h('li', { text: `${allocationLabel(item)} · ${formatEur(item.amountCents)}` })))
            : h('span', { className: 'tx-sub', text: 'Sense classificació' }))))) : null)].filter(Boolean));
  root.querySelector('.detail-title')?.focus({ preventScroll: true });
}
const backLink = ctx => h('a', { className: 'back-link', attrs: { href: '#/tresoreria/moviments' }, on: { click: event => { event.preventDefault(); ctx.back('moviments'); } } }, icon('arrow-left'), 'Moviments');
export const fact = (label, value) => h('div', { className: 'fact' }, h('span', { className: 'fact-label', text: label }), h('span', { className: 'fact-value fact-value-small', text: value }));
export const infoRow = (label, value) => h('div', { className: 'info-row' }, h('dt', { text: label }), h('dd', { text: value }));
function allocationList(allocations, ctx) {
  return h('ul', { className: 'allocation-list', attrs: { role: 'list' } }, allocations.map(item => h('li', { className: 'allocation-item' },
    h('span', { className: 'allocation-kind', text: ALLOCATION_KIND[item.kind] ?? 'Classificació' }),
    h('span', { className: 'allocation-target' },
      item.income ? h('a', { attrs: { href: `#/tresoreria/ingressos/${item.income.id}` }, text: `${item.income.concept} · ${formatDay(item.income.incomeDate)}`,
        on: { click: event => { event.preventDefault(); ctx.go({ path: ['ingressos', item.income.id] }); } } })
        : item.budgetLine ? budgetPath(item.budgetLine) : null,
      item.expense ? h('a', { attrs: { href: `#/tresoreria/despeses/${item.expense.id}` }, text: `${item.expense.concept} · ${formatDay(item.expense.expenseDate)}`,
        on: { click: event => { event.preventDefault(); ctx.go({ path: ['despeses', item.expense.id] }); } } }) : null,
      item.reimbursement ? h('span', { text: `${item.reimbursement.recipientName} · ${item.reimbursement.concept ?? 'Despesa'}` }) : null,
      item.pairedMovement ? h('a', { attrs: { href: `#/tresoreria/moviments/${item.pairedMovement.id}` },
        text: `${item.pairedMovement.positionName} · ${formatDay(item.pairedMovement.operationDate)} · ${formatEur(item.pairedMovement.amountCents, { signed: true })}`,
        on: { click: event => { event.preventDefault(); ctx.go({ path: ['moviments', item.pairedMovement.id] }); } } }) : null),
    h('span', { className: 'allocation-amount', text: formatEur(item.amountCents) }))));
}

// The original description: only with the reveal permission, fetched on demand every time (the server
// audits each consultation), never cached and never placed in a list.
function revealBlock(m, ctx) {
  if (!canReveal(ctx.caps()) || !m.hasDescription) return null;
  const box = h('div', { className: 'reveal-box', attrs: { hidden: true, 'aria-live': 'polite' } });
  const toggle = h('button', { className: 'link-button', text: 'Mostra descripció original', attrs: { type: 'button', 'aria-expanded': 'false' } });
  toggle.addEventListener('click', async () => {
    if (!box.hidden) { box.replaceChildren(); box.hidden = true; toggle.textContent = 'Mostra descripció original'; toggle.setAttribute('aria-expanded', 'false'); return; }
    toggle.setAttribute('aria-busy', 'true');
    try {
      const data = await ctx.call(`/api/finance/movements/${m.id}/description`);
      box.replaceChildren(h('p', { className: 'reveal-text', text: data.description }), h('p', { className: 'field-hint', text: 'Consulta registrada. No es guarda en este dispositiu.' }));
      box.hidden = false; toggle.textContent = 'Amaga la descripció original'; toggle.setAttribute('aria-expanded', 'true');
    } catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
    finally { toggle.removeAttribute('aria-busy'); }
  });
  return h('div', { className: 'reveal' }, toggle, box);
}

// ---------------------------------------------------------------- duplicates

function duplicateBlock(data, ctx, reload) {
  const m = data.movement;
  if (m.state === 'VOID_DUPLICATE') return h('div', { className: 'conflict-banner duplicate-banner' },
    h('p', { text: 'Aquest moviment està anul·lat com a duplicat. No compta en saldos ni en classificacions.' }),
    data.duplicateOf ? h('a', { className: 'link-button', attrs: { href: `#/tresoreria/moviments/${data.duplicateOf.id}` }, text: `Veure l’original (${formatDay(data.duplicateOf.operationDate)}, ${data.duplicateOf.positionName})`,
      on: { click: event => { event.preventDefault(); ctx.go({ path: ['moviments', data.duplicateOf.id] }); } } }) : null);
  if (!m.reviewFlag) return null;
  const can = canClassify(ctx.caps());
  return h('div', { className: 'conflict-banner duplicate-banner' },
    h('p', { text: 'Possible duplicat: hi ha un altre moviment amb la mateixa data, posició i import.' }),
    data.duplicateCandidates.length ? h('ul', { className: 'candidate-brief' }, data.duplicateCandidates.map(c => h('li', {},
      h('a', { attrs: { href: `#/tresoreria/moviments/${c.id}` }, text: `${c.label} · ${formatDay(c.operationDate)} · ${formatEur(c.amountCents, { signed: true })}`,
        on: { click: event => { event.preventDefault(); ctx.go({ path: ['moviments', c.id] }); } } })))) : null,
    can ? h('div', { className: 'detail-actions' },
      data.duplicateCandidates.length ? h('button', { className: 'btn btn-strong', text: 'Confirma que és duplicat', attrs: { type: 'button' }, on: { click: () => openVoidDuplicate(data, ctx, reload) } }) : null,
      h('button', { className: 'btn btn-secondary', text: 'És un moviment vàlid', attrs: { type: 'button' }, on: { click: async event => {
        const trigger = event.currentTarget;
        if (!await confirmDialog({ title: 'Mantindre com a moviment vàlid?', body: 'Es manté el moviment i deixa de marcar-se com a possible duplicat. Es podrà classificar normalment.', confirm: 'Manté’l' })) return;
        trigger.setAttribute('aria-busy', 'true');
        try { await ctx.call(`/api/finance/movements/${m.id}/clear-review`, { method: 'POST', body: JSON.stringify({ expectedReviewVersion: m.reviewVersion }) }); toast('Moviment mantingut com a vàlid'); await reload(); }
        catch (error) { toast(errorCopy(error), { tone: 'danger' }); trigger.removeAttribute('aria-busy'); }
      } } })) : null);
}
function openVoidDuplicate(data, ctx, reload) {
  const m = data.movement;
  const options = data.duplicateCandidates.map((c, index) => h('label', { className: 'candidate' },
    h('input', { attrs: { type: 'radio', name: 'duplicateOf', value: c.id, checked: index === 0 } }),
    h('span', { className: 'candidate-name', text: `${c.label}` }),
    h('span', { className: 'candidate-meta', text: `${formatDay(c.operationDate)} · ${c.positionName} · ${formatEur(c.amountCents, { signed: true })}` })));
  const content = [
    h('p', { className: 'form-notice', text: 'El moviment no s’esborra: queda anul·lat com a duplicat, fora de saldos i classificacions, i es pot consultar.' }),
    h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label', text: 'És un duplicat de' }), options)];
  const drawer = openDrawer({ title: 'Confirma el duplicat', content, primary: 'Marca com a duplicat', tone: 'strong', onSubmit: async () => {
    const chosen = drawer.submit.form.querySelector('input[name="duplicateOf"]:checked')?.value;
    if (!chosen) { drawer.showError('Tria el moviment original.'); return false; }
    await ctx.call(`/api/finance/movements/${m.id}/void-duplicate`, { method: 'POST', body: JSON.stringify({ duplicateOfId: chosen, expectedReviewVersion: m.reviewVersion }) });
    toast('Moviment marcat com a duplicat'); await reload(); return true;
  } });
}

// ---------------------------------------------------------------- classification

/** Classifica: add one part for what is still unallocated (the existing parts are kept as they are). */
export function openClassify(data, ctx, onDone) {
  const m = data.movement, caps = ctx.caps(), round = ctx.summary()?.round;
  const options = classificationOptions(m, caps);
  if (!options.length) { toast('No tens permís per fer aquesta acció.', { tone: 'danger' }); return; }
  const panel = h('div', { className: 'classify-panel' });
  let choice = null, state = {};
  const radios = options.map(option => h('label', { className: 'candidate classify-choice' },
    h('input', { attrs: { type: 'radio', name: 'kind', value: option.id }, on: { change: () => { choice = option.id; void paintPanel(); } } }),
    h('span', { className: 'candidate-name', text: option.label }), h('span', { className: 'candidate-meta', text: option.hint })));
  const amountWrap = () => {
    const money = moneyInput(centsInput(m.unallocatedCents), { 'aria-label': 'Import a assignar' });
    state.amount = money.querySelector('input');
    return field('amount', 'Import a assignar', money, { hint: `Pendent d’assignar: ${formatEur(m.unallocatedCents)}` });
  };
  async function paintPanel() {
    state = {};
    drawer.submit.textContent = choice === 'NEW_EXPENSE' || choice === 'NEW_INCOME' ? 'Continua' : choice === 'LINK_INCOME' ? 'Vincula' : 'Classifica';
    if (choice === 'NEW_INCOME') { panel.replaceChildren(h('p', { className: 'form-notice', text: 'Continuaràs amb el concepte, la partida d’ingressos i qui aporta els diners. L’ingrés quedarà conciliat amb aquest moviment.' })); return; }
    if (choice === 'NEW_EXPENSE') { panel.replaceChildren(h('p', { className: 'form-notice', text: 'Continuaràs amb el concepte, el tercer i el repartiment entre línies del pressupost. Es crearà una despesa reconeguda pagada amb aquest moviment.' })); return; }
    if (!round) { panel.replaceChildren(h('p', { className: 'form-notice', text: 'No hi ha cap ronda econòmica oberta.' })); return; }
    panel.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    try {
      if (choice === 'LINK_INCOME') {
        const incomes = (await ctx.call(`/api/finance/incomes?roundId=${round.id}&state=OPEN`)).incomes
          .sort((a, b) => (b.pendingCents === m.unallocatedCents) - (a.pendingCents === m.unallocatedCents) || a.incomeDate.localeCompare(b.incomeDate));
        if (!incomes.length) { panel.replaceChildren(h('p', { className: 'form-notice', text: 'No hi ha ingressos pendents de conciliar en esta ronda. Pots crear-ne un amb «Crea un ingrés».' })); return; }
        const amountField = amountWrap();
        panel.replaceChildren(h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label', text: 'Ingrés pendent' }),
          incomes.map((income, index) => h('label', { className: 'candidate' },
            h('input', { attrs: { type: 'radio', name: 'income', value: income.id, checked: index === 0 }, dataset: { pending: String(income.pendingCents) },
              on: { change: () => { state.amount.value = centsInput(Math.min(income.pendingCents, m.unallocatedCents)); } } }),
            h('span', { className: 'candidate-name', text: `${income.concept} · ${formatEur(income.pendingCents)}` }),
            h('span', { className: 'candidate-meta', text: `${formatDay(income.incomeDate)} · ${income.state === 'PARTIAL' ? 'Conciliat en part' : 'Pendent de conciliar'}${income.counterpartyName ? ` · ${income.counterpartyName}` : ''}` })))),
          amountField);
        state.amount.value = centsInput(Math.min(incomes[0].pendingCents, m.unallocatedCents));
      } else if (choice === 'FEE_PAYMENT' || choice === 'ACTIVITY_PAYMENT') {
        const candidates = await ctx.call(`/api/finance/movements/${m.id}/receipt-candidates`);
        const rows = choice === 'FEE_PAYMENT' ? candidates.fees : candidates.activities;
        if (!rows.length) { panel.replaceChildren(h('p', { className: 'form-notice',
          text: 'No hi ha pagaments revisats pendents de conciliar. Comprova Quotes o Activitats abans de continuar.' })); return; }
        const choices = rows.map((row, index) => h('label', { className: 'candidate' },
          h('input', { attrs: { type: 'radio', name: 'receipt', value: row.id, checked: index === 0 },
            dataset: { outstanding: String(row.outstandingCents) },
            on: { change: () => { state.amount.value = centsInput(Math.min(row.outstandingCents, m.unallocatedCents)); } } }),
          h('span', { className: 'candidate-name', text: choice === 'FEE_PAYMENT'
            ? `Quota ${row.roundCode} · ${row.obligations} educand(s)` : `${row.activityName} · ${row.participantName}` }),
          h('span', { className: 'candidate-meta', text: `Pendent de conciliar ${formatEur(row.outstandingCents)}` })));
        panel.replaceChildren(h('p', { className: 'form-notice', text: 'Estos són candidats per import i data. Confirma amb el banc i el justificant abans de vincular.' }),
          h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label',
            text: choice === 'FEE_PAYMENT' ? 'Quota revisada' : 'Pagament verificat' }), choices), amountWrap());
        state.amount.value = centsInput(Math.min(rows[0].outstandingCents, m.unallocatedCents));
      } else if (choice === 'FAMILY_OVERPAYMENT' || choice === 'FAMILY_REFUND') {
        const candidates = await ctx.call(`/api/finance/movements/${m.id}/receipt-candidates`);
        const rows = choice === 'FAMILY_OVERPAYMENT' ? candidates.overpayments : candidates.refunds;
        if (!rows.length) { panel.replaceChildren(h('p', { className: 'form-notice',
          text: choice === 'FAMILY_OVERPAYMENT' ? 'No hi ha excessos familiars pendents de conciliar.'
            : 'No hi ha devolucions familiars pendents de liquidar.' })); return; }
        const choices = rows.map((row,index) => h('label', { className: 'candidate' },
          h('input', { attrs: { type: 'radio', name: 'receipt', value: row.id, checked: index === 0 },
            dataset: { outstanding: String(row.outstandingCents),
              activityAllocationId: row.activityAllocationId ?? '', overpaymentId: row.overpaymentId ?? '' },
            on: { change: () => { state.amount.value = centsInput(Math.min(row.outstandingCents,m.unallocatedCents)); } } }),
          h('span', { className: 'candidate-name', text: choice === 'FAMILY_OVERPAYMENT'
            ? 'Excés de pagament familiar' : `Devolució familiar · ${row.recipientEmail}` }),
          h('span', { className: 'candidate-meta', text: `Pendent ${formatEur(row.outstandingCents)}` })));
        panel.replaceChildren(h('p', { className: 'form-notice', text: 'Comprova el justificant i confirma manualment la coincidència amb el banc.' }),
          h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label',
            text: choice === 'FAMILY_OVERPAYMENT' ? 'Excés familiar' : 'Devolució pendent' }), choices), amountWrap());
        state.amount.value = centsInput(Math.min(rows[0].outstandingCents,m.unallocatedCents));
      } else if (choice === 'INCOME') {
        const lines = (await ctx.call(`/api/finance/rounds/${round.id}/assignable-lines?nature=INCOME`)).lines;
        const picker = budgetLineButton({ lines, emptyText: 'Tria una línia d’ingressos' });
        state.line = picker;
        panel.replaceChildren(field('budgetLineId', 'Línia d’ingressos', picker.node), amountWrap());
      } else if (choice === 'EXPENSE_SETTLEMENT' || choice === 'EXPENSE_REFUND') {
        if (!caps.treasury?.readExpenses) { panel.replaceChildren(h('p', { className: 'form-notice', text: 'Per vincular una despesa cal poder consultar les despeses.' })); return; }
        const expenses = settleableExpenses((await ctx.call(`/api/finance/expenses?roundId=${round.id}&status=RECOGNISED`)).expenses, m, choice);
        if (!expenses.length) { panel.replaceChildren(h('p', { className: 'form-notice', text: choice === 'EXPENSE_REFUND' ? 'No hi ha despeses reconegudes en esta ronda.' : `No hi ha despeses reconegudes pendents de pagar amb ${POSITION_KIND[m.positionKind]?.toLocaleLowerCase('ca') ?? 'aquesta posició'}.` })); return; }
        const select = h('select', {}, h('option', { text: 'Tria…', attrs: { value: '' } }), expenses.map(e => h('option', { attrs: { value: e.id },
          text: `${e.concept ?? e.counterpartyName ?? 'Despesa'} · ${formatDay(e.expenseDate)} · ${formatEur(e.totalCents)}${choice === 'EXPENSE_SETTLEMENT' ? ` (pendent ${formatEur(e.totalCents - e.settledCents)})` : ''}` })));
        state.expense = select;
        panel.replaceChildren(field('expenseId', 'Despesa', select), amountWrap());
      } else if (choice === 'REIMBURSEMENT_SETTLEMENT') {
        const reimbursements = (await ctx.call(`/api/finance/reimbursements?roundId=${round.id}&outstanding=1`)).reimbursements;
        if (!reimbursements.length) { panel.replaceChildren(h('p', { className: 'form-notice', text: 'No hi ha reemborsaments aprovats pendents.' })); return; }
        const recipients = [...new Map(reimbursements.map(row => [row.recipientId, row.recipientName])).entries()];
        const recipient = h('select', { attrs: { 'aria-label': 'Scouter beneficiari' } }, recipients.map(([id, name]) =>
          h('option', { text: name, attrs: { value: id } })));
        const pendingList = h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label', text: 'Despeses aprovades pendents' }));
        const total = h('p', { className: 'form-notice', attrs: { 'aria-live': 'polite' } });
        const paintRecipient = () => {
          const rows = reimbursements.filter(row => row.recipientId === recipient.value);
          pendingList.replaceChildren(h('legend', { className: 'field-label', text: 'Despeses aprovades pendents' }),
            ...rows.map(row => h('label', { className: 'candidate' },
              h('input', { attrs: { type: 'checkbox', name: 'reimbursement', value: row.id }, dataset: { outstanding: String(row.outstandingCents) },
                on: { change: () => updateTotal() } }),
              h('span', { className: 'candidate-name', text: `${row.concept ?? 'Despesa'} · ${formatEur(row.outstandingCents)}` }),
              h('span', { className: 'candidate-meta', text: formatDay(row.expenseDate) }),
              h('input', { attrs: { type: 'text', inputmode: 'decimal', value: centsInput(row.outstandingCents),
                'aria-label': `Import a reemborsar de ${row.concept ?? 'despesa'}` }, dataset: { amount: row.id },
              on: { input: () => updateTotal() } }))));
          updateTotal();
        };
        const updateTotal = () => { const selected = [...pendingList.querySelectorAll('input:checked')];
          const sum = selected.reduce((value, input) => value + (parseEuros(pendingList.querySelector(`[data-amount="${input.value}"]`)?.value) ?? 0), 0);
          total.textContent = `Seleccionat ${formatEur(sum)} · pendent del moviment ${formatEur(m.unallocatedCents)}. Pots conciliar una part de cada despesa després de seleccionar-la.`;
        };
        recipient.addEventListener('change', paintRecipient);
        state.reimbursementList = pendingList;
        panel.replaceChildren(h('p', { className: 'form-notice', text: 'Confirma que aquesta transferència real correspon al scouter seleccionat. Gestió no verifica automàticament el destinatari bancari.' }),
          field('recipientId', 'Scouter', recipient), pendingList, total);
        paintRecipient();
      } else if (choice === 'INTERNAL_TRANSFER') {
        if (m.allocatedCents > 0) { panel.replaceChildren(h('p', { className: 'form-notice', text: 'Un traspàs intern ha d’ocupar el moviment sencer. Corregeix primer la classificació actual.' })); return; }
        if (!data.transferCandidates.length) { panel.replaceChildren(h('p', { className: 'form-notice', text: 'No hi ha cap moviment d’una altra posició amb el mateix import i signe contrari pendent de classificar.' })); return; }
        panel.replaceChildren(h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label', text: 'Moviment parella' }),
          data.transferCandidates.map((c, index) => h('label', { className: 'candidate' },
            h('input', { attrs: { type: 'radio', name: 'pair', value: c.id, checked: index === 0 }, dataset: { version: String(c.allocationVersion) } }),
            h('span', { className: 'candidate-name', text: `${c.positionName} · ${formatEur(c.amountCents, { signed: true })}` }),
            h('span', { className: 'candidate-meta', text: `${formatDay(c.operationDate)} · ${c.label}` })))));
      }
    } catch (error) { panel.replaceChildren(h('p', { className: 'field-error', attrs: { role: 'alert' }, text: errorCopy(error) })); }
  }
  const content = [
    h('p', { className: 'classify-summary' }, amountNode(m.amountCents), h('span', { text: ` · ${formatDay(m.operationDate)} · ${m.positionName}` })),
    h('fieldset', { className: 'form-field candidate-list' }, h('legend', { className: 'field-label', text: 'Què és aquest moviment?' }), radios), panel];
  const drawer = openDrawer({ title: 'Classifica el moviment', content, primary: 'Classifica', onSubmit: async () => {
    if (!choice) { drawer.showError('Tria què és aquest moviment.'); return false; }
    if (choice === 'NEW_EXPENSE') { drawer.close(); openExpenseForm({ ctx, movement: m, onDone }); return false; }
    if (choice === 'NEW_INCOME') { drawer.close(); void openIncomeForm({ ctx, movement: m, onDone }); return false; }
    if (choice === 'INTERNAL_TRANSFER') {
      const pair = drawer.submit.form.querySelector('input[name="pair"]:checked');
      if (!pair) { drawer.showError('Tria el moviment parella.'); return false; }
      const mine = { id: m.id, version: m.allocationVersion }, other = { id: pair.value, version: Number(pair.dataset.version) };
      const [from, to] = m.amountCents < 0 ? [mine, other] : [other, mine];
      await ctx.call('/api/finance/internal-transfers', { method: 'POST', body: JSON.stringify({ fromMovementId: from.id, toMovementId: to.id,
        fromExpectedVersion: from.version, toExpectedVersion: to.version }) });
    } else if (choice === 'REIMBURSEMENT_SETTLEMENT') {
      const checked = [...(state.reimbursementList?.querySelectorAll('input[name="reimbursement"]:checked') ?? [])];
      if (!checked.length) { drawer.showError('Tria almenys una despesa pendent.'); return false; }
      const fields = checked.map(input => ({ id: input.value, outstandingCents: Number(input.dataset.outstanding),
        amountCents: parseEuros(state.reimbursementList.querySelector(`[data-amount="${input.value}"]`)?.value) }));
      if (fields.some(row => !row.amountCents || row.amountCents <= 0 || row.amountCents > row.outstandingCents)) {
        drawer.showError('Revisa els imports: han de ser positius i no superar el pendent de cada despesa.'); return false;
      }
      const sum = fields.reduce((value, row) => value + row.amountCents, 0);
      if (sum > m.unallocatedCents) { drawer.showError('La selecció supera el pendent del moviment. Tria menys despeses o concilia-les per parts.'); return false; }
      await ctx.call(`/api/finance/movements/${m.id}/allocations`, { method: 'POST', body: JSON.stringify({ expectedVersion: m.allocationVersion,
        allocations: [...allocationPayload(data.allocations), ...fields.map(row => ({ kind: 'REIMBURSEMENT_SETTLEMENT',
          reimbursementId: row.id, amountCents: row.amountCents }))] }) });
    } else {
      const picked = drawer.submit.form.querySelector('input[name="income"]:checked');
      const receipt = drawer.submit.form.querySelector('input[name="receipt"]:checked');
      const limit = choice === 'LINK_INCOME' && picked ? Math.min(m.unallocatedCents, Number(picked.dataset.pending))
        : receipt ? Math.min(m.unallocatedCents, Number(receipt.dataset.outstanding)) : m.unallocatedCents;
      const result = newAllocation({ kind: choice, amount: state.amount?.value, budgetLineId: state.line?.value,
        expenseId: state.expense?.value, incomeId: picked?.value,
        feePaymentId: choice === 'FEE_PAYMENT' ? receipt?.value : null,
        activityAllocationId: choice === 'ACTIVITY_PAYMENT' ? receipt?.value : choice === 'FAMILY_REFUND'
          ? receipt?.dataset.activityAllocationId || null : null,
        overpaymentId: choice === 'FAMILY_OVERPAYMENT' ? receipt?.value : choice === 'FAMILY_REFUND'
          ? receipt?.dataset.overpaymentId || null : null }, limit);
      if (result.error) { drawer.showError(result.error); return false; }
      await ctx.call(`/api/finance/movements/${m.id}/allocations`, { method: 'POST', body: JSON.stringify({ expectedVersion: m.allocationVersion,
        allocations: [...allocationPayload(data.allocations), result.allocation] }) });
    }
    toast(choice === 'LINK_INCOME' ? 'Ingrés conciliat' : 'Classificació actualitzada'); await onDone?.(); return true;
  } });
}

/** Corregeix classificació: keep, change or remove the current parts. The previous set stays in history. */
function openCorrection(data, ctx, onDone) {
  const m = data.movement;
  const reason = h('textarea', { attrs: { rows: 3, maxlength: 240, placeholder: 'Ex.: Reemborsament vinculat a la despesa errònia' } });
  const rows = data.allocations.map(item => {
    const keep = h('input', { attrs: { type: 'checkbox', checked: true, 'aria-label': `Manté: ${allocationLabel(item)}` } });
    const money = moneyInput(centsInput(item.amountCents), { 'aria-label': `Import: ${allocationLabel(item)}`, ...(item.kind === 'INTERNAL_TRANSFER' ? { readonly: true } : {}) });
    keep.addEventListener('change', () => { money.querySelector('input').disabled = !keep.checked; });
    return { item, keep, amount: money.querySelector('input'),
      node: h('div', { className: 'correction-row' }, h('label', { className: 'checkbox-row' }, keep, h('span', { text: allocationLabel(item) })), money) };
  });
  const content = [
    h('p', { className: 'form-notice', text: 'La classificació anterior es conserva a l’historial. Desmarca una part per a llevar-la o canvia’n l’import; després podràs tornar a classificar el que quede pendent.' }),
    h('div', { className: 'correction-rows' }, rows.map(row => row.node)),
    data.allocations.some(item => item.kind === 'INTERNAL_TRANSFER') ? h('p', { className: 'field-hint', text: 'Si lleves un traspàs intern, revisa també el moviment parella.' }) : null,
    field('reason', 'Motiu de la correcció', reason, { required: true })];
  const drawer = openDrawer({ title: 'Corregeix la classificació', content, primary: 'Guarda la correcció', onSubmit: async () => {
    if (reason.value.trim().length < 3) { drawer.showError('Explica breument el motiu de la correcció.'); return false; }
    const kept = [];
    for (const row of rows) {
      if (!row.keep.checked) continue;
      const result = newAllocation({ kind: row.item.kind, amount: row.amount.value, budgetLineId: row.item.budgetLineId,
        expenseId: row.item.expenseId, incomeId: row.item.incomeId, reimbursementId: row.item.reimbursementId,
        feePaymentId: row.item.feePaymentId, activityAllocationId: row.item.activityAllocationId }, Math.abs(m.amountCents));
      if (result.error && row.item.kind !== 'INTERNAL_TRANSFER') { drawer.showError(result.error); return false; }
      kept.push({ ...allocationPayload([row.item])[0], amountCents: row.item.kind === 'INTERNAL_TRANSFER' ? row.item.amountCents : result.allocation.amountCents });
    }
    if (kept.reduce((sum, item) => sum + item.amountCents, 0) > Math.abs(m.amountCents)) { drawer.showError('L’import assignat supera l’import disponible del moviment.'); return false; }
    await ctx.call(`/api/finance/movements/${m.id}/allocations`, { method: 'POST', body: JSON.stringify({
      expectedVersion: m.allocationVersion, allocations: kept, reason: reason.value.trim() }) });
    toast('Classificació actualitzada'); await onDone?.(); return true;
  } });
}

/** Replace the reimbursement part of one BANK allocation set in one versioned operation. */
async function openReimbursementReassignment(data, ctx, onDone) {
  const round = ctx.summary()?.round;
  if (!round) { toast('No hi ha cap ronda econòmica oberta.', { tone: 'danger' }); return; }
  let reimbursements;
  try { reimbursements = (await ctx.call(`/api/finance/reimbursements?roundId=${round.id}`)).reimbursements
    .filter(row => row.status === 'APPROVED' && !row.cancelledAt); }
  catch (error) { toast(errorCopy(error), { tone: 'danger' }); return; }
  const current = new Map();
  for (const item of data.allocations.filter(row => row.kind === 'REIMBURSEMENT_SETTLEMENT'))
    current.set(item.reimbursementId, (current.get(item.reimbursementId) ?? 0) + item.amountCents);
  const available = reimbursements.filter(row => row.outstandingCents + (current.get(row.id) ?? 0) > 0);
  const recipients = [...new Map(available.map(row => [row.recipientId, row.recipientName])).entries()];
  if (!recipients.length) { toast('No hi ha reemborsaments aprovats per assignar.', { tone: 'danger' }); return; }
  const first = available.find(row => current.has(row.id))?.recipientId ?? recipients[0][0];
  const recipient = h('select', {}, recipients.map(([id, name]) => h('option', { text: name,
    attrs: { value: id, selected: id === first } })));
  const list = h('div', { className: 'candidate-list' });
  const reason = h('textarea', { attrs: { rows: 3, maxlength: 240,
    placeholder: 'Ex.: Les despeses vinculades eren incorrectes' } });
  const paint = () => {
    list.replaceChildren(...available.filter(row => row.recipientId === recipient.value).map(row => {
      const amount = current.get(row.id) ?? 0;
      const limit = row.outstandingCents + amount;
      return h('label', { className: 'candidate' },
        h('input', { attrs: { type: 'checkbox', name: 'reimbursement', value: row.id, checked: amount > 0 }, dataset: { limit: String(limit) } }),
        h('span', { className: 'candidate-name', text: `${row.concept ?? 'Despesa'} · màxim ${formatEur(limit)}` }),
        h('input', { attrs: { type: 'text', inputmode: 'decimal', value: centsInput(amount || limit),
          'aria-label': `Import de ${row.concept ?? 'despesa'}` }, dataset: { amount: row.id } }));
    }));
  };
  recipient.addEventListener('change', paint); paint();
  const drawer = openDrawer({ title: 'Reassigna reemborsaments', primary: 'Guarda la correcció', content: [
    h('p', { className: 'form-notice', text: 'Tria les despeses pagades amb aquesta transferència. La classificació anterior quedarà a l’historial.' }),
    field('recipient', 'Scouter beneficiari', recipient), list,
    field('reason', 'Motiu de la correcció', reason, { required: true })], onSubmit: async () => {
    if (reason.value.trim().length < 3) { drawer.showError('Explica breument el motiu de la correcció.'); return false; }
    const selected = [...list.querySelectorAll('input[name="reimbursement"]:checked')].map(input => ({
      kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: input.value,
      amountCents: parseEuros(list.querySelector(`[data-amount="${input.value}"]`)?.value), limit: Number(input.dataset.limit) }));
    if (!selected.length) { drawer.showError('Tria almenys una despesa. Per retirar totes les assignacions, usa «Corregeix classificació».'); return false; }
    if (selected.some(row => !row.amountCents || row.amountCents < 1 || row.amountCents > row.limit)) {
      drawer.showError('Revisa els imports: no poden superar el pendent de cada despesa.'); return false;
    }
    const kept = allocationPayload(data.allocations.filter(item => item.kind !== 'REIMBURSEMENT_SETTLEMENT'));
    if ([...kept, ...selected].reduce((sum, row) => sum + row.amountCents, 0) > Math.abs(data.movement.amountCents)) {
      drawer.showError('La suma supera l’import del moviment.'); return false;
    }
    await ctx.call(`/api/finance/movements/${data.movement.id}/allocations`, { method: 'POST', body: JSON.stringify({
      expectedVersion: data.movement.allocationVersion,
      allocations: [...kept, ...selected.map(({ limit, ...row }) => row)], reason: reason.value.trim() }) });
    toast('Reemborsaments corregits'); await onDone(); return true;
  } });
}

// ---------------------------------------------------------------- import batches (read-only)

export function batchList(batches) {
  if (!batches?.length) return h('p', { className: 'empty-detail', text: 'Encara no hi ha cap importació.' });
  return h('ul', { className: 'batch-list', attrs: { role: 'list' } }, batches.map(batch => h('li', { className: 'batch-row' },
    h('span', { className: 'batch-main', text: `${formatInstant(batch.importedAt)} · ${batch.positionName}` }),
    h('span', { className: 'tx-sub', text: [BATCH_FORMAT[batch.format] ?? 'Format desconegut', `${batch.rowCount} files`, `${batch.createdCount} nous`,
      batch.duplicateCount ? `${batch.duplicateCount} repetits` : null, batch.flaggedCount ? `${batch.flaggedCount} possibles duplicats` : null].filter(Boolean).join(' · ') }),
    statusBadge({ label: BATCH_STATUS[batch.status] ?? 'Importada', tone: batch.status === 'PARTIALLY_FLAGGED' ? 'warning' : 'ok' }))));
}
