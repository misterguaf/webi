// Activitat (3.5H.3): the global, human-readable feed of what people did in Gestió, for every signed-in user.
// Each item comes already redacted for this viewer from GET /api/activity; links are rendered only when the
// server provides one (the viewer could already open that resource). View contract: ../view-registry.js.
import { h, icon } from '../ui.js';
import { CATEGORIES, KINDS, apiQuery, categoryLabel, emptyCopy, groupByDay, hasFilters, hrefOf, parseFilters } from './activity-feed/model.js';

const $ = id => document.getElementById(id);
const time = ms => new Intl.DateTimeFormat('ca-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

export function createActivityFeedView({ call, reportLoadError, routes, setPageHeader }) {
  const root = () => $('activityFeedView');
  let token = 0, actors = null, filters = parseFilters();
  const go = (query, options) => routes.go({ page: 'activitat', query }, options);
  const set = (key, value) => go(Object.fromEntries(Object.entries({ ...filters, [key]: value }).filter(([, v]) => v)), { replace: true });

  function itemNode(item) {
    const href = hrefOf(item.link);
    const text = h('span', { className: 'feed-text', text: item.text });
    return h('li', { className: 'feed-item' },
      h('span', { className: 'feed-time', text: time(item.at) }),
      href ? h('a', { className: 'feed-link', attrs: { href }, on: { click: event => { event.preventDefault(); routes.go({ page: item.link.page, path: item.link.path ?? [] }); } } }, text)
        : text,
      h('span', { className: 'feed-category', text: categoryLabel(item.category) }));
  }
  function renderItems(list, items, now) {
    for (const group of groupByDay(items, now)) {
      let section = list.lastElementChild;
      if (section?.dataset.day !== group.label) {
        section = h('section', { className: 'feed-day', dataset: { day: group.label } }, h('h2', { className: 'feed-day-title', text: group.label }),
          h('ol', { className: 'feed-list', attrs: { role: 'list' } }));
        list.append(section);
      }
      section.querySelector('.feed-list').append(...group.items.map(itemNode));
    }
  }

  async function render(route) {
    const mine = ++token;
    filters = parseFilters(route?.query ?? {});
    setPageHeader({ hidden: false, title: 'Activitat', subtitle: 'Qui ha fet què a Gestió. Només veus els noms i les dades que ja pots consultar.' });
    if (!actors) { try { actors = (await call('/api/activity/actors')).actors; } catch (error) { actors = []; reportLoadError(error); } }
    if (mine !== token) return;
    const search = h('input', { attrs: { type: 'search', value: filters.q, placeholder: 'Busca en l’activitat', 'aria-label': 'Busca en l’activitat', maxlength: 80 } });
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => set('q', search.value.trim()), 350); });
    const select = (label, key, options) => h('label', { className: 'select-field' }, h('span', { text: label }),
      h('select', { attrs: { 'aria-label': label }, on: { change: event => set(key, event.target.value) } },
        options.map(item => h('option', { text: item.label, attrs: { value: item.value, selected: item.value === filters[key] } }))));
    const date = (label, key) => h('label', { className: 'select-field' }, h('span', { text: label }),
      h('input', { attrs: { type: 'date', value: filters[key], 'aria-label': label }, on: { change: event => set(key, event.target.value) } }));
    const typing = !!document.activeElement?.closest?.('.feed-filters .search-field');
    const list = h('div', { className: 'feed' }, h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    const more = h('button', { className: 'btn btn-secondary list-more', text: 'Carrega’n més', attrs: { type: 'button', hidden: true } });
    root().replaceChildren(
      h('div', { className: 'filter-chips feed-categories', attrs: { role: 'group', 'aria-label': 'Mòdul' } }, CATEGORIES.map(item => h('button', {
        className: 'filter-chip', text: item.label, attrs: { type: 'button', 'aria-pressed': String(item.value === filters.categoria) }, on: { click: () => set('categoria', item.value) } }))),
      h('div', { className: 'activity-filters feed-filters' },
        h('label', { className: 'search-field' }, icon('search'), search),
        select('Tipus', 'tipus', KINDS),
        select('Persona', 'persona', [{ value: '', label: 'Totes les persones' }, ...actors.map(actor => ({ value: actor.id, label: actor.name }))]),
        date('Des de', 'des'), date('Fins a', 'fins'),
        hasFilters(filters) ? h('button', { className: 'link-button', text: 'Neteja filtres', attrs: { type: 'button' }, on: { click: () => go({}, { replace: true }) } }) : null),
      h('div', { className: 'activity-surface feed-surface' }, list, more));
    // Filters re-render the screen; keep the caret in the search box while the person is typing.
    if (typing) { search.focus({ preventScroll: true }); search.setSelectionRange(search.value.length, search.value.length); }
    let cursor = null, first = true;
    const now = Date.now();
    async function page() {
      more.disabled = true;
      try {
        const data = await call(`/api/activity?${apiQuery(filters, cursor)}`);
        if (mine !== token) return;
        if (first) { list.replaceChildren(); first = false; }
        renderItems(list, data.items, now);
        if (!list.children.length) list.replaceChildren(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: emptyCopy(filters) })));
        cursor = data.nextCursor; more.hidden = !cursor;
      } catch (error) {
        if (mine !== token) return;
        reportLoadError(error);
        list.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: 'No s’ha pogut carregar l’activitat. Torna-ho a provar.' })));
      } finally { more.disabled = false; }
    }
    more.addEventListener('click', () => void page());
    await page();
  }

  return {
    id: 'activity-feed', page: 'activitat',
    // Every signed-in Gestió user (the server redacts per viewer).
    available: () => true,
    load() { root().hidden = false; },
    enter(_me, route) { root().hidden = false; return render(route); },
    unload() { token++; actors = null; root().hidden = true; root().replaceChildren(); }
  };
}
