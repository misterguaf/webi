// Tresoreria (3.5G.2A, docs/design/screens/TREASURY_*.md). View module following view-registry.js: the
// controller owns the #/tresoreria routes (Inici · Moviments · Despeses) and composes the screens. The
// tabs follow /api/me advisory capabilities; every request is authorised by the server.
import { announce, h } from '../ui.js';
import { renderHome } from './treasury/home.js';
import { renderMovementDetail, renderMovementList } from './treasury/movements.js';
import { renderExpenseDetail, renderExpenseList } from './treasury/expenses.js';
import { availableTabs, errorCopy, treasuryAvailable } from './treasury/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TITLES = { inici: 'Tresoreria', moviments: 'Moviments', despeses: 'Despeses' };

export function createTreasuryView({ call, reportLoadError, routes, setPageHeader, setNavBadge }) {
  const root = $('treasuryView');
  let me = null, summary = null, token = 0;
  const lastQuery = { moviments: {}, despeses: {} };
  const go = ({ path = [], query = {} }, options) => routes.go({ page: 'tresoreria', path, query }, options);
  const ctx = {
    call, caps: () => me?.capabilities ?? {}, summary: () => summary, go,
    back: tab => go({ path: [tab], query: lastQuery[tab] ?? {} }),
    refreshSummary
  };
  async function refreshSummary() {
    try {
      summary = await call('/api/finance/summary');
      setNavBadge('tresoreria', (summary.movements?.pendingCount ?? 0) + (summary.movements?.duplicateCount ?? 0));
    } catch (error) {
      if (error.status !== 401) setNavBadge('tresoreria', 0);
      throw error;
    }
    return summary;
  }
  const onScreen = () => document.body.dataset.page === 'tresoreria';

  async function render(route) {
    const mine = ++token;
    const tabs = availableTabs(me.capabilities);
    const [segment = 'inici', id] = route?.path ?? [];
    const tab = tabs.find(item => item.id === segment);
    if (!tab) { go({ path: tabs[0]?.id && tabs[0].id !== 'inici' ? [tabs[0].id] : [] }, { replace: true }); return; }
    if (id && (!UUID.test(id) || tab.id === 'inici')) { go({ path: tab.id === 'inici' ? [] : [tab.id] }, { replace: true }); return; }
    if (!id && tab.id !== 'inici') lastQuery[tab.id] = route.query ?? {};
    const content = h('div', { className: 'treasury-content' });
    root.replaceChildren(
      h('nav', { className: 'tabs treasury-tabs', attrs: { 'aria-label': 'Tresoreria' } }, tabs.map(item => h('a', { className: 'tab', text: item.label,
        attrs: { href: `#/tresoreria${item.id === 'inici' ? '' : `/${item.id}`}`, 'aria-current': item.id === tab.id ? 'page' : false, 'aria-selected': String(item.id === tab.id) },
        on: { click: event => { event.preventDefault(); go({ path: item.id === 'inici' ? [] : [item.id], query: item.id === 'inici' ? {} : lastQuery[item.id] }); } } }))),
      content);
    if (onScreen()) {
      setPageHeader({ title: 'Tresoreria', subtitle: summary?.round ? `Ronda ${summary.round.code}` : null });
      document.title = `${TITLES[tab.id]} · Gestió`;
    }
    try {
      if (!summary || tab.id === 'inici') await refreshSummary();
      if (mine !== token) return;
      if (onScreen()) setPageHeader({ title: 'Tresoreria', subtitle: summary?.round ? `Ronda ${summary.round.code}` : 'Sense ronda econòmica oberta' });
      if (tab.id === 'inici') renderHome(content, ctx, summary);
      else if (tab.id === 'moviments') await (id ? renderMovementDetail(content, ctx, id) : renderMovementList(content, ctx, route.query ?? {}));
      else await (id ? renderExpenseDetail(content, ctx, id) : renderExpenseList(content, ctx, route.query ?? {}));
      if (id) announce(document.title);
    } catch (error) {
      if (mine !== token || error.status === 401) return;
      reportLoadError(error);
      content.replaceChildren(h('div', { className: 'activity-surface' }, h('div', { className: 'inline-error', attrs: { role: 'alert' } },
        h('p', { text: errorCopy(error) }), h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void render(route) } }))));
    }
  }

  return {
    id: 'treasury', page: 'tresoreria',
    available: caps => treasuryAvailable(caps),
    async load(nextMe) {
      me = nextMe; root.hidden = false;
      try { await refreshSummary(); } catch { /* shown when the page is entered */ }
    },
    async enter(nextMe, route) { me = nextMe; root.hidden = false; await render(route); },
    unload() { token++; me = null; summary = null; root.hidden = true; root.replaceChildren(); setNavBadge('tresoreria', 0); }
  };
}
