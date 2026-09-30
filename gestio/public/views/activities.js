// Activitats (3.5D, docs/design/screens/ACTIVITIES.md). View module following view-registry.js:
// the controller owns the #/activitats routes and composes the list, the activity detail and the
// Nova activitat / Editar drawer. It replaces the legacy screen entirely.
import { fetchAllPages } from '../api.js';
import { announce } from '../ui.js';
import { createActivityList } from './activities/list.js';
import { canCreate, filtersToQuery, parseFilters, scopeSubtitle } from './activities/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STALE_AFTER_MS = 30000;

export function createActivitiesView({ call, reportLoadError, routes, setPageHeader, setContextAction }) {
  const view = $('activitiesView'), listRoot = $('activitiesList'), detailRoot = $('activityDetail');
  let me = null, rows = null, listError = null, loading = null, loadedAt = 0, route = { page: 'activitats', path: [], query: {} };
  let listScroll = 0, lastOpened = null, highlight = null, wasOnList = false;

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

  function openActivity(id, { tab = null, query = {} } = {}) {
    listScroll = window.scrollY; lastOpened = id;
    routes.go({ page: 'activitats', path: tab ? [id, tab] : [id], query });
  }
  function openCreate() { /* Nova activitat drawer: added with the editor (3.5D batch 4). */ }
  $('newActivity').addEventListener('click', () => openCreate());

  async function refresh({ force = false } = {}) {
    if (!me) return;
    if (loading) return loading;
    if (!force && rows && Date.now() - loadedAt < STALE_AFTER_MS) return;
    listError = null;
    loading = (async () => {
      renderRoute();
      try {
        const data = await fetchAllPages(call, '/api/activities', 'activities');
        rows = data.activities; loadedAt = Date.now();
      } catch (error) {
        listError = error;
        if (!rows) reportLoadError(error);
      } finally { loading = null; }
      renderRoute();
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
    list.render({ rows, caps: me.capabilities, query: route.query, loading: !!loading, error: listError, highlight });
    highlight = null;
  }
  function renderDetail(id) {
    listRoot.hidden = true; detailRoot.hidden = false;
    if (onScreen()) setContextAction(false);
    detailRoot.textContent = 'Obrint l’activitat…';
    void id;
  }
  function renderRoute() {
    if (!me) return;
    const [id] = route.path;
    if (id && UUID.test(id)) renderDetail(id);
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
      const fromDetail = !!route.path[0], toList = !nextRoute?.path?.[0];
      route = nextRoute ?? { page: 'activitats', path: [], query: {} };
      renderRoute();
      if (toList) {
        void refresh();
        if (fromDetail) {
          window.scrollTo({ top: listScroll, behavior: 'instant' });
          if (lastOpened) list.focusRow(lastOpened);
        } else if (!wasOnList) $('pageTitle').focus({ preventScroll: true });
        wasOnList = true;
      } else {
        wasOnList = false;
        announce(document.title);
      }
    },
    unload() {
      me = null; rows = null; listError = null; loadedAt = 0; view.hidden = true;
      list.clear(); detailRoot.replaceChildren();
      setContextAction(true);
    },
    openActivity, openCreate
  };
}
