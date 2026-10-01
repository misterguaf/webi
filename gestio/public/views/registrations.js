// Inscripcions — global work queue (3.5F, REGISTRATIONS.md §6). It answers "what needs attention
// across activities?" and sends reviewers to the activity tab, where a registration is worked; it does
// not duplicate the review panel. Payment verifiers (Tresoreria included, without activities.read)
// work payments here until 3.5G, through the purpose-limited payment projection.
import { fetchAllPages } from '../api.js';
import { h } from '../ui.js';
import { QUEUE_VIEWS, parseQueueView, queueCountLine, scopeNote, splitPrevious, tabFilterFor } from './registrations/model.js';
import { evidenceBlock } from './registrations/evidence.js';

const shortDate = value => new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short' }).format(new Date(value));
const $ = id => document.getElementById(id);

/**
 * @param {{call: Function, reportLoadError: (error: any) => void, routes: any, setPageHeader: Function, setNavBadge: (page: string, count: number) => void}} options
 */
export function createRegistrationsView({ call, reportLoadError, routes, setPageHeader, setNavBadge }) {
  const root = $('registrationsView');
  let me = null, token = 0, view = 'pendents';
  const caps = () => me?.capabilities?.registrations ?? null;

  async function refreshBadge() {
    try { const summary = await call('/api/registrations/queue/summary'); setNavBadge('inscripcions', summary.badge); }
    catch (error) { if (error.status !== 401) setNavBadge('inscripcions', 0); }
  }

  async function render() {
    const mine = ++token;
    const c = caps();
    setPageHeader({ title: 'Inscripcions', subtitle: c?.review && !c.review.all ? 'Inscripcions de les teues seccions' : null });
    root.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2, 3].map(() => h('span', { className: 'skeleton-line' }))));
    const [queue, payments] = await Promise.allSettled([
      c?.review ? call(`/api/registrations/queue?vista=${view}`) : Promise.resolve(null),
      c?.verifyPayments ? fetchAllPages(call, `/api/payments?vista=${view}`, 'payments') : Promise.resolve(null)]);
    if (mine !== token) return;
    for (const result of [queue, payments]) if (result.status === 'rejected' && result.reason?.status === 401) return;
    const nodes = [chips()];
    if (c?.review) nodes.push(registrationsBlock(queue, c));
    if (c?.verifyPayments) nodes.push(paymentsBlock(payments));
    root.replaceChildren(...nodes);
    void refreshBadge();
  }

  function chips() {
    return h('div', { className: 'filter-chips queue-views', attrs: { role: 'group', 'aria-label': 'Vista de la cua' } },
      QUEUE_VIEWS.map(option => h('button', { className: 'filter-chip', text: option.label, attrs: { type: 'button', 'aria-pressed': String(option.value === view) },
        on: { click: () => routes.go({ page: 'inscripcions', query: option.value === 'pendents' ? {} : { vista: option.value } }, { replace: true }) } })));
  }

  function registrationsBlock(result, c) {
    const title = h('h2', { className: 'queue-title', text: 'Inscripcions' });
    if (result.status === 'rejected') {
      reportLoadError(result.reason);
      return h('div', { className: 'queue-block' }, title, h('div', { className: 'inline-error', attrs: { role: 'alert' } },
        h('p', { text: 'No s’han pogut carregar les inscripcions.' }), h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void render() } })));
    }
    if (view === 'incidencies') return h('div', { className: 'queue-block' }, title,
      h('p', { className: 'empty-detail', text: 'Les incidències d’aquesta vista són de pagament.' }));
    const { current, previous } = splitPrevious(result.value.activities);
    const card = activity => {
      const note = scopeNote(activity), line = queueCountLine(activity, view, c.reviewGlobal);
      const open = () => routes.go({ page: 'activitats', path: [activity.id, 'inscripcions'], query: { filtre: tabFilterFor(view) } });
      return h('li', { className: 'queue-activity' },
        h('a', { className: 'queue-activity-link', attrs: { href: `#/activitats/${activity.id}/inscripcions`, 'aria-label': `${activity.name}: ${line}${note ? `, ${note}` : ''}` },
          on: { click: event => { event.preventDefault(); open(); } } },
          h('span', { className: 'queue-activity-name', text: activity.name }),
          h('span', { className: 'queue-activity-meta', text: [shortDate(activity.startsAt), note].filter(Boolean).join(' · ') }),
          h('span', { className: 'queue-activity-count', text: line }),
          h('span', { className: 'queue-activity-arrow', text: '→', attrs: { 'aria-hidden': 'true' } })));
    };
    const nodes = [title];
    if (!current.length && !previous.length) nodes.push(h('p', { className: 'empty-title', text: view === 'pendents' ? 'No hi ha res pendent.' : 'Encara no hi ha inscripcions.' }));
    if (current.length) nodes.push(h('ul', { className: 'queue-list', attrs: { role: 'list' } }, current.map(card)));
    if (previous.length) nodes.push(h('details', { className: 'queue-previous' }, h('summary', { text: `Activitats anteriors (${previous.length})` }),
      h('ul', { className: 'queue-list', attrs: { role: 'list' } }, previous.map(card))));
    return h('div', { className: 'queue-block' }, nodes);
  }

  function paymentsBlock(result) {
    const title = h('h2', { className: 'queue-title', text: 'Pagaments d’activitats' });
    if (result.status === 'rejected') {
      reportLoadError(result.reason);
      return h('div', { className: 'queue-block' }, title, h('div', { className: 'inline-error', attrs: { role: 'alert' } },
        h('p', { text: 'No s’han pogut carregar els pagaments.' }), h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void render() } })));
    }
    const payments = result.value.payments;
    if (!payments.length) return h('div', { className: 'queue-block' }, title,
      h('p', { className: 'empty-title', text: view === 'incidencies' ? 'No hi ha incidències de pagament.' : view === 'pendents' ? 'No hi ha pagaments per revisar.' : 'Encara no hi ha pagaments.' }));
    return h('div', { className: 'queue-block' }, title, h('ul', { className: 'registration-list queue-payments', attrs: { role: 'list' } }, payments.map(payment =>
      h('li', { className: 'registration-row' },
        h('div', { className: 'reg-main' },
          h('span', { className: 'reg-name', text: payment.participant?.name ?? payment.submittedName }),
          h('span', { className: 'reg-payment', text: payment.activity.name })),
        h('p', { className: 'reg-secondary', text: [`Rebut el ${shortDate(payment.evidence.receivedAt)}`, payment.section ? sectionLabel(payment.section) : null,
          payment.transport ? (payment.transport === 'GROUP' ? 'Transport del grup' : 'Transport de la família') : null].filter(Boolean).join(' · ') }),
        evidenceBlock({ call, payment, onChanged: () => void render() })))));
  }

  return {
    id: 'registrations', page: 'inscripcions',
    available: c => !!(c.registrations?.review || c.registrations?.verifyPayments),
    async load(nextMe) { me = nextMe; root.hidden = false; await refreshBadge(); },
    async enter(nextMe, route) { me = nextMe; root.hidden = false; view = parseQueueView(route?.query); await render(); },
    unload() { token++; me = null; root.hidden = true; root.replaceChildren(); setNavBadge('inscripcions', 0); },
    refreshBadge
  };
}
const SECTION_NAMES = { MANADA: 'Manada', TROPA: 'Tropa', ESCOLTA: 'Escolta', CLAN: 'Clan' };
const sectionLabel = code => SECTION_NAMES[code] ?? code;
