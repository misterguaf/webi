// Participants (3.5E, docs/design/screens/PARTICIPANTS.md). View module (view-registry.js): the
// controller owns the #/participants routes and composes the list and the participant record. It
// replaces the legacy bullet list. Batch 2 is the read surface (list + Fitxa); the guided create,
// edit, section change and the Família tab are added in later batches.
import { fetchAllPages } from '../api.js';
import { announce, confirmDialog, h, icon, openMenu, toast, trapTab } from '../ui.js';
import { createParticipantEditor } from './participants/editor.js';
import { createFamiliaTab } from './participants/familia.js';
import { createReviewQueue } from './participants/reviews.js';
import { accessibleRowName, canCreate, canManageSection, completenessSignal, ESTAT_FILTERS, feeLabel,
  filterParticipants, filtersDiffer, filtersToQuery, groupBySection, historyReason, initials, manageableSections,
  missingSummary, parseFilters, scopeSubtitle, SECTION_LABELS, sectionCode, sectionName, sectionOptions, statusLabel } from './participants/model.js';

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
  const sectionIds = () => Object.fromEntries(sections().map(s => [s.code, s.id]));
  const invalidate = () => { loadedAt = 0; };

  const editor = createParticipantEditor({ call, caps, sectionIds, rows: () => rows,
    reload: id => call(`/api/participants/${id}`).then(r => r.participant),
    onCreated: created => { invalidate(); toast('Participant afegit'); routes.go({ page: 'participants', path: [created.id] }); },
    onSaved: id => { invalidate(); toast('Canvis guardats'); detailCache = null; if (route.path[0] === id) void showDetail(id, { force: true }); } });
  function openCreate() { if (canCreate(me?.capabilities)) editor.open({ trigger: document.activeElement }); }
  const familia = createFamiliaTab({ call, caps, onChanged: () => { invalidate(); detailCache = null; familia.clear(); if (route.path[0]) void showDetail(route.path[0], { force: true }); } });
  const readsContacts = p => { const s = caps()?.participants?.readContacts; return !!s && (s.all || s.sections.some(x => x.id === p.currentSectionId)); };
  const reviews = createReviewQueue({ call, onOpenParticipant: id => { openedFromList = false; routes.go({ page: 'participants', path: [id] }); } });

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
    if (!rows.length) { results.replaceChildren(emptyState(filters.estat === 'de-baixa' ? 'No hi ha participants de baixa en les teues seccions.' : 'Encara no hi ha participants en les teues seccions.',
      filters.estat !== 'de-baixa' && canCreate(me.capabilities) ? h('button', { className: 'btn btn-primary', text: 'Nou participant', attrs: { type: 'button' }, on: { click: () => openCreate() } }) : null)); return; }
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
    const state = JSON.stringify([filters, sectionOptions(rows ?? [], sections()).map(o => o.value), canCreate(me.capabilities), !!me.capabilities.participants.review]);
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
    const cta = canCreate(me.capabilities)
      ? h('button', { className: 'btn btn-primary toolbar-cta', attrs: { type: 'button' }, on: { click: () => openCreate() } }, icon('plus'), h('span', { text: 'Nou participant' })) : null;
    const reviewLink = me.capabilities.participants.review
      ? h('a', { className: 'btn btn-secondary toolbar-reviews', text: 'Revisions', attrs: { href: '#/participants/revisions' }, on: { click: e => { e.preventDefault(); routes.go({ page: 'participants', path: ['revisions'] }); } } }) : null;
    const toolbar = h('div', { className: 'participant-toolbar' },
      h('label', { className: 'search-field', attrs: { for: 'participantSearch' } }, icon('search'), searchInput),
      h('label', { className: 'select-field' }, h('span', { text: 'Secció' }), sectionSelect),
      h('label', { className: 'select-field' }, h('span', { text: 'Estat' }), estatSelect),
      compToggle, reset, reviewLink, cta);
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
  let detailToken = 0, detailCache = null;
  async function showDetail(id, { force = false } = {}) {
    if (!force && detailCache?.id === id) { renderDetail(detailCache.participant); return; }
    const mine = ++detailToken;
    detailRoot.textContent = '';
    detailRoot.append(detailSkeleton());
    try {
      const { participant } = await call(`/api/participants/${id}`);
      if (mine !== detailToken) return;
      detailCache = { id, participant };
      renderDetail(participant);
    } catch (error) {
      if (mine !== detailToken || error.status === 401) return;
      detailCache = null;
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
      h('div', { className: 'detail-heading' }, h('div', { className: 'detail-title-row' }, title, badge),
        h('div', { className: 'detail-actions' }, detailActions(p))),
      h('p', { className: 'detail-context', text: since }),
      completeness, fee);
    const tabs = readsContacts(p) ? [{ id: 'fitxa', label: 'Fitxa' }, { id: 'familia', label: 'Família' }] : [];
    const tab = tabs.some(t => t.id === route.path[1]) ? route.path[1] : 'fitxa';
    const panel = h('div', { className: 'detail-tabpanel', attrs: tabs.length ? { role: 'tabpanel', id: 'participantTabPanel', 'aria-labelledby': `ptab-${tab}` } : {} });
    detailRoot.replaceChildren(h('article', { className: 'participant-detail' }, header, tabs.length ? tabBar(p, tabs, tab) : null, panel));
    if (tab === 'familia') familia.render(panel, p);
    else panel.append(fitxa(p));
    title.focus({ preventScroll: true });
  }
  function tabBar(p, tabs, selected) {
    const buttons = tabs.map(t => h('button', { className: 'tab', attrs: { type: 'button', role: 'tab', id: `ptab-${t.id}`, 'aria-selected': String(t.id === selected),
      'aria-controls': 'participantTabPanel', tabindex: t.id === selected ? '0' : '-1' }, dataset: { tab: t.id } }, h('span', { text: t.label })));
    const select = tabId => routes.go({ page: 'participants', path: [p.id, tabId] });
    for (const [index, button] of buttons.entries()) {
      button.addEventListener('click', () => select(button.dataset.tab));
      button.addEventListener('keydown', event => {
        const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); select(buttons[(next + buttons.length) % buttons.length].dataset.tab);
      });
    }
    return h('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Seccions del participant' } }, buttons);
  }
  function detailActions(p) {
    const code = sectionCode(p.currentSectionId, sections());
    if (!canManageSection(me.capabilities, code)) return [];
    const nodes = [];
    const edit = h('button', { className: 'btn btn-secondary', text: 'Editar', attrs: { type: 'button' } });
    edit.addEventListener('click', () => editor.open({ participant: p, trigger: edit }));
    nodes.push(edit);
    const items = [];
    // Section change needs manage over the target too; offer only the sections the user manages.
    const targets = manageableSections(me.capabilities).filter(c => c !== code);
    if (p.status === 'ACTIVE' && targets.length) items.push({ label: 'Canviar de secció', onSelect: () => changeSection(p, targets) });
    if (p.status === 'ACTIVE') items.push({ label: 'Donar de baixa', tone: 'danger', onSelect: () => setActive(p, false) });
    else items.push({ label: 'Reactivar', onSelect: () => setActive(p, true) });
    if (items.length) {
      const more = h('button', { className: 'btn btn-secondary btn-icon', attrs: { type: 'button', 'aria-label': 'Més accions', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, icon('more'));
      more.addEventListener('click', () => openMenu(more, items));
      nodes.push(more);
    }
    return nodes;
  }
  async function mutate(request, { success, note }) {
    try { await request(); invalidate(); toast(success); detailCache = null; await showDetail(route.path[0], { force: true }); }
    catch (error) {
      if (error.status === 401) return;
      if (error.code === 'stale_participant' || error.code === 'invalid_transition') { detailCache = null; await showDetail(route.path[0], { force: true }); toast(note ?? 'La fitxa ha canviat. S’ha actualitzat.'); }
      else toast(error.status === 403 ? 'No tens permís per a fer aquest canvi.' : 'No s’ha pogut completar l’acció.');
    }
  }
  async function setActive(p, active) {
    const ok = active
      ? await confirmDialog({ title: 'Reactivar el participant?', body: `«${p.displayName}» tornarà a estar actiu a ${sectionName(p.currentSectionId, sections())}.`, confirm: 'Reactiva', tone: 'primary' })
      : await confirmDialog({ title: 'Donar de baixa?', body: `«${p.displayName}» passarà a estar de baixa. Es conserva tot l’historial.`, confirm: 'Dona de baixa', tone: 'danger' });
    if (!ok) return;
    await mutate(() => call(`/api/participants/${p.id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST', body: JSON.stringify({ expectedVersion: p.version }) }),
      { success: active ? 'Participant reactivat' : 'Participant donat de baixa' });
  }
  function changeSection(p, targets) {
    sectionDialog(p, targets).then(target => {
      if (!target) return;
      return mutate(() => call(`/api/participants/${p.id}/section`, { method: 'POST', body: JSON.stringify({ sectionId: sectionIds()[target], expectedVersion: p.version }) }),
        { success: 'Secció canviada' });
    });
  }
  function sectionDialog(p, targets) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const select = h('select', { attrs: { id: 'section-target', 'aria-label': 'Nova secció' } }, targets.map(c => h('option', { text: SECTION_LABELS[c], attrs: { value: c } })));
      const done = value => { document.removeEventListener('keydown', onKey, true); layer.remove(); previous?.focus?.(); resolve(value); };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); done(null); } else trapTab(dialog, e); };
      const dialog = h('div', { className: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Canviar de secció' } },
        h('h2', { className: 'dialog-title', text: 'Canviar de secció' }),
        h('p', { className: 'dialog-body', text: `«${p.displayName}» deixarà ${sectionName(p.currentSectionId, sections())} a l’instant. Es conserva l’historial.` }),
        h('label', { className: 'field' }, h('span', { className: 'field-label', text: 'Nova secció' }), select),
        h('div', { className: 'dialog-actions' },
          h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => done(null) } }),
          h('button', { className: 'btn btn-primary', text: 'Canvia', attrs: { type: 'button' }, on: { click: () => done(select.value) } })));
      const layer = h('div', { className: 'dialog-layer', on: { mousedown: e => { if (e.target === layer) done(null); } } }, dialog);
      document.addEventListener('keydown', onKey, true);
      document.body.append(layer);
      select.focus();
    });
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
  function renderReviews() {
    if (!me.capabilities.participants.review) { routes.go({ page: 'participants' }, { replace: true }); return; }
    listRoot.hidden = true; detailRoot.hidden = false;
    if (document.body.dataset.page === 'participants') { setContextAction(false); setPageHeader({ hidden: true }); }
    const container = h('div', { className: 'review-queue' });
    const title = h('h1', { className: 'detail-title', text: 'Revisions administratives', attrs: { tabindex: '-1' } });
    detailRoot.replaceChildren(h('article', { className: 'participant-detail' },
      h('header', { className: 'detail-header' },
        h('a', { className: 'back-link', attrs: { href: '#/participants' }, on: { click: e => { e.preventDefault(); routes.go({ page: 'participants', query: lastListQuery }); } } }, icon('arrow-left'), h('span', { text: 'Participants' })),
        h('div', { className: 'detail-heading' }, h('div', { className: 'detail-title-row' }, title))), container));
    document.title = 'Revisions · Participants · Gestió';
    reviews.render(container);
    title.focus({ preventScroll: true });
  }
  function renderRoute() {
    if (!me) return;
    const id = route.path[0];
    if (id === 'revisions') renderReviews();
    else if (id && UUID.test(id)) renderDetailRoute();
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
      editor.close({ immediate: true, restoreFocus: false });
      familia.clear(); reviews.clear(); detailCache = null;
      listRoot.replaceChildren(); detailRoot.replaceChildren(); setContextAction(true);
    },
    openCreate
  };
}
