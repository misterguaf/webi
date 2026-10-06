// Composition root: session lifecycle, local dev login and the view registry (see view-registry.js).
// Screens live in views/*; this file must not grow new screen logic.
import { createClient } from './http.js';
import { navigateTo, onNavigate, routes, setAvailablePages, setContextAction, setNavBadge, setPageHeader, setShellSession } from './shell.js';
import { createSessionSync } from './session-sync.js';
import { dismissOverlays } from './ui.js';
import { createViewRegistry } from './view-registry.js';
import { createActivitiesView } from './views/activities.js';
import { createRegistrationsView } from './views/registrations.js';
import { createAccountView, createActivityFeedView, createAdministrationView, createDashboardView, createFeeStatusView, createFeesView, createIncidentsView } from './views/simple-views.js';
import { createParticipantsView } from './views/participants.js';
import { createTreasuryView } from './views/treasury.js';
import { createFamilyGroupsView } from './views/family-groups.js';

const $ = id => document.getElementById(id);
const message = value => { $('message').textContent = value; };
const { call, post, endSession } = createClient({ onUnauthorized: () => {
  if (!document.body.classList.contains('shell-authenticated')) return;
  hide();
  message('La sessió ha caducat. Torna a entrar.');
}, onForbidden: () => void sync.check({ force: true }) });
// The global banner is for network/server failures only (status 0 or 5xx); each screen explains its own 4xx (3.5I).
const reportLoadError = error => { if (!(error?.status >= 400 && error?.status < 500)) $('shellLoadError').hidden = false; };
let currentMe = null;

const registrations = createRegistrationsView({ call, reportLoadError, routes, setPageHeader, setNavBadge });
const activities = createActivitiesView({ call, message, reportLoadError, routes, setPageHeader, setContextAction });
// Order matters: it is the order in which a session loads its modules.
const views = createViewRegistry([
  createDashboardView({ call, navigateTo, routes, activities }),
  createAccountView({ call, message, reportLoadError, reload: () => refresh() }),
  createAdministrationView({ call, reportLoadError, routes, setPageHeader }),
  createParticipantsView({ call, reportLoadError, routes, setPageHeader, setContextAction }),
  activities,
  registrations,
  createFeesView({ call, message, reportLoadError }),
  createFamilyGroupsView({ call, message, reportLoadError }),
  createFeeStatusView({ call, reportLoadError }),
  createTreasuryView({ call, reportLoadError, routes, setPageHeader, setNavBadge }), createActivityFeedView({ call, reportLoadError, routes, setPageHeader }), createIncidentsView({ call, reportLoadError, routes, setPageHeader, setNavBadge, onNavigate })
]);
let shownPage = null; // a load problem belongs to the page that had it: the banner clears when the page changes
onNavigate((page, route) => { if (page !== shownPage) { $('shellLoadError').hidden = true; shownPage = page; } views.enter(page, currentMe, route); void sync.check(); });

function hide() {
  currentMe = null;
  endSession(); dismissOverlays(); views.unloadAll();
  $('logout').hidden = true; $('login').hidden = false; setShellSession(null);
}
async function refresh() {
  $('shellLoadError').hidden = true;
  let me;
  try { me = await call('/api/me'); } catch (error) { hide(); reportLoadError(error); return; }
  await applySession(me);
}
// Only usable pages are offered; modules are requested only when /api/me says they are usable (no AUTHZ_DENY noise).
async function applySession(me) {
  $('login').hidden = true; $('logout').hidden = false; currentMe = me;
  setAvailablePages(views.availablePages(me.capabilities)); setShellSession(me);
  await views.loadAll(me);
}
// 3.5I: access that changes while Gestió is open never leaves stale protected screens (session-sync.js).
const sync = createSessionSync({ fetchMe: () => call('/api/me'), current: () => currentMe, onChanged: applySession,
  onUserChanged: async () => { hide(); await refresh(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sync.check({ force: true }); });
async function loadDevIdentities() {
  try { const data = await call('/api/dev/identities'); $('demoIndicator').hidden = false; $('localDataNotice').hidden = false; $('login').querySelector('p').textContent = 'Selector disponible únicament en desenvolupament local.'; $('loginButton').disabled = false; $('identity').replaceChildren(...data.identities.map(identity => { const option = document.createElement('option'); option.value = identity.subject; option.textContent = identity.display_name; return option; })); }
  catch (error) { $('login').querySelector('p').textContent = error.status === 404 ? 'El selector local no està disponible. L’accés de producció requereix Cloudflare Access.' : 'No s’ha pogut carregar el selector local. Torna-ho a provar.'; $('loginButton').disabled = true; reportLoadError(error); }
}
$('retryShellData').addEventListener('click', async () => { await refresh(); await loadDevIdentities(); });
$('loginButton').addEventListener('click', async () => { try { await call('/api/dev/login', { method: 'POST', body: JSON.stringify({ subject: $('identity').value }) }); message('Sessió iniciada.'); await refresh(); } catch (e) { message(e.message); } });
// An explicit logout forgets the route; an expired session keeps it so the next login restores it.
$('logout').addEventListener('click', async () => { try { await post('/api/logout'); hide(); routes.go({ page: 'inici' }, { replace: true }); message('Sessió tancada.'); } catch (e) { message(e.message); } });
$('revokeAll').addEventListener('click', async () => { try { await post('/api/me/sessions/revoke-all'); hide(); message('Totes les sessions revocades.'); } catch (e) { message(e.message); } });
await loadDevIdentities(); await refresh();
