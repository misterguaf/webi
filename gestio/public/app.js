// Composition root: session lifecycle, local dev login and the view registry (see view-registry.js).
// Screens live in views/*; this file must not grow new screen logic.
import { createClient } from './http.js';
import { setupDashboard } from './dashboard.js';
import { navigateTo, onNavigate, routes, setContextAction, setNavAvailable, setNavBadge, setPageHeader, setShellSession } from './shell.js';
import { createViewRegistry } from './view-registry.js';
import { createActivitiesView } from './views/activities.js';
import { createRegistrationsView } from './views/registrations.js';
import { createAccountView, createDashboardView, createFeeStatusView, createFeesView } from './views/simple-views.js';
import { createParticipantsView } from './views/participants.js';
import { createTreasuryView } from './views/treasury.js';
import { treasuryAvailable } from './views/treasury/model.js';

const $ = id => document.getElementById(id);
const message = value => { $('message').textContent = value; };
const { call, post } = createClient({ onUnauthorized: () => {
  if (!document.body.classList.contains('shell-authenticated')) return;
  hide();
  message('La sessió ha caducat. Torna a entrar.');
} });
const reportLoadError = error => { if (error?.status !== 401 && error?.status !== 403 && error?.status !== 404) $('shellLoadError').hidden = false; };
let currentMe = null;

const registrations = createRegistrationsView({ call, reportLoadError, routes, setPageHeader, setNavBadge });
const activities = createActivitiesView({ call, message, reportLoadError, routes, setPageHeader, setContextAction });
// Dashboard entry points land on the activity detail (3.5D), never on a form.
const dashboard = setupDashboard({ call, navigateTo,
  openActivity: id => activities.openActivity(id),
  openRegistrations: id => activities.openActivity(id, { tab: 'inscripcions', query: { filtre: 'per-revisar' } }),
  createActivity: () => { navigateTo('activitats'); activities.openCreate(); },
  // 3.5F: payments and incidences live in the Inscripcions queue until 3.5G Tresoreria.
  openPayments: view => routes.go({ page: 'inscripcions', query: view && view !== 'pendents' ? { vista: view } : {} }),
  openRegistrationQueue: () => routes.go({ page: 'inscripcions' }),
  openFeeIssues: () => { navigateTo('quotes'); $('feeIssues').scrollIntoView({ block: 'start', behavior: 'instant' }); },
  openIncompleteParticipants: () => routes.go({ page: 'participants', query: { completitud: 'pendents' } }),
  openParticipantReviews: () => routes.go({ page: 'participants', path: ['revisions'] })
});
// Order matters: it is the order in which a session loads its modules.
const views = createViewRegistry([
  createDashboardView(dashboard),
  createAccountView({ call, message, reportLoadError, reload: () => refresh() }),
  createParticipantsView({ call, reportLoadError, routes, setPageHeader, setContextAction }),
  activities,
  registrations,
  createFeesView({ call, message, reportLoadError }),
  createFeeStatusView({ call, reportLoadError }),
  createTreasuryView({ call, reportLoadError, routes, setPageHeader, setNavBadge })
]);
onNavigate((page, route) => views.enter(page, currentMe, route));

function hide() {
  currentMe = null;
  views.unloadAll();
  $('logout').hidden = true; $('login').hidden = false; setShellSession(null);
}
async function refresh() {
  $('shellLoadError').hidden = true;
  let me;
  try { me = await call('/api/me'); } catch (error) { hide(); reportLoadError(error); return; }
  $('login').hidden = true; $('logout').hidden = false; currentMe = me; setShellSession(me);
  setNavAvailable('inscripcions', !!(me.capabilities.registrations?.review || me.capabilities.registrations?.verifyPayments));
  setNavAvailable('tresoreria', treasuryAvailable(me.capabilities));
  // Modules are requested only when /api/me says they are usable (no AUTHZ_DENY noise).
  await views.loadAll(me);
}
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
