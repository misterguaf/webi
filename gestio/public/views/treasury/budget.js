import { h } from '../../ui.js';
import { errorCopy, formatEur, parseEuros } from './model.js';

const cell = text => h('td', { text: String(text) });
const option = (value, label) => h('option', { text: label, attrs: { value } });

export async function renderBudget(root, ctx, round, refresh) {
  const data = await ctx.call(`/api/finance/rounds/${round.id}/budget`);
  const caps = ctx.caps().treasury ?? {};
  const notice = h('p', { attrs: { role: 'status' } });
  const send = async (path, body) => {
    try { await ctx.call(path, { method: 'POST', body: JSON.stringify(body) }); await refresh(); }
    catch (error) { notice.textContent = errorCopy(error); }
  };
  const budget = data.budget;
  const section = h('section', { className: 'activity-surface treasury-block' },
    h('h2', { className: 'block-title', text: 'Pressupost i real' }),
    h('p', { className: 'field-hint', text: 'El pressupost vigent incorpora les revisions aprovades. Les xifres reals venen de despeses reconegudes i ingressos generals conciliats.' }));
  if (!budget) {
    section.append(h('p', { className: 'empty-detail', text: 'Encara no s’ha preparat el pressupost de la ronda.' }));
    if (caps.proposeBudget && round.status !== 'CLOSED') section.append(h('button', { className: 'btn btn-primary',
      text: 'Prepara el pressupost', attrs: { type: 'button' },
      on: { click: () => void send(`/api/finance/rounds/${round.id}/budget`, {}) } }));
    section.append(notice); root.append(section); return;
  }
  const status = { DRAFT: 'En preparació', PROPOSED: 'Pendent d’aprovació', APPROVED: 'Aprovat' };
  section.append(h('p', { text: `Estat: ${status[budget.status] ?? budget.status}` }));
  const rows = data.lines.map(row => h('tr', {},
    cell(`${row.code} · ${row.name}`), cell(row.nature === 'EXPENSE' ? 'Despesa' : row.nature === 'INCOME' ? 'Ingrés' : 'Reserva'),
    cell(row.initialCents == null ? '—' : formatEur(row.initialCents)),
    cell(row.currentCents == null ? '—' : formatEur(row.currentCents)),
    cell(formatEur(row.actualCents)),
    cell(row.varianceCents == null ? '—' : formatEur(row.varianceCents, { signed: true }))));
  section.append(h('div', { className: 'table-scroll' }, h('table', { className: 'data-table' },
    h('thead', {}, h('tr', {}, ...['Partida', 'Tipus', 'Inicial', 'Vigent', 'Real', 'Desviació'].map(label => h('th', { text: label, attrs: { scope: 'col' } })))),
    h('tbody', {}, rows))));
  const overrun = data.lines.filter(row => !row.hasChildren && row.overrunCents > 0);
  if (overrun.length) section.append(h('p', { className: 'inline-warning', text: `Atenció: ${overrun.map(row =>
    `${row.name} supera el pressupost en ${formatEur(row.overrunCents)}`).join('; ')}. El registre de la despesa continua disponible.` }));
  if (caps.proposeBudget && budget.status === 'DRAFT' && round.status !== 'CLOSED') {
    section.append(h('form', { on: { submit: event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const amount = parseEuros(form.get('planned'));
      if (amount == null) { notice.textContent = 'Revisa l’import pressupostat.'; return; }
      void send('/api/finance/budget-lines', { roundId: round.id, code: String(form.get('code')).trim(),
        name: String(form.get('name')).trim(), nature: form.get('nature'), parentId: form.get('parent') || null,
        plannedCents: amount });
    } } },
    h('h3', { text: 'Afig una partida' }),
    h('label', { text: 'Codi ' }, h('input', { attrs: { name: 'code', required: true, maxlength: 20 } })),
    h('label', { text: 'Nom ' }, h('input', { attrs: { name: 'name', required: true, maxlength: 120 } })),
    h('label', { text: 'Tipus ' }, h('select', { attrs: { name: 'nature' } }, option('EXPENSE', 'Despesa'), option('INCOME', 'Ingrés'),
      option('RESERVE_USE', 'Aplicació de reserva'), option('RESERVE_CONTRIBUTION', 'Aportació a reserva'))),
    h('label', { text: 'Partida superior ' }, h('select', { attrs: { name: 'parent' } }, option('', 'Cap'),
      ...data.lines.map(row => option(row.id, `${row.code} · ${row.name}`)))),
    h('label', { text: 'Import inicial (€) ' }, h('input', { attrs: { name: 'planned', inputmode: 'decimal', required: true } })),
    h('button', { className: 'btn btn-secondary', text: 'Afig partida', attrs: { type: 'submit' } })));
    section.append(h('button', { className: 'btn btn-primary', text: 'Proposa el pressupost', attrs: { type: 'button' },
      on: { click: () => void send(`/api/finance/budgets/${budget.id}/propose`, { expectedVersion: budget.version }) } }));
  }
  if (caps.approveBudget && budget.status === 'PROPOSED') section.append(h('button', { className: 'btn btn-primary',
    text: 'Aprova el pressupost', attrs: { type: 'button' },
    on: { click: () => void send(`/api/finance/budgets/${budget.id}/approve`, { expectedVersion: budget.version }) } }));
  if (caps.proposeBudget && budget.status === 'APPROVED' && round.status !== 'CLOSED') section.append(h('form',
    { on: { submit: event => { event.preventDefault(); const form = new FormData(event.currentTarget);
      const deltaCents = parseEuros(form.get('delta'), { allowNegative: true });
      if (!deltaCents) { notice.textContent = 'Introdueix una variació diferent de zero.'; return; }
      void send('/api/finance/budget-revisions', { budgetId: budget.id, lineId: form.get('line'), deltaCents });
    } } }, h('h3', { text: 'Proposa una revisió' }),
    h('label', { text: 'Partida ' }, h('select', { attrs: { name: 'line' } },
      ...data.lines.filter(row => !row.hasChildren).map(row => option(row.id, `${row.code} · ${row.name}`)))),
    h('label', { text: 'Variació en euros ' }, h('input', { attrs: { name: 'delta', inputmode: 'decimal', required: true } })),
    h('button', { className: 'btn btn-secondary', text: 'Proposa revisió', attrs: { type: 'submit' } })));
  const revisionRows = data.revisions.map(row => {
    const approve = caps.approveBudget && row.status === 'PROPOSED' ? h('button', {
      className: 'btn btn-secondary', text: 'Aprova', attrs: { type: 'button' },
      on: { click: () => void send(`/api/finance/budget-revisions/${row.id}/decision`,
        { decision: 'APPROVE', expectedVersion: row.version }) }
    }) : null;
    return h('li', {}, h('span', { text: `${data.lines.find(line => line.id === row.lineId)?.name ?? 'Partida'} · ${formatEur(row.deltaCents, { signed: true })} · ${row.status}` }), approve);
  });
  if (revisionRows.length) section.append(h('details', {}, h('summary', { text: 'Historial de revisions' }),
    h('ul', { className: 'mini-list' }, revisionRows)));
  section.append(notice); root.append(section);
}
