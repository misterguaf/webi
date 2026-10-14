import { h } from '../../ui.js';
import { errorCopy, formatEur, parseEuros } from './model.js';
import { renderBudgetImport } from './budget-import.js';
import { openExpenseForm } from './expense-form.js';
import { openIncomeForm } from './income-form.js';
import { field, showErrors } from './forms.js';

// Phase J: budget vs actual as a tree table (subtotals in bold, leaves indented by their code depth), the
// overrun as a warning on the line itself, and the draft/revision forms as grouped fields with inline errors.
const option = (value, label) => h('option', { text: label, attrs: { value } });
const money = (cents, options) => cents == null ? '—' : formatEur(cents, options);
const BUDGET_STATUS = { DRAFT: ['En preparació', 'badge-draft'], PROPOSED: ['Pendent d’aprovació', 'tone-warning'], APPROVED: ['Aprovat', 'tone-ok'] };
const REVISION_STATUS = { PROPOSED: ['Proposada', 'tone-warning'], APPROVED: ['Aprovada', 'tone-ok'], REJECTED: ['Rebutjada', 'tone-muted'] };
const NATURE = { EXPENSE: 'Despesa', INCOME: 'Ingrés' };
const badge = ([text, tone]) => h('span', { className: `badge ${tone}`, text });
async function submitting(form, run) {
  const submit = form.querySelector('button[type="submit"]');
  if (submit?.getAttribute('aria-busy') === 'true') return;
  submit?.setAttribute('aria-busy', 'true'); if (submit) submit.disabled = true;
  try { await run(); } finally { if (submit?.isConnected) { submit.removeAttribute('aria-busy'); submit.disabled = false; } }
}

export async function renderBudget(root, ctx, round, refresh) {
  const data = await ctx.call(`/api/finance/rounds/${round.id}/budget`);
  const caps = ctx.caps().treasury ?? {};
  const notice = h('div', { className: 'inline-error', attrs: { role: 'alert', hidden: true } }, h('p'));
  const say = text => { notice.querySelector('p').textContent = text; notice.hidden = !text; };
  const send = async (path, body) => {
    say('');
    try { await ctx.call(path, { method: 'POST', body: JSON.stringify(body) }); await refresh(); }
    catch (error) { say(errorCopy(error)); }
  };
  const budget = data.budget;
  const head = h('div', { className: 'block-head' }, h('h2', { className: 'block-title', text: 'Pressupost i real' }),
    budget ? badge(BUDGET_STATUS[budget.status] ?? [budget.status, 'tone-neutral']) : null);
  const section = h('section', { className: 'activity-surface treasury-block budget-block' }, head,
    h('p', { className: 'field-hint', text: 'El pressupost vigent incorpora les revisions aprovades. Les xifres reals venen de despeses reconegudes i ingressos generals conciliats.' }));
  if(caps.proposeBudget&&round.status!=='CLOSED')renderBudgetImport(section,ctx,round,refresh);
  if(data.lines.length){
    const selectedCtx={...ctx,summary:()=>({...ctx.summary(),round})};
    const actions=h('div',{className:'form-actions budget-record-actions'});
    if(caps.manageExpenses)actions.append(h('button',{className:'btn btn-secondary',text:'Nova despesa en aquesta ronda',attrs:{type:'button'},
      on:{click:()=>openExpenseForm({ctx:selectedCtx,onDone:created=>ctx.go({path:['despeses',created.id]})})}}));
    if(caps.manageIncomes)actions.append(h('button',{className:'btn btn-secondary',text:'Nou ingrés en aquesta ronda',attrs:{type:'button'},
      on:{click:()=>openIncomeForm({ctx:selectedCtx,onDone:created=>ctx.go({path:['ingressos',created.id]})})}}));
    if(actions.childElementCount)section.append(actions);
  }
  if (!budget) {
    section.append(h('div', { className: 'empty-state budget-empty' }, h('p', { className: 'empty-title', text: 'Encara no s’ha preparat el pressupost de la ronda.' })));
    if (caps.proposeBudget && round.status !== 'CLOSED') section.append(h('div', { className: 'form-actions' }, h('button', { className: 'btn btn-primary',
      text: 'Prepara el pressupost', attrs: { type: 'button' },
      on: { click: () => send(`/api/finance/rounds/${round.id}/budget`, {}) } })));
    section.append(notice); root.append(section); return;
  }
  const rows = data.lines.map(row => {
    const over = !row.hasChildren && row.overrunCents > 0;
    const depth = Math.min(4, String(row.code).split('.').length);
    return h('tr', { className: `budget-row budget-depth-${depth}` + (row.hasChildren ? ' is-subtotal' : '') + (over ? ' is-over' : '') },
      h('th', { attrs: { scope: 'row' } }, h('span', { className: 'budget-code', text: row.code }), h('span', { className: 'budget-name', text: row.name })),
      h('td', { text: NATURE[row.nature] ?? 'Reserva' }),
      h('td', { className: 'num', text: money(row.initialCents) }),
      h('td', { className: 'num', text: money(row.currentCents) }),
      h('td', { className: 'num budget-actual', text: formatEur(row.actualCents) }),
      h('td', { className: 'num', text: money(row.varianceCents, { signed: true }) }));
  });
  section.append(h('div', { className: 'table-scroll' }, h('table', { className: 'data-table budget-table' },
    h('thead', {}, h('tr', {}, ...['Partida', 'Tipus', 'Inicial', 'Vigent', 'Real', 'Desviació'].map((label, index) => h('th', { className: index > 1 ? 'num' : null, text: label, attrs: { scope: 'col' } })))),
    h('tbody', {}, rows))));
  const overrun = data.lines.filter(row => !row.hasChildren && row.overrunCents > 0);
  if (overrun.length) section.append(h('div', { className: 'detail-message budget-overrun', attrs: { role: 'status' } }, h('p', { text: `Atenció: ${overrun.map(row =>
    `${row.name} supera el pressupost en ${formatEur(row.overrunCents)}`).join('; ')}. El registre de la despesa continua disponible.` })));
  const footer = h('div', { className: 'form-actions budget-state-actions' });
  if (caps.proposeBudget && budget.status === 'DRAFT' && round.status !== 'CLOSED') {
    const form = h('form', { className: 'budget-form', attrs: { novalidate: true }, on: { submit: event => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      const amount = parseEuros(values.get('planned'));
      const errors = { code: String(values.get('code')).trim() ? null : 'Indica el codi.', name: String(values.get('name')).trim() ? null : 'Indica el nom.',
        planned: amount == null ? 'Revisa l’import pressupostat.' : null };
      if (!showErrors(form, errors)) return;
      void submitting(form, () => send('/api/finance/budget-lines', { roundId: round.id, code: String(values.get('code')).trim(),
        name: String(values.get('name')).trim(), nature: values.get('nature'), parentId: values.get('parent') || null,
        plannedCents: amount }));
    } } },
    h('h3', { className: 'form-section-title', text: 'Afig una partida' }),
    h('div', { className: 'budget-form-grid' },
      field('code', 'Codi', h('input', { attrs: { name: 'code', required: true, maxlength: 20 } }), { required: true }),
      field('name', 'Nom', h('input', { attrs: { name: 'name', required: true, maxlength: 120 } }), { required: true }),
      field('nature', 'Tipus', h('select', { attrs: { name: 'nature' } }, option('EXPENSE', 'Despesa'), option('INCOME', 'Ingrés'),
        option('RESERVE_USE', 'Aplicació de reserva'), option('RESERVE_CONTRIBUTION', 'Aportació a reserva'))),
      field('parent', 'Partida superior', h('select', { attrs: { name: 'parent' } }, option('', 'Cap'),
        ...data.lines.map(row => option(row.id, `${row.code} · ${row.name}`)))),
      field('planned', 'Import inicial (€)', h('input', { className: 'amount-input', attrs: { name: 'planned', inputmode: 'decimal', required: true, placeholder: '0,00' } }), { required: true })),
    h('div', { className: 'form-actions' }, h('button', { className: 'btn btn-secondary', text: 'Afig partida', attrs: { type: 'submit' } })));
    section.append(form);
    footer.append(h('button', { className: 'btn btn-primary', text: 'Proposa el pressupost', attrs: { type: 'button' },
      on: { click: () => send(`/api/finance/budgets/${budget.id}/propose`, { expectedVersion: budget.version }) } }));
  }
  if (caps.approveBudget && budget.status === 'PROPOSED') footer.append(h('button', { className: 'btn btn-primary',
    text: 'Aprova el pressupost', attrs: { type: 'button' },
    on: { click: () => send(`/api/finance/budgets/${budget.id}/approve`, { expectedVersion: budget.version }) } }));
  if (caps.proposeBudget && budget.status === 'APPROVED' && round.status !== 'CLOSED') {
    const form = h('form', { className: 'budget-form', attrs: { novalidate: true }, on: { submit: event => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      const deltaCents = parseEuros(values.get('delta'), { allowNegative: true });
      if (!showErrors(form, { delta: deltaCents ? null : 'Introdueix una variació diferent de zero.' })) return;
      void submitting(form, () => send('/api/finance/budget-revisions', { budgetId: budget.id, lineId: values.get('line'), deltaCents }));
    } } }, h('h3', { className: 'form-section-title', text: 'Proposa una revisió' }),
    h('div', { className: 'budget-form-grid budget-revision-grid' },
      field('line', 'Partida', h('select', { attrs: { name: 'line' } },
        ...data.lines.filter(row => !row.hasChildren).map(row => option(row.id, `${row.code} · ${row.name}`)))),
      field('delta', 'Variació en euros', h('input', { className: 'amount-input', attrs: { name: 'delta', inputmode: 'decimal', required: true, placeholder: '+0,00 o −0,00' } }), { required: true, hint: 'Usa el signe menys per a reduir la partida.' })),
    h('div', { className: 'form-actions' }, h('button', { className: 'btn btn-secondary', text: 'Proposa revisió', attrs: { type: 'submit' } })));
    section.append(form);
  }
  if (footer.childElementCount) section.append(footer);
  const revisionRows = data.revisions.map(row => {
    const approve = caps.approveBudget && row.status === 'PROPOSED' ? h('button', {
      className: 'btn btn-secondary btn-sm', text: 'Aprova', attrs: { type: 'button' },
      on: { click: () => send(`/api/finance/budget-revisions/${row.id}/decision`,
        { decision: 'APPROVE', expectedVersion: row.version }) }
    }) : null;
    return h('li', { className: 'revision-row' },
      h('span', { className: 'mini-main', text: data.lines.find(line => line.id === row.lineId)?.name ?? 'Partida' }),
      h('span', { className: 'amount', text: formatEur(row.deltaCents, { signed: true }) }),
      badge(REVISION_STATUS[row.status] ?? [row.status, 'tone-neutral']), approve);
  });
  if (revisionRows.length) section.append(h('details', { className: 'budget-history' }, h('summary', { className: 'disclosure', text: `Historial de revisions · ${revisionRows.length}` }),
    h('ul', { className: 'mini-list' }, revisionRows)));
  section.append(notice); root.append(section);
}
