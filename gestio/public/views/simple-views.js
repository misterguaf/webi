// Small views: account/sessions, participants, fees (full or basic), dashboard. Each follows the
// view contract documented in ../view-registry.js.
import { setupFees } from '../fees.js';
import { setupFeeStatus } from '../fee-status.js';

const $ = id => document.getElementById(id);
const FEE_LISTS = ['feeRoundRevisions', 'feeMetrics', 'feeSearchResults', 'feeGroups', 'feeObligations', 'feePayments', 'feeIssues', 'feeObligationDetail', 'feePaymentDetail'];

export function createAccountView({ call, message, reportLoadError, reload }) {
  async function load(me) {
    $('account').hidden = false; $('sessions').hidden = false;
    $('profile').textContent = `${me.user.displayName} · ${me.user.status}`;
    $('roles').replaceChildren(...me.roles.map(role => { const li = document.createElement('li'); li.textContent = `${role.role_code}${role.section_code ? ` · ${role.section_code}` : ''}`; return li; }));
    let sessions = { sessions: [] };
    try { sessions = await call('/api/me/sessions'); } catch (error) { reportLoadError(error); if (error.status === 401) return; }
    $('sessionList').replaceChildren(...sessions.sessions.map(session => {
      const li = document.createElement('li');
      li.textContent = `${session.current ? 'Actual · ' : ''}${new Date(session.created_at).toLocaleString('ca-ES')} · expira ${new Date(session.absolute_expires_at).toLocaleString('ca-ES')} `;
      const button = document.createElement('button'); button.textContent = 'Revoca';
      button.addEventListener('click', async () => { try { await call(`/api/me/sessions/${session.id}`, { method: 'DELETE' }); await reload(); } catch (e) { message(e.message); } });
      li.append(button); return li;
    }));
    $('notificationPanel').hidden = !me.capabilities.administration.audit;
  }
  $('drainNotifications').addEventListener('click', async () => { try {
    const result = await call('/api/dev/notifications/drain', { method: 'POST', body: JSON.stringify({}) });
    message(`Correus ficticis capturats: ${result.sent}; errors: ${result.failed}.`);
  } catch (error) { message(error.message); } });
  return { id: 'account', page: 'administracio', available: () => true, load,
    unload: () => { for (const id of ['account', 'sessions', 'notificationPanel']) $(id).hidden = true; } };
}


// Full treasury view for group-wide finance readers; review-only mode for delegated payment reviewers.
export function createFeesView({ call, message, reportLoadError }) {
  const loadFees = setupFees({ call, message, reportLoadError });
  return { id: 'fees', page: 'quotes', available: caps => !!(caps.fees.read?.all || caps.fees.reviewPayments),
    load: me => loadFees({ reviewOnly: !me.capabilities.fees.read?.all, readContacts: !!me.capabilities.fees.readContacts }),
    unload() { $('feePanel').hidden = true; $('feeRound').replaceChildren(); $('feeRoundForm').reset(); for (const id of FEE_LISTS) $(id).replaceChildren(); } };
}

// Basic PAID/PARTIAL/PENDING/ISSUE view for section-scoped status readers (3.5C.1).
export function createFeeStatusView({ call, reportLoadError }) {
  const loadFeeStatus = setupFeeStatus({ call, reportLoadError });
  return { id: 'fee-status', page: 'quotes', available: caps => !caps.fees.read?.all && !!caps.fees.status,
    load: () => loadFeeStatus(true),
    unload() { $('feeStatusPanel').hidden = true; $('feeStatusList').replaceChildren(); $('feeStatusRound').replaceChildren(); } };
}

export function createDashboardView(dashboard) {
  return { id: 'dashboard', page: 'inici', available: () => true, load() {}, enter: me => dashboard.load(me), unload: () => dashboard.hide() };
}
