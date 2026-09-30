// Activitats (3.5D, docs/design/screens/ACTIVITIES.md). View module following view-registry.js:
// the controller owns the #/activitats routes and composes the list, the activity detail and the
// Nova activitat / Editar drawer. It replaces the legacy screen entirely.
import { fetchAllPages } from '../api.js';
import { announce, toast } from '../ui.js';
import { createActivityDetail } from './activities/detail.js';
import { createEditor } from './activities/editor.js';
import { createActivityList } from './activities/list.js';
import { canCreate, filtersToQuery, parseFilters, scopeSubtitle } from './activities/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STALE_AFTER_MS = 30000;
const TAB_SEGMENTS = new Set(['inscripcions', 'informacio']);

export function createActivitiesView({ call, reportLoadError, routes, setPageHeader, setContextAction }) {
  const view = $('activitiesView'), listRoot = $('activitiesList'), detailRoot = $('activityDetail');
  let me = null, rows = null, listError = null, loading = null, loadedAt = 0, route = { page: 'activitats', path: [], query: {} };
  let listScroll = 0, lastOpened = null, highlight = null, removing = null, wasOnList = false, openedFromList = false, lastListQuery = {};

  const caps = () => me?.capabilities;
  // Section catalogue (id ↔ code) from /api/me: reference data only, used to send section ids.
  const sections = () => me?.capabilities?.sections ?? [];
  const sectionIds = () => Object.fromEntries(sections().map(section => [section.code, section.id]));
  const invalidate = () => { loadedAt = 0; };

  const list = createActivityList({ root: listRoot,
    onFilters: filters => routes.go({ page: 'activitats', query: filtersToQuery(filters) }, { replace: true }),
    onOpen: (id, event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openActivity(id);
    },
    onCreate: () => openCreate(),
    onRetry: () => void refresh({ force: true })
  });
  const editor = createEditor({ call, caps, sectionIds,
    reload: id => detail.fetch(id),
    onCreated: created => {
      invalidate(); highlight = created.id;
      toast('Esborrany creat');
      openActivity(created.id);
    },
    onSaved: () => { invalidate(); toast('Canvis guardats'); void detail.reload({ keepTab: true }); }
  });
  const detail = createActivityDetail({ root: detailRoot, call, caps, sections,
    go: (next, options) => routes.go(next, options),
    back: ({ replace = false } = {}) => {
      // Behaves like browser back when the user came from the list; otherwise opens the list.
      if (openedFromList && routes.canGoBack() && !replace) routes.back();
      else routes.go({ page: 'activitats', query: lastListQuery }, { replace });
    },
    onEdit: (activity, trigger) => editor.open({ activity, trigger }),
    onChanged: (change = {}) => { invalidate(); if (change.discarded) removing = change.discarded; }
  });

  function openActivity(id, { tab = null, query = {} } = {}) {
    if (onScreen() && !route.path[0]) { listScroll = window.scrollY; lastListQuery = route.query; openedFromList = true; }
    else openedFromList = false;
    lastOpened = id;
    routes.go({ page: 'activitats', path: tab ? [id, tab] : [id], query });
  }
  function openCreate() {
    if (!me || !canCreate(me.capabilities)) return;
    editor.open({ trigger: document.activeElement });
  }
  $('newActivity').addEventListener('click', () => openCreate());

  async function refresh({ force = false } = {}) {
    if (!me) return;
    if (loading) return loading;
    if (!force && rows && Date.now() - loadedAt < STALE_AFTER_MS) return;
    listError = null;
    loading = (async () => {
      renderRoute({ focus: false });
      try {
        const data = await fetchAllPages(call, '/api/activities', 'activities');
        rows = data.activities; loadedAt = Date.now();
      } catch (error) {
        listError = error;
        if (!rows) reportLoadError(error);
      } finally { loading = null; }
      if (!route.path[0]) renderList();
    })();
    return loading;
  }

  // Page chrome (header, title, URL) is touched only while Activitats is the page on screen: the list
  // may also load in the background when the session starts on another page.
  const onScreen = () => document.body.dataset.page === 'activitats';
  function renderList() {
    const filters = parseFilters(route.query);
    listRoot.hidden = false; detailRoot.hidden = true;
    if (onScreen()) {
      // Normalise unknown filter values in the URL without adding history.
      if (JSON.stringify(filtersToQuery(filters)) !== JSON.stringify(route.query)) { routes.go({ page: 'activitats', query: filtersToQuery(filters) }, { replace: true }); return; }
      setPageHeader({ title: 'Activitats', subtitle: scopeSubtitle(me.capabilities) });
      setContextAction(canCreate(me.capabilities));
      document.title = 'Activitats · Gestió';
    }
    const gone = removing;
    list.render({ rows, caps: me.capabilities, query: route.query, loading: !!loading, error: listError, highlight, removing: gone });
    highlight = null;
    if (gone && rows) {
      removing = null;
      // MOTION 13 remove: the discarded row acknowledges, then the fresh list no longer has it.
      setTimeout(() => { rows = rows.filter(row => row.id !== gone); if (!route.path[0]) renderList(); }, 260);
    }
  }
  function renderDetail({ focus }) {
    listRoot.hidden = true; detailRoot.hidden = false;
    if (onScreen()) { setContextAction(false); setPageHeader({ hidden: true }); }
    const [id, tab] = route.path;
    if (tab && !TAB_SEGMENTS.has(tab)) { routes.go({ page: 'activitats', path: [id] }, { replace: true }); return; }
    void detail.show(route, { focus });
  }
  function renderRoute({ focus = true } = {}) {
    if (!me) return;
    const [id] = route.path;
    if (id && UUID.test(id)) renderDetail({ focus });
    else if (id) routes.go({ page: 'activitats' }, { replace: true });
    else renderList();
  }

  return {
    id: 'activities', page: 'activitats',
    available: caps => !!(caps.activities.read || caps.activities.manage || caps.activities.manageGeneral),
    async load(nextMe) {
      me = nextMe; view.hidden = false;
      await refresh({ force: true });
    },
    enter(nextMe, nextRoute) {
      me = nextMe; view.hidden = false;
      const previous = route;
      route = nextRoute ?? { page: 'activitats', path: [], query: {} };
      const fromDetail = !!previous.path[0], toList = !route.path[0];
      const sameDetail = !toList && previous.path[0] === route.path[0];
      renderRoute({ focus: !sameDetail });
      if (toList) {
        if (onScreen()) setPageHeader({ hidden: false, title: 'Activitats', subtitle: scopeSubtitle(me.capabilities) });
        void refresh();
        if (fromDetail) {
          requestAnimationFrame(() => window.scrollTo({ top: listScroll, behavior: 'instant' }));
          if (lastOpened) list.focusRow(lastOpened);
        } else if (!wasOnList) $('pageTitle').focus({ preventScroll: true });
        wasOnList = true;
      } else {
        if (!sameDetail) window.scrollTo({ top: 0, behavior: 'instant' });
        wasOnList = false;
        announce(document.title);
      }
    },
    unload() {
      me = null; rows = null; listError = null; loadedAt = 0; view.hidden = true;
      editor.close({ immediate: true, restoreFocus: false });
      list.clear(); detail.clear();
      setContextAction(true);
    },
    openActivity, openCreate
  };
}
