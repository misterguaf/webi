// Activitats list (ACTIVITIES.md §5–§8): status segments, search, section and time filters (URL-backed),
// one calm column of rich rows grouped by situation, and every list state of §20.
import { announce, h, icon } from '../../ui.js';
import { STATUS_FILTERS, STATUS_LABELS, WHEN_FILTERS, accessibleRowName, activeFilterCount, canCreate, canManage, dateRange,
  dayNumber, filterActivities, filtersDiffer, flatActivities, groupActivities, parseFilters, phase, scopeLabel, sectionOptions,
  shortMonth, signals, statusCounts } from './model.js';

const SKELETON_ROWS = 4;

/**
 * @param {{root: HTMLElement, onFilters: (filters: any) => void, onOpen: (id: string, event: Event) => void,
 *   onCreate: () => void, onRetry: () => void}} options
 */
export function createActivityList({ root, onFilters, onOpen, onCreate, onRetry }) {
  let filters = parseFilters({});
  let lastRows = null, caps = null, firstPaint = true, mobileSheetOpen = false;

  // ---- toolbar (persistent: re-rendering rows never steals focus from the search field)
  const tabs = STATUS_FILTERS.map(option => h('button', { className: 'segment', attrs: { type: 'button', role: 'tab', 'aria-selected': 'false',
    'aria-controls': 'activityResults', tabindex: '-1' }, dataset: { value: option.value } },
  h('span', { className: 'segment-label', text: option.label }), h('span', { className: 'segment-count' })));
  const segmented = h('div', { className: 'segmented', attrs: { role: 'tablist', 'aria-label': 'Estat de les activitats' } }, tabs);
  for (const tab of tabs) {
    tab.addEventListener('click', () => update({ estat: tab.dataset.value }));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target = tabs[(next + tabs.length) % tabs.length];
      target.focus(); update({ estat: target.dataset.value });
    });
  }
  const search = h('input', { className: 'search-input', attrs: { type: 'search', id: 'activitySearch', placeholder: 'Busca una activitat…',
    autocomplete: 'off', 'aria-label': 'Busca una activitat', maxlength: '80' } });
  search.addEventListener('input', () => update({ q: search.value }));
  const sectionSelect = h('select', { attrs: { id: 'activitySectionFilter' } });
  const whenSelect = h('select', { attrs: { id: 'activityWhenFilter' } }, WHEN_FILTERS.map(option => h('option', { text: option.label, attrs: { value: option.value } })));
  sectionSelect.addEventListener('change', () => update({ seccio: sectionSelect.value }));
  whenSelect.addEventListener('change', () => update({ quan: whenSelect.value }));
  const reset = h('button', { className: 'link-button filters-reset', text: 'Neteja filtres', attrs: { type: 'button' },
    on: { click: () => { update({ estat: '', seccio: '', quan: '', q: '' }); search.focus(); } } });
  const mobileFilters = h('button', { className: 'btn btn-secondary filters-toggle', attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    on: { click: () => openFilterSheet() } });
  const progress = h('span', { className: 'list-progress', attrs: { role: 'status', 'aria-label': 'Actualitzant' }, text: '' });
  const toolbar = h('div', { className: 'activity-toolbar' }, segmented,
    h('div', { className: 'activity-filters' },
      h('label', { className: 'search-field', attrs: { for: 'activitySearch' } }, icon('search'), search),
      h('label', { className: 'select-field' }, h('span', { text: 'Secció' }), sectionSelect),
      h('label', { className: 'select-field' }, h('span', { text: 'Quan' }), whenSelect),
      mobileFilters, reset, progress));
  const count = h('p', { className: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
  const results = h('div', { className: 'activity-surface', attrs: { id: 'activityResults', role: 'tabpanel', 'aria-label': 'Activitats' } });
  root.replaceChildren(toolbar, count, results);

  function update(change) {
    filters = { ...filters, ...change };
    onFilters(filters, { replace: true });
  }

  // ---- mobile filter sheet (Secció + Quan, Aplica / Neteja)
  function openFilterSheet() {
    if (mobileSheetOpen) return;
    mobileSheetOpen = true;
    const previous = document.activeElement;
    const sheetSection = sectionSelect.cloneNode(true), sheetWhen = whenSelect.cloneNode(true);
    sheetSection.id = 'activitySectionFilterSheet'; sheetWhen.id = 'activityWhenFilterSheet';
    sheetSection.value = filters.seccio; sheetWhen.value = filters.quan;
    const close = () => { mobileSheetOpen = false; layer.remove(); document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    const sheet = h('div', { className: 'filter-sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Filtres' } },
      h('h2', { className: 'sheet-title', text: 'Filtres' }),
      h('label', { className: 'field' }, h('span', { className: 'field-label', text: 'Secció' }), sheetSection),
      h('label', { className: 'field' }, h('span', { className: 'field-label', text: 'Quan' }), sheetWhen),
      h('div', { className: 'sheet-actions' },
        h('button', { className: 'btn btn-secondary', text: 'Neteja', attrs: { type: 'button' }, on: { click: () => { close(); update({ seccio: '', quan: '' }); } } }),
        h('button', { className: 'btn btn-primary', text: 'Aplica', attrs: { type: 'button' }, on: { click: () => { close(); update({ seccio: sheetSection.value, quan: sheetWhen.value }); } } })));
    const layer = h('div', { className: 'sheet-layer', on: { mousedown: event => { if (event.target === layer) close(); } } }, sheet);
    document.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    sheetSection.focus();
  }

  // ---- rows
  function row(activity, now, animate) {
    const current = phase(activity, now);
    const manageable = canManage(activity, caps);
    const items = signals(activity, now);
    const status = h('span', { className: `badge badge-${activity.status.toLowerCase()}`, text: STATUS_LABELS[activity.status] });
    const signalNodes = current === 'draft'
      ? (manageable ? [h('span', { className: 'row-signal row-continue', text: 'Continuar editant →' })] : [])
      : items.map(item => h('span', { className: `row-signal signal-${item.tone}`, text: item.text }));
    const link = h('a', { className: `activity-row row-${current}${animate ? ' row-enter' : ''}`,
      attrs: { href: `#/activitats/${activity.id}`, 'aria-label': accessibleRowName(activity, now) }, dataset: { id: activity.id },
      on: { click: event => onOpen(activity.id, event) } },
    h('span', { className: 'date-tile', attrs: { 'aria-hidden': 'true' } },
      h('span', { className: 'date-day', text: dayNumber(activity.starts_at) }), h('span', { className: 'date-month', text: shortMonth(activity.starts_at) })),
    h('span', { className: 'row-name', text: activity.name }),
    h('span', { className: 'row-meta', text: `${scopeLabel(activity)} · ${dateRange(activity.starts_at, activity.ends_at)}` }),
    activity.location ? h('span', { className: 'row-location', text: activity.location }) : null,
    h('span', { className: 'row-status' }, status),
    h('span', { className: 'row-signals' }, signalNodes),
    icon('chevron-right', 'row-chevron'));
    return h('li', { className: 'activity-item' }, link);
  }
  function emptyState(title, detail, action) {
    return h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: title }),
      detail ? h('p', { className: 'empty-detail', text: detail }) : null, action);
  }

  /**
   * @param {{rows: any[]|null, caps: any, query: any, now?: number, loading?: boolean, error?: any, highlight?: string|null}} state
   */
  function render({ rows, caps: capabilities, query, now = Date.now(), loading = false, error = null, highlight = null }) {
    caps = capabilities;
    filters = parseFilters(query);
    if (document.activeElement !== search) search.value = filters.q;
    whenSelect.value = filters.quan;
    const options = sectionOptions(rows ?? []);
    sectionSelect.replaceChildren(...options.map(option => h('option', { text: option.label, attrs: { value: option.value } })));
    sectionSelect.value = options.some(option => option.value === filters.seccio) ? filters.seccio : '';
    const counts = rows ? statusCounts(rows, filters, now) : null;
    for (const tab of tabs) {
      const selected = tab.dataset.value === filters.estat;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.querySelector('.segment-count').textContent = counts ? String(counts[tab.dataset.value]) : '';
    }
    const active = activeFilterCount(filters);
    mobileFilters.textContent = active ? `Filtres (${active})` : 'Filtres';
    reset.hidden = !filtersDiffer(filters);
    progress.hidden = !(loading && rows);
    results.setAttribute('aria-busy', String(loading));

    if (!rows && loading) {
      results.replaceChildren(h('ul', { className: 'activity-rows skeleton-rows', attrs: { 'aria-hidden': 'true' } },
        Array.from({ length: SKELETON_ROWS }, () => h('li', { className: 'skeleton-row' }, h('span', { className: 'skeleton-tile' }),
          h('span', { className: 'skeleton-lines' }, h('span', { className: 'skeleton-line' }), h('span', { className: 'skeleton-line short' }))))));
      return;
    }
    if (!rows && error) {
      results.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } },
        h('p', { text: 'No s’han pogut carregar les activitats.' }),
        h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: onRetry } })));
      return;
    }
    if (!rows) return;
    const visible = filterActivities(rows, filters, now);
    lastRows = rows;
    if (!rows.length) {
      results.replaceChildren(emptyState('Encara no hi ha activitats.', canCreate(caps) ? 'Crea la primera activitat per a començar.' : null,
        canCreate(caps) ? h('button', { className: 'btn btn-primary', text: 'Nova activitat', attrs: { type: 'button' }, on: { click: onCreate } }) : null));
      count.textContent = '0 activitats';
      return;
    }
    if (!visible.length) {
      results.replaceChildren(emptyState('Cap activitat coincideix amb els filtres.', null,
        h('button', { className: 'btn btn-secondary', text: 'Neteja filtres', attrs: { type: 'button' },
          on: { click: () => update({ estat: '', seccio: '', quan: '', q: '' }) } })));
      announce('Cap activitat coincideix amb els filtres');
      return;
    }
    const animate = firstPaint;
    firstPaint = false;
    const build = list => h('ul', { className: 'activity-rows', attrs: { role: 'list' } }, list.map(activity => {
      const item = row(activity, now, animate);
      if (activity.id === highlight) item.firstChild.classList.add('row-inserted');
      return item;
    }));
    if (filters.estat) results.replaceChildren(build(flatActivities(visible, now)));
    else results.replaceChildren(...groupActivities(visible, now).map(group => h('section', { className: 'activity-group', attrs: { 'aria-labelledby': `group-${group.id}` } },
      h('h2', { className: 'group-title', attrs: { id: `group-${group.id}` } }, h('span', { text: group.label }), h('span', { className: 'group-count', text: String(group.rows.length) })),
      build(group.rows))));
    const text = `${visible.length} ${visible.length === 1 ? 'activitat' : 'activitats'}`;
    if (count.textContent !== text) { count.textContent = text; if (!animate) announce(text); }
  }
  return {
    render,
    /** Logout / lost capability: drop every rendered row and the typed search. */
    clear() { results.replaceChildren(); search.value = ''; count.textContent = ''; lastRows = null; firstPaint = true; },
    focusRow(id) { root.querySelector(`.activity-row[data-id="${id}"]`)?.focus({ preventScroll: true }); },
    rowRect(id) { return root.querySelector(`.activity-row[data-id="${id}"]`)?.getBoundingClientRect() ?? null; },
    lastRows: () => lastRows
  };
}
