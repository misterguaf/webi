// Tresoreria · Inici (3.5G.2A, docs/design/screens/TREASURY_HOME.md): "Què necessita atenció ara?".
// Only reliable figures: position balances, pending work, proposals and recent activity. No result,
// profit or budget consumption until closing and budget execution exist (3.5G.4+).
import { h } from '../../ui.js';
import { batchList, statusBadge } from './movements.js';
import { POSITION_KIND, formatDay, formatEur, movementStatus } from './model.js';

export function renderHome(root, ctx, summary) {
  const nodes = [];
  const attention = [];
  const go = (path, query = {}) => event => { event.preventDefault(); ctx.go({ path, query }); };
  const item = (count, text, path, query) => count > 0 ? h('li', {}, h('a', { className: 'attention-item', attrs: { href: '#/tresoreria' }, on: { click: go(path, query) } },
    h('span', { className: 'attention-count', text: String(count) }), h('span', { className: 'attention-text', text }), h('span', { className: 'attention-arrow', text: '→', attrs: { 'aria-hidden': 'true' } }))) : null;
  if (summary.movements) {
    attention.push(item(summary.movements.pendingCount, summary.movements.pendingCount === 1 ? 'moviment pendent de classificar' : 'moviments pendents de classificar', ['moviments'], { estat: 'pendents' }));
    attention.push(item(summary.movements.partialCount, summary.movements.partialCount === 1 ? 'moviment parcialment imputat' : 'moviments parcialment imputats', ['moviments'], { estat: 'parcials' }));
    attention.push(item(summary.movements.duplicateCount, summary.movements.duplicateCount === 1 ? 'possible duplicat per revisar' : 'possibles duplicats per revisar', ['moviments'], { estat: 'duplicats' }));
  }
  if (summary.expenses) attention.push(item(summary.expenses.proposedCount,
    `${summary.expenses.proposedCount === 1 ? 'despesa proposada' : 'despeses proposades'} (${formatEur(summary.expenses.proposedCents)}, encara no comptades)`, ['despeses'], { estat: 'propostes' }));
  const items = attention.filter(Boolean);
  nodes.push(h('div', { className: 'activity-surface treasury-block', attrs: { role: 'region', 'aria-labelledby': 'treasuryAttention' } },
    h('h2', { className: 'block-title', text: 'Què necessita atenció ara?', attrs: { id: 'treasuryAttention' } }),
    items.length ? h('ul', { className: 'attention-list', attrs: { role: 'list' } }, items) : h('p', { className: 'empty-detail', text: 'Res pendent. Tot està classificat i revisat.' })));
  if (summary.positions) nodes.push(h('div', { className: 'treasury-block-plain', attrs: { role: 'region', 'aria-labelledby': 'treasuryPositions' } },
    h('h2', { className: 'block-title', text: 'Posicions', attrs: { id: 'treasuryPositions' } }),
    h('div', { className: 'position-cards' }, summary.positions.map(position => h('div', { className: 'position-card' },
      h('span', { className: 'fact-label', text: `${POSITION_KIND[position.kind]} · ${position.name}` }),
      h('span', { className: 'fact-value', text: position.kind === 'CARD' ? formatEur(Math.max(0, -position.balanceCents)) : formatEur(position.balanceCents) }),
      h('span', { className: 'fact-extra', text: position.kind === 'CARD' ? 'Pendent de liquidar' : position.hasOpening ? 'Saldo amb el saldo inicial de la ronda' : 'Saldo sense saldo inicial registrat' }))))));
  const columns = [];
  if (summary.movements) columns.push(h('div', { className: 'activity-surface treasury-block', attrs: { role: 'region', 'aria-labelledby': 'treasuryRecent' } },
    h('div', { className: 'block-head' }, h('h2', { className: 'block-title', text: 'Moviments recents', attrs: { id: 'treasuryRecent' } }),
      h('a', { className: 'link-button', attrs: { href: '#/tresoreria/moviments' }, text: 'Veure tots →', on: { click: go(['moviments']) } })),
    summary.movements.recent.length ? h('ul', { className: 'mini-list', attrs: { role: 'list' } }, summary.movements.recent.map(m => h('li', {},
      h('a', { className: 'mini-row', attrs: { href: `#/tresoreria/moviments/${m.id}` }, on: { click: go(['moviments', m.id]) } },
        h('span', { className: 'mini-main', text: m.label }), h('span', { className: `amount ${m.amountCents < 0 ? 'amount-out' : 'amount-in'}`, text: formatEur(m.amountCents, { signed: true }) }),
        h('span', { className: 'tx-sub', text: `${formatDay(m.operationDate)} · ${m.positionName}` }), statusBadge(movementStatus(m.status))))))
      : h('p', { className: 'empty-detail', text: 'Encara no hi ha moviments.' })));
  if (summary.expenses) columns.push(h('div', { className: 'activity-surface treasury-block', attrs: { role: 'region', 'aria-labelledby': 'treasuryExpenses' } },
    h('div', { className: 'block-head' }, h('h2', { className: 'block-title', text: 'Despeses reconegudes recents', attrs: { id: 'treasuryExpenses' } }),
      h('a', { className: 'link-button', attrs: { href: '#/tresoreria/despeses' }, text: 'Veure totes →', on: { click: go(['despeses']) } })),
    summary.expenses.recentRecognised.length ? h('ul', { className: 'mini-list', attrs: { role: 'list' } }, summary.expenses.recentRecognised.map(e => h('li', {},
      h('a', { className: 'mini-row', attrs: { href: `#/tresoreria/despeses/${e.id}` }, on: { click: go(['despeses', e.id]) } },
        h('span', { className: 'mini-main', text: e.concept }), h('span', { className: 'amount', text: formatEur(e.totalCents) }),
        h('span', { className: 'tx-sub', text: [formatDay(e.expenseDate), e.counterparty].filter(Boolean).join(' · ') })))))
      : h('p', { className: 'empty-detail', text: 'Encara no hi ha despeses reconegudes.' })));
  if (columns.length) nodes.push(h('div', { className: 'treasury-columns' }, columns));
  if (summary.movements) nodes.push(h('div', { className: 'activity-surface treasury-block', attrs: { role: 'region', 'aria-labelledby': 'treasuryBatches' } },
    h('h2', { className: 'block-title', text: 'Importacions recents', attrs: { id: 'treasuryBatches' } }),
    h('p', { className: 'field-hint', text: 'Només consulta. La importació d’extractes reals no està disponible en esta fase.' }),
    batchList(summary.movements.recentBatches)));
  root.replaceChildren(...nodes);
}
