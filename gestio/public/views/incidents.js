// Incidències i millores (3.5H.3). Everybody: "Les meues" and a small report form (type, title, description;
// the module comes from the page they were on). Managers (admin.incidents.manage): every report, filters,
// detail, start, resolve with a short answer, reopen, and an OPEN badge in the navigation. No priority,
// attachments, comments or notifications. View contract: ../view-registry.js.
import { formDialog, h, icon, toast } from '../ui.js';
import { ACTION_LABELS, ENVIRONMENTS, MODULES, RESOLUTION_SUGGESTIONS, STATUS, TYPES, VIEWS, actionsFor, apiQuery, errorCopy, moduleFromPage, moduleLabel,
  environmentOf, parseFilters, statusOf, typeLabel } from './incidents/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = ms => new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
const badge = ({ label, tone }) => h('span', { className: `badge tone-${tone}`, text: label });
const envBadge = value => { const env = environmentOf(value); return h('span', { className: `badge env-badge tone-${env.tone}`, text: env.label, attrs: { title: 'Entorn on s’ha creat' } }); };

export function createIncidentsView({ call, reportLoadError, routes, setPageHeader, setNavBadge, onNavigate }) {
  const root = () => $('incidentsView');
  // The page visited before Incidències pre-fills where a report happened (nobody needs to know module names).
  let previousPage = 'inici';
  onNavigate(page => { if (page !== 'incidencies') previousPage = page; });
  let me = null, token = 0, route = { page: 'incidencies', path: [], query: {} };
  const manage = () => !!me?.capabilities?.incidents?.manage;
  const go = (path = [], query = {}, options) => routes.go({ page: 'incidencies', path, query }, options);

  async function refreshBadge() {
    if (!manage()) { setNavBadge('incidencies', 0); return; }
    try { setNavBadge('incidencies', (await call('/api/work-incidents/summary')).open ?? 0); } catch { /* the badge is advisory */ }
  }

  async function report() {
    const values = await formDialog({ title: 'Reporta una incidència o una millora', confirm: 'Envia', fields: [
      { name: 'type', label: 'Què vols comunicar?', type: 'select', value: 'ERROR', options: TYPES.map(item => ({ value: item.value, label: `${item.label} — ${item.hint}` })) },
      { name: 'title', label: 'Títol curt', required: true, attrs: { maxlength: 120, placeholder: 'Ex.: No puc obrir una inscripció' } },
      { name: 'description', label: 'Explica-ho (opcional)', type: 'textarea', attrs: { maxlength: 2000, placeholder: 'Què feies, què esperaves i què ha passat. No hi poses dades de salut ni contactes.' } },
      { name: 'module', label: 'On ha passat?', type: 'select', value: moduleFromPage(previousPage), options: MODULES }] });
    if (!values) return;
    try {
      const created = await call('/api/work-incidents', { method: 'POST', body: JSON.stringify({ type: values.type, title: values.title,
        ...(values.description.trim() ? { description: values.description } : {}), module: values.module }) });
      toast('Gràcies. L’hem rebut i el podràs seguir a «Les meues».');
      await refreshBadge();
      go([created.id]);
    } catch (error) { toast(errorCopy(error), { tone: 'danger', timeout: 7000 }); }
  }

  async function renderList() {
    const mine = ++token;
    const filters = parseFilters(route.query, manage());
    setPageHeader({ hidden: false, title: 'Incidències i millores', subtitle: manage() ? 'Reports de tot el grup i les teues pròpies.' : 'Comunica un error o una idea i segueix-ne l’estat.' });
    const set = (key, value) => go([], Object.fromEntries(Object.entries({ ...filters, [key]: value }).filter(([k, v]) => v && !(k === 'vista' && v === 'meues'))), { replace: true });
    const select = (label, key, options) => h('label', { className: 'select-field' }, h('span', { text: label }),
      h('select', { attrs: { 'aria-label': label }, on: { change: event => set(key, event.target.value) } },
        options.map(item => h('option', { text: item.label, attrs: { value: item.value, selected: item.value === filters[key] } }))));
    const list = h('div', { className: 'activity-surface' }, h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    root().replaceChildren(
      h('div', { className: 'incidents-toolbar' },
        manage() ? h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Vista' } }, VIEWS.map(item => h('button', { className: 'filter-chip', text: item.label,
          attrs: { type: 'button', 'aria-pressed': String(item.value === filters.vista) }, on: { click: () => set('vista', item.value) } }))) : h('h2', { className: 'group-title', text: 'Les meues' }),
        h('button', { className: 'btn btn-primary', attrs: { type: 'button' }, on: { click: report } }, icon('plus'), h('span', { text: 'Reporta' }))),
      h('div', { className: 'activity-filters incidents-filters' },
        select('Estat', 'estat', [{ value: '', label: 'Tots' }, ...Object.entries(STATUS).map(([value, item]) => ({ value, label: item.label }))]),
        select('Tipus', 'tipus', [{ value: '', label: 'Tots' }, ...TYPES]),
        filters.vista === 'totes' ? select('Mòdul', 'modul', [{ value: '', label: 'Tots' }, ...MODULES]) : null,
        filters.vista === 'totes' ? select('Entorn', 'entorn', [{ value: '', label: 'Tots' }, ...ENVIRONMENTS]) : null),
      list);
    try {
      const { incidents } = await call(`/api/work-incidents?${apiQuery(filters)}`);
      if (mine !== token) return;
      list.replaceChildren(incidents.length ? h('ul', { className: 'tx-list incidents-list', attrs: { role: 'list' } }, incidents.map(item => h('li', { className: 'incidents-row' },
        h('a', { className: 'tx-label', attrs: { href: `#/incidencies/${item.id}` }, on: { click: event => { event.preventDefault(); go([item.id]); } } },
          h('span', { className: 'tx-label-text', text: item.title }),
          h('span', { className: 'tx-sub', text: [typeLabel(item.type), item.origin === 'SYSTEM' ? 'Detectada pel sistema' : filters.vista === 'totes' ? item.reporter : null,
            moduleLabel(item.module), day(item.createdAt)].filter(Boolean).join(' · ') }),
          item.status === 'RESOLVED' && item.resolution ? h('span', { className: 'tx-sub incidents-answer', text: `Resposta: ${item.resolution}` }) : null),
        h('span', { className: 'incidents-badges' }, filters.vista === 'totes' ? envBadge(item.environment) : null, badge(statusOf(item.status))))))
        : h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: filters.vista === 'totes' ? 'No hi ha cap report amb aquests filtres.'
          : 'Encara no has reportat res. Si alguna cosa falla o es pot millorar, fes-nos-ho saber ací.' })));
    } catch (error) {
      if (mine !== token) return;
      reportLoadError(error);
      list.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) })));
    }
  }

  async function renderDetail(id) {
    const mine = ++token;
    setPageHeader({ hidden: true });
    root().replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    let data;
    try { data = await call(`/api/work-incidents/${id}`); }
    catch (error) {
      if (mine !== token) return;
      root().replaceChildren(h('a', { className: 'back-link', attrs: { href: '#/incidencies' }, on: { click: event => { event.preventDefault(); go(); } } }, icon('arrow-left'), h('span', { text: 'Incidències i millores' })),
        h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) })));
      return;
    }
    if (mine !== token) return;
    const item = data.incident;
    const post = async (step, body = {}, success) => {
      try { await call(`/api/work-incidents/${id}/${step}`, { method: 'POST', body: JSON.stringify({ expectedVersion: item.version, ...body }) }); toast(success); await refreshBadge(); await renderDetail(id); }
      catch (error) { toast(errorCopy(error), { tone: 'danger', timeout: 7000 }); if (error.code === 'stale_incident') await renderDetail(id); }
    };
    const handlers = {
      start: () => post('start', {}, 'Incidència en curs'),
      resolve: async () => {
        const values = await formDialog({ title: 'Marcar com a resolta', confirm: 'Resol', fields: [
          { name: 'resolution', label: 'Resposta curta per a qui ho ha reportat (opcional)', type: 'textarea', value: RESOLUTION_SUGGESTIONS[0], attrs: { maxlength: 280 } }] });
        if (values) await post('resolve', values.resolution.trim() ? { resolution: values.resolution.trim() } : {}, 'Incidència resolta');
      },
      reopen: () => post('reopen', {}, 'Incidència reoberta')
    };
    const actions = actionsFor(item, data.actions.manage);
    const row = (label, value) => value ? h('div', { className: 'info-row' }, h('dt', { text: label }), h('dd', { text: value })) : null;
    root().replaceChildren(h('article', { className: 'incidents-detail' },
      h('header', { className: 'detail-header' },
        h('a', { className: 'back-link', attrs: { href: '#/incidencies' }, on: { click: event => { event.preventDefault(); go([], data.actions.manage ? route.query : {}); } } }, icon('arrow-left'), h('span', { text: 'Incidències i millores' })),
        h('div', { className: 'detail-title-row' }, h('h1', { className: 'detail-title', text: item.title, attrs: { tabindex: '-1' } }), badge(statusOf(item.status))),
        actions.length ? h('div', { className: 'detail-actions' }, actions.map(action => h('button', { className: `btn ${action === 'resolve' ? 'btn-primary' : 'btn-secondary'}`,
          text: ACTION_LABELS[action], attrs: { type: 'button' }, on: { click: handlers[action] } }))) : null),
      h('div', { className: 'activity-surface info-surface' },
        h('div', { className: 'info-block' }, h('dl', { className: 'info-list' },
          row('Tipus', typeLabel(item.type)), row('Entorn', environmentOf(item.environment).label), row('Origen', item.origin === 'SYSTEM' ? 'Detectada pel sistema' : 'Report manual'),
          row('Reportada per', item.reporter), row('On', moduleLabel(item.module)), row('Data', day(item.createdAt)),
          row('Començada', item.startedAt ? day(item.startedAt) : null), row('Resolta', item.resolvedAt ? day(item.resolvedAt) : null))),
        item.description ? h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Descripció' }), h('p', { className: 'incidents-description', text: item.description })) : null,
        item.resolution ? h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Resposta' }), h('p', { text: item.resolution })) : null,
        item.resource ? h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Referència' }),
          item.resource.link ? h('a', { className: 'link-button', text: `Obri la ${item.resource.label.toLocaleLowerCase('ca')}`, attrs: { href: `#/${[item.resource.link.page, ...item.resource.link.path].join('/')}` },
            on: { click: event => { event.preventDefault(); routes.go({ page: item.resource.link.page, path: item.resource.link.path }); } } })
            : h('p', { className: 'field-hint', text: `${item.resource.label} fora del teu abast.` })) : null)));
    root().querySelector('.detail-title')?.focus({ preventScroll: true });
  }

  function renderRoute() {
    const id = route.path[0];
    if (id && UUID.test(id)) void renderDetail(id);
    else if (id) go([], {}, { replace: true });
    else void renderList();
  }
  return {
    id: 'incidents', page: 'incidencies',
    // Every signed-in user can report and follow their own reports.
    available: () => true,
    async load(nextMe) { me = nextMe; root().hidden = false; await refreshBadge(); },
    enter(nextMe, nextRoute) { me = nextMe; root().hidden = false; route = nextRoute ?? { page: 'incidencies', path: [], query: {} }; renderRoute(); },
    unload() { me = null; token++; root().hidden = true; root().replaceChildren(); setNavBadge('incidencies', 0); }
  };
}
