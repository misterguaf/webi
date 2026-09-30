// Participants (3.5E, docs/design/screens/PARTICIPANTS.md). View module (view-registry.js): the
// controller owns the #/participants routes and composes the list and the participant record. It
// replaces the legacy bullet list. Batch 2 is the read surface (list + Fitxa); the guided create,
// edit, section change and the Família tab are added in later batches.
import { fetchAllPages } from '../api.js';
import { announce, h, icon } from '../ui.js';
import { accessibleRowName, canCreate, completenessSignal, ESTAT_FILTERS, feeLabel,
  filterParticipants, filtersDiffer, filtersToQuery, groupBySection, historyReason, initials, missingSummary, parseFilters,
  scopeSubtitle, sectionName, sectionOptions, statusLabel } from './participants/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STALE_AFTER_MS = 30000;
const longDate = value => value == null ? '' : new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
const monthYear = value => value == null ? '' : new Intl.DateTimeFormat('ca-ES', { month: 'short', year: 'numeric' }).format(new Date(value));

export function createParticipantsView({ call, reportLoadError, routes, setPageHeader, setContextAction }) {
  const view = $('participantsView'), listRoot = $('participantsList'), detailRoot = $('participantDetail');
  let me = null, rows = null, listError = null, loading = null, loadedAt = 0, loadedStatus = 'actius';
  let route = { page: 'participants', path: [], query: {} };
  let search = '', listScroll = 0, lastOpened = null, wasOnList = false, openedFromList = false, lastListQuery = {};

  const caps = () => me?.capabilities;
  const sections = () => me?.capabilities?.sections ?? [];

  async function refresh({ force = false } = {}) {
    if (!me) return;
    const status = parseFilters(route.query).estat === 'de-baixa' ? 'de-baixa' : 'actius';
    if (loading) return loading;
    if (!force && rows && loadedStatus === status && Date.now() - loadedAt < STALE_AFTER_MS) return;
    listError = null; loadedStatus = status;
    loading = (async () => {
      if (!route.path[0]) renderList();
      try {
        const data = await fetchAllPages(call, `/api/participants${status === 'de-baixa' ? '?estat=de-baixa' : ''}`, 'participants');
        rows = data.participants; loadedAt = Date.now();
      } catch (error) { listError = error; if (!rows) reportLoadError(error); }
      finally { loading = null; }
      if (!route.path[0]) renderList();
    })();
    return loading;
  }

  // ---------------------------------------------------------------- list
  function update(change) {
    const filters = { ...parseFilters(route.query), ...change };
    routes.go({ page: 'participants', query: filtersToQuery(filters) }, { replace: true });
  }
  function row(participant) {
    const signal = completenessSignal(participant.completeness);
    return h('li', { className: 'participant-item' },
      h('a', { className: 'participant-row', attrs: { href: `#/participants/${participant.id}`,
        'aria-label': accessibleRowName(participant, sections()) }, dataset: { id: participant.id },
      on: { click: event => openOnClick(participant.id, event) } },
      h('span', { className: 'avatar person-avatar', attrs: { 'aria-hidden': 'true' }, text: initials(participant.display_name) }),
      h('span', { className: 'person-name', text: participant.display_name }),
      h('span', { className: 'person-section', text: sectionName(participant.current_section_id, sections()) }),
      signal ? h('span', { className: `person-signal signal-${signal.tone}`, text: signal.text }) : null,
      icon('chevron-right', 'row-chevron')));
  }
  function renderList() {
    const onScreen = document.body.dataset.page === 'participants';
    listRoot.hidden = false; detailRoot.hidden = true;
    const filters = parseFilters(route.query);
    if (onScreen) {
      if (JSON.stringify(filtersToQuery(filters)) !== JSON.stringify(route.query)) { routes.go({ page: 'participants', query: filtersToQuery(filters) }, { replace: true }); return; }
      setPageHeader({ title: 'Participants', subtitle: scopeSubtitle(me.capabilities) });
      setContextAction(false);
      document.title = 'Participants · Gestió';
    }
    ensureToolbar(filters);
    const results = $('participantResults');
    if (!rows && loading) { results.replaceChildren(skeleton()); results.setAttribute('aria-busy', 'true'); return; }
    results.setAttribute('aria-busy', String(!!loading));
    if (!rows && listError) { results.replaceChildren(listErrorBox()); return; }
    if (!rows) return;
    const visible = filterParticipants(rows, filters, sections(), search);
    if (!rows.length) { results.replaceChildren(emptyState(filters.estat === 'de-baixa' ? 'No hi ha participants de baixa en les teues seccions.' : 'Encara no hi ha participants en les teues seccions.')); return; }
    if (!visible.length) { results.replaceChildren(emptyState('Cap participant coincideix amb la cerca.',
      h('button', { className: 'btn btn-secondary', text: 'Neteja filtres', attrs: { type: 'button' }, on: { click: clearFilters } }))); announce('Cap participant'); return; }
    results.replaceChildren(...groupBySection(visible, sections()).map(group =>
      h('section', { className: 'participant-group', attrs: { 'aria-label': group.label } },
        h('h2', { className: 'group-title' }, h('span', { text: group.label }), h('span', { className: 'group-count', text: String(group.rows.length) })),
        h('ul', { className: 'participant-rows', attrs: { role: 'list' } }, group.rows.map(row)))));
    const count = `${visible.length} ${visible.length === 1 ? 'participant' : 'participants'}`;
    if (!wasOnList) announce(count);
  }
  let toolbarState = '';
  function ensureToolbar(filters) {
    const state = JSON.stringify([filters, sectionOptions(rows ?? [], sections()).map(o => o.value), canCreate(me.capabilities)]);
    if (toolbarState === state && $('participantResults')) { syncToolbar(filters); return; }
    toolbarState = state;
    const options = sectionOptions(rows ?? [], sections());
    const searchInput = h('input', { className: 'search-input', attrs: { type: 'search', id: 'participantSearch', placeholder: 'Busca pel nom…',
      autocomplete: 'off', 'aria-label': 'Busca pel nom', maxlength: '80', value: search } });
    searchInput.addEventListener('input', () => { search = searchInput.value; renderRowsOnly(); });
    const sectionSelect = h('select', { attrs: { id: 'participantSectionFilter', 'aria-label': 'Secció' } },
      options.map(o => h('option', { text: o.label, attrs: { value: o.value, selected: o.value === filters.seccio } })));
    sectionSelect.addEventListener('change', () => update({ seccio: sectionSelect.value }));
    const estatSelect = h('select', { attrs: { id: 'participantEstatFilter', 'aria-label': 'Estat' } },
      ESTAT_FILTERS.map(o => h('option', { text: o.label, attrs: { value: o.value, selected: o.value === filters.estat } })));
    estatSelect.addEventListener('change', () => update({ estat: estatSelect.value }));
    const compActive = filters.completitud === 'pendents';
    const compToggle = h('button', { className: `btn btn-secondary filter-toggle${compActive ? ' filter-on' : ''}`, attrs: { type: 'button', 'aria-pressed': String(compActive) },
      text: 'Informació pendent', on: { click: () => update({ completitud: compActive ? '' : 'pendents' }) } });
    const reset = h('button', { className: 'link-button filters-reset', text: 'Neteja filtres', attrs: { type: 'button', hidden: !filtersDiffer(filters) }, on: { click: clearFilters } });
    const toolbar = h('div', { className: 'participant-toolbar' },
      h('label', { className: 'search-field', attrs: { for: 'participantSearch' } }, icon('search'), searchInput),
      h('label', { className: 'select-field' }, h('span', { text: 'Secció' }), sectionSelect),
      h('label', { className: 'select-field' }, h('span', { text: 'Estat' }), estatSelect),
      compToggle, reset);
    const results = $('participantResults') ?? h('div', { className: 'participant-surface', attrs: { id: 'participantResults' } });
    listRoot.replaceChildren(toolbar, results);
  }
  function syncToolbar(filters) {
    const s = $('participantSectionFilter'); if (s) s.value = filters.seccio;
    const e = $('participantEstatFilter'); if (e) e.value = filters.estat;
  }
  function renderRowsOnly() {
    const filters = parseFilters(route.query);
    const results = $('participantResults'); if (!results) return;
    const visible = filterParticipants(rows ?? [], filters, sections(), search);
    if (!visible.length) { results.replaceChildren(emptyState('Cap participant coincideix amb la cerca.',
      h('button', { className: 'btn btn-secondary', text: 'Neteja filtres', attrs: { type: 'button' }, on: { click: clearFilters } }))); return; }
    results.replaceChildren(...groupBySection(visible, sections()).map(group =>
      h('section', { className: 'participant-group', attrs: { 'aria-label': group.label } },
        h('h2', { className: 'group-title' }, h('span', { text: group.label }), h('span', { className: 'group-count', text: String(group.rows.length) })),
        h('ul', { className: 'participant-rows', attrs: { role: 'list' } }, group.rows.map(row)))));
  }
  function clearFilters() { search = ''; update({ seccio: '', estat: '', completitud: '' }); }
  const skeleton = () => h('ul', { className: 'participant-rows skeleton-rows', attrs: { 'aria-hidden': 'true' } },
    [1, 2, 3, 4].map(() => h('li', { className: 'skeleton-row' }, h('span', { className: 'skeleton-tile round' }),
      h('span', { className: 'skeleton-lines' }, h('span', { className: 'skeleton-line' })))));
  const emptyState = (title, action) => h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: title }), action ?? null);
  const listErrorBox = () => h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: 'No s’han pogut carregar els participants.' }),
    h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void refresh({ force: true }) } }));

  function openOnClick(id, event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!route.path[0]) { listScroll = window.scrollY; lastListQuery = route.query; openedFromList = true; }
    lastOpened = id;
    routes.go({ page: 'participants', path: [id] });
  }

  // ---------------------------------------------------------------- detail (Fitxa)
  let detailToken = 0;
  async function showDetail(id) {
    const mine = ++detailToken;
    detailRoot.textContent = '';
    detailRoot.append(detailSkeleton());
    try {
      const { participant } = await call(`/api/participants/${id}`);
      if (mine !== detailToken) return;
      renderDetail(participant);
    } catch (error) {
      if (mine !== detailToken || error.status === 401) return;
      detailRoot.replaceChildren(error.status === 404 ? notFound() : detailError(id));
      document.title = 'Participants · Gestió';
    }
  }
  function renderDetail(p) {
    document.title = `${p.displayName} · Participants · Gestió`;
    const title = h('h1', { className: 'detail-title', text: p.displayName, attrs: { tabindex: '-1', id: 'participantDetailTitle' } });
    const badge = h('span', { className: `badge badge-${p.status === 'ACTIVE' ? 'published' : 'closed'}`, text: statusLabel(p.status) });
    const current = p.sectionHistory.find(h2 => h2.ended_at == null);
    const since = current ? `${sectionName(p.currentSectionId, sections())} · des de ${monthYear(current.started_at)}` : sectionName(p.currentSectionId, sections());
    const completeness = p.completeness?.complete === false
      ? h('p', { className: 'detail-timing timing-attention', text: missingSummary(p.completeness.missing) ?? 'Informació pendent' }) : null;
    const fee = feeLine(p.feeStatus);
    const header = h('header', { className: 'detail-header' },
      h('a', { className: 'back-link', attrs: { href: '#/participants' }, on: { click: e => { e.preventDefault(); back(); } } }, icon('arrow-left'), h('span', { text: 'Participants' })),
      h('div', { className: 'detail-heading' }, h('div', { className: 'detail-title-row' }, title, badge)),
      h('p', { className: 'detail-context', text: since }),
      completeness, fee);
    detailRoot.replaceChildren(h('article', { className: 'participant-detail' }, header, fitxa(p)));
    title.focus({ preventScroll: true });
  }
  function feeLine(feeStatus) {
    if (!feeStatus || !feeStatus.length) return null;
    return h('p', { className: 'detail-fees' }, feeStatus.map(item =>
      h('span', { className: 'fee-chip' }, h('span', { className: 'fee-round', text: `Quota ${item.round}:` }),
        h('span', { className: `fee-state fee-${item.status.toLowerCase()}`, text: feeLabel(item.status) }))));
  }
  function fitxa(p) {
    const row2 = (label, value) => value ? h('div', { className: 'info-row' }, h('dt', { text: label }), h('dd', { text: value })) : null;
    const identity = h('section', { className: 'info-block' }, h('h2', { className: 'info-title', text: 'Identitat' }),
      h('dl', { className: 'info-list' }, row2('Nom', p.displayName), p.birthDate ? row2('Data de naixement', longDate(`${p.birthDate}T00:00:00Z`)) : row2('Data de naixement', 'Pendent')));
    const history = h('section', { className: 'info-block' }, h('h2', { className: 'info-title', text: 'Secció' }),
      h('ol', { className: 'history-list' }, p.sectionHistory.map(entry => h('li', { className: entry.ended_at == null ? 'history-current' : '' },
        h('span', { className: 'history-section', text: sectionName(sectionIdByCode(entry.section_code), sections()) || entry.section_code }),
        h('span', { className: 'history-range', text: `${monthYear(entry.started_at)} – ${entry.ended_at == null ? 'actualitat' : monthYear(entry.ended_at)}` }),
        h('span', { className: 'history-reason', text: historyReason(entry.start_reason) })))));
    const admin = (p.provenance || p.createdAt) ? h('section', { className: 'info-block' }, h('h2', { className: 'info-title', text: 'Informació administrativa' }),
      h('dl', { className: 'info-list' }, row2('Procedència', provenanceLabel(p.provenance)),
        p.provenanceNote ? row2('Nota', p.provenanceNote) : null, row2('Alta a Gestió', longDate(p.createdAt)), row2('Última actualització', longDate(p.updatedAt)))) : null;
    return h('div', { className: 'participant-fitxa' }, identity, history, admin);
  }
  function sectionIdByCode(code) { return sections().find(s => s.code === code)?.id ?? null; }
  const PROVENANCE = { CRM_ANTERIOR: 'CRM anterior', DOCUMENTACIO_FISICA: 'Documentació física', COMUNICACIO_FAMILIA: 'Comunicació de la família', ALTRES: 'Altres' };
  const provenanceLabel = value => value ? (PROVENANCE[value] ?? value) : null;

  const detailSkeleton = () => h('div', { className: 'detail-skeleton', attrs: { 'aria-busy': 'true' } },
    h('span', { className: 'skeleton-line short' }), h('span', { className: 'skeleton-block' }), h('span', { className: 'skeleton-line' }));
  const notFound = () => h('div', { className: 'detail-empty', attrs: { role: 'alert' } }, h('p', { className: 'empty-title', text: 'No tens accés a aquest participant o ja no existeix.' }),
    h('a', { className: 'btn btn-secondary', text: 'Torna a Participants', attrs: { href: '#/participants' }, on: { click: e => { e.preventDefault(); routes.go({ page: 'participants' }); } } }));
  const detailError = id => h('div', { className: 'detail-empty', attrs: { role: 'alert' } }, h('p', { className: 'empty-title', text: 'No s’ha pogut carregar el participant.' }),
    h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void showDetail(id) } }));

  function back() {
    if (openedFromList && routes.canGoBack()) routes.back();
    else routes.go({ page: 'participants', query: lastListQuery });
  }

  // ---------------------------------------------------------------- routing
  function renderDetailRoute() {
    listRoot.hidden = true; detailRoot.hidden = false;
    if (document.body.dataset.page === 'participants') { setContextAction(false); setPageHeader({ hidden: true }); }
    void showDetail(route.path[0]);
  }
  function renderRoute() {
    if (!me) return;
    const id = route.path[0];
    if (id && UUID.test(id)) renderDetailRoute();
    else if (id) routes.go({ page: 'participants' }, { replace: true });
    else renderList();
  }

  return {
    id: 'participants', page: 'participants',
    available: caps2 => !!caps2.participants.read,
    async load(nextMe) { me = nextMe; view.hidden = false; await refresh({ force: true }); },
    enter(nextMe, nextRoute) {
      me = nextMe; view.hidden = false;
      const previous = route;
      route = nextRoute ?? { page: 'participants', path: [], query: {} };
      const fromDetail = !!previous.path[0], toList = !route.path[0];
      renderRoute();
      if (toList) {
        if (document.body.dataset.page === 'participants') setPageHeader({ hidden: false, title: 'Participants', subtitle: scopeSubtitle(me.capabilities) });
        void refresh();
        if (fromDetail) { requestAnimationFrame(() => window.scrollTo({ top: listScroll, behavior: 'instant' })); if (lastOpened) $('participantResults')?.querySelector(`.participant-row[data-id="${lastOpened}"]`)?.focus({ preventScroll: true }); }
        else if (!wasOnList) $('pageTitle').focus({ preventScroll: true });
        wasOnList = true;
      } else { window.scrollTo({ top: 0, behavior: 'instant' }); wasOnList = false; announce(document.title); }
    },
    unload() {
      me = null; rows = null; listError = null; loadedAt = 0; view.hidden = true; toolbarState = ''; search = '';
      listRoot.replaceChildren(); detailRoot.replaceChildren(); setContextAction(true);
    }
  };
}
