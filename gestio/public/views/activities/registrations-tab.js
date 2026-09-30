// Inscripcions tab of an activity (ACTIVITIES.md §11): only what the reviewer's scope returns, partial
// scopes labelled as such, contact data on demand, declared birth dates only while pending, minimised
// matching signals, and payment evidence inline only when it relates to the row through registration_id.
import { fetchAllPages } from '../../api.js';
import { label } from '../../labels.js';
import { confirmDialog, h, icon, toast } from '../../ui.js';
import { SECTION_LABELS, canVerifyPayments, dateTime, errorCopy, formatMoney, partialLabel, shortDate } from './model.js';

const FILTERS = [
  { value: 'totes', label: 'Totes', match: () => true },
  { value: 'per-revisar', label: 'Per revisar', match: row => row.status === 'NEEDS_PARTICIPANT_REVIEW' },
  { value: 'pendents-pagament', label: 'Pendents de pagament', match: row => row.status === 'AWAITING_PAYMENT_REVIEW', paidOnly: true },
  { value: 'confirmades', label: 'Confirmades', match: row => row.status === 'CONFIRMED' },
  { value: 'rebutjades', label: 'Rebutjades', match: row => row.status === 'REJECTED' }];
const TRANSPORT = { GROUP: 'Transport del grup', FAMILY: 'Transport per compte de la família' };
const birthLabel = value => value ? new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${value}T00:00:00Z`)) : '';

/**
 * @param {{call: Function, caps: () => any, sections: () => Array<{id: string, code: string}>, onChanged: () => void,
 *   setFilter: (activityId: string, filter: string) => void}} options
 */
export function createRegistrationsTab({ call, caps, sections, onChanged, setFilter }) {
  let cache = null, token = 0;
  const expanded = new Set(), contacts = new Set();

  async function load(activity) {
    const verify = canVerifyPayments(activity, caps());
    const [rows, payments] = await Promise.allSettled([
      fetchAllPages(call, `/api/activities/${activity.id}/registrations`, 'registrations'),
      verify ? fetchAllPages(call, '/api/payments', 'payments') : Promise.resolve({ payments: [] })]);
    if (rows.status === 'rejected') throw rows.reason;
    const ids = new Set(rows.value.registrations.map(row => row.id));
    // Evidence is related only through registration_id to rows this tab already loaded; never by name or amount.
    const evidence = payments.status === 'fulfilled'
      ? new Map(payments.value.payments.filter(payment => ids.has(payment.registration_id)).map(payment => [payment.registration_id, payment])) : null;
    return { activityId: activity.id, version: activity.version, rows: rows.value.registrations, evidence, evidenceError: payments.status === 'rejected' && verify };
  }

  async function render(container, activity, query) {
    const mine = ++token;
    if (!cache || cache.activityId !== activity.id || cache.version !== activity.version || cache.stale) {
      container.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } },
        [1, 2, 3].map(() => h('span', { className: 'skeleton-line' }))));
      try { cache = await load(activity); }
      catch (error) {
        if (mine !== token || error.status === 401) return;
        container.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: 'No s’han pogut carregar les inscripcions.' }),
          h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => { cache = null; void render(container, activity, query); } } })));
        return;
      }
      if (mine !== token) return;
    }
    draw(container, activity, query);
  }

  function draw(container, activity, query) {
    const rows = cache.rows;
    const paid = activity.price_cents > 0;
    const filters = FILTERS.filter(filter => !filter.paidOnly || paid);
    const counts = Object.fromEntries(filters.map(filter => [filter.value, rows.filter(filter.match).length]));
    const requested = filters.some(filter => filter.value === query?.filtre) ? query.filtre : null;
    // Default: Per revisar when it has items, otherwise Totes (§11.1). An explicit choice lives in the route.
    const selected = requested ?? (counts['per-revisar'] ? 'per-revisar' : 'totes');
    const partial = partialLabel(activity.registrations);
    const visible = rows.filter(filters.find(filter => filter.value === selected).match);

    const chips = h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Filtra les inscripcions' } },
      filters.map(filter => h('button', { className: 'filter-chip', attrs: { type: 'button', 'aria-pressed': String(filter.value === selected) },
        on: { click: () => setFilter(activity.id, filter.value) } }, h('span', { text: filter.label }), h('span', { className: 'chip-count', text: String(counts[filter.value]) }))));
    const nodes = [];
    if (partial) nodes.push(h('p', { className: 'scope-note', text: `Veus les inscripcions de ${partial}. Les d’altres seccions les revisa cada secció.` }));
    if (cache.evidenceError) nodes.push(h('p', { className: 'inline-note', attrs: { role: 'status' }, text: 'No s’han pogut carregar els justificants de pagament. Les inscripcions es mostren igualment.' }));
    if (!rows.length) {
      const open = activity.status === 'PUBLISHED' && activity.registration_deadline >= Date.now();
      nodes.push(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: 'Encara no hi ha inscripcions.' }),
        open ? h('p', { className: 'empty-detail', text: `Les famílies poden inscriure’s des del portal fins al ${dateTime(activity.registration_deadline)}.` }) : null));
      container.replaceChildren(...nodes);
      return;
    }
    nodes.push(chips);
    if (!visible.length) nodes.push(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: 'No hi ha inscripcions en aquest estat.' }),
      h('button', { className: 'btn btn-secondary', text: 'Mostra-les totes', attrs: { type: 'button' }, on: { click: () => setFilter(activity.id, 'totes') } })));
    else nodes.push(h('ul', { className: 'registration-list', attrs: { role: 'list' } }, visible.map(row => registrationRow(row, activity, container, query))));
    container.replaceChildren(...nodes);
  }

  function sectionName(id) {
    const code = sections().find(section => section.id === id)?.code;
    return code ? SECTION_LABELS[code] : null;
  }

  function registrationRow(row, activity, container, query) {
    const paid = activity.price_cents > 0;
    const evidence = cache.evidence?.get(row.id) ?? null;
    const secondary = [`Sol·licitada el ${shortDate(row.created_at)}`, activity.audience === 'GENERAL' ? sectionName(row.submitted_section_id) : null,
      TRANSPORT[row.transport_code] ?? null].filter(Boolean).join(' · ');
    const state = h('span', { className: `badge reg-${row.status.toLowerCase().replaceAll('_', '-')}`, text: label(row.status) });
    const payment = paid && row.payment_status && row.status === 'AWAITING_PAYMENT_REVIEW'
      ? h('span', { className: 'reg-payment', text: `Justificant: ${label(row.payment_status).toLocaleLowerCase('ca-ES')}` }) : null;
    const item = h('li', { className: 'registration-row', dataset: { id: row.id } },
      h('div', { className: 'reg-main' }, h('span', { className: 'reg-name', text: row.submitted_name }), state, payment),
      h('p', { className: 'reg-secondary', text: secondary }));
    const redraw = () => draw(container, activity, query);
    if (row.status === 'NEEDS_PARTICIPANT_REVIEW') {
      const open = expanded.has(row.id);
      const toggle = h('button', { className: 'btn btn-secondary btn-small reg-toggle', text: open ? 'Amaga la revisió' : 'Revisa',
        attrs: { type: 'button', 'aria-expanded': String(open), 'aria-controls': `review-${row.id}` } });
      toggle.addEventListener('click', () => { if (open) expanded.delete(row.id); else expanded.add(row.id); redraw();
        if (!open) requestAnimationFrame(() => document.querySelector(`#review-${row.id} .review-title`)?.focus()); });
      item.querySelector('.reg-main').append(toggle);
      if (open) item.append(reviewPanel(row, activity, () => { expanded.delete(row.id); redraw(); document.querySelector(`[data-id="${row.id}"] .reg-toggle`)?.focus(); }));
    } else {
      const shown = contacts.has(row.id);
      const contact = h('button', { className: 'link-button reg-contact-toggle', text: shown ? 'Amaga el contacte' : 'Mostra el contacte', attrs: { type: 'button', 'aria-expanded': String(shown) } });
      contact.addEventListener('click', () => { if (shown) contacts.delete(row.id); else contacts.add(row.id); redraw(); });
      item.append(h('div', { className: 'reg-tools' }, contact));
      if (shown) item.append(h('dl', { className: 'reg-contact' },
        h('div', {}, h('dt', { text: 'Qui la va enviar' }), h('dd', { text: row.submitted_by_name || '—' })),
        h('div', {}, h('dt', { text: 'Telèfon' }), h('dd', { text: row.contact_phone || 'No indicat' })),
        h('div', {}, h('dt', { text: 'Correu' }), h('dd', { text: row.receipt_email }))));
      if (evidence && row.status === 'AWAITING_PAYMENT_REVIEW') item.append(evidenceBlock(evidence));
    }
    return item;
  }

  // ---- participant review (§11.2): signals, not master data; no auto-merge, no auto-create
  function reviewPanel(row, activity, collapse) {
    let chosen = null;
    const list = h('div', { className: 'candidate-list', attrs: { role: 'radiogroup', 'aria-label': 'Persones candidates' } },
      h('p', { className: 'field-hint', text: 'Carregant candidats…' }));
    const link = h('button', { className: 'btn btn-primary', text: 'Vincula', attrs: { type: 'button', disabled: true } });
    const reject = h('button', { className: 'btn btn-quiet reg-reject', text: 'Rebutja', attrs: { type: 'button' } });
    const searchInput = h('input', { attrs: { type: 'search', id: `candidate-search-${row.id}`, minlength: '2', maxlength: '80', autocomplete: 'off' } });
    const searchButton = h('button', { className: 'btn btn-secondary', text: 'Cerca', attrs: { type: 'button' } });
    const status = h('p', { className: 'field-hint', attrs: { 'aria-live': 'polite' } });
    async function candidates(search = null) {
      list.setAttribute('aria-busy', 'true');
      try {
        const data = await call(`/api/registrations/${row.id}/candidates${search ? `?search=${encodeURIComponent(search)}` : ''}`);
        chosen = null; link.disabled = true;
        list.replaceChildren(...(data.candidates.length ? data.candidates.map(person => {
          const radio = h('input', { attrs: { type: 'radio', name: `candidate-${row.id}`, value: person.id, id: `candidate-${row.id}-${person.id}` } });
          radio.addEventListener('change', () => { chosen = person.id; link.disabled = false; });
          return h('label', { className: 'candidate', attrs: { for: radio.id } }, radio,
            h('span', { className: 'candidate-name', text: person.display_name }),
            h('span', { className: 'candidate-meta', text: [SECTION_LABELS[person.section_code] ?? person.section_code,
              person.birth_date_matches ? 'naixement coincideix' : 'naixement no coincideix', person.birth_date ? birthLabel(person.birth_date) : null].filter(Boolean).join(' · ') }));
        }) : [h('p', { className: 'field-hint', text: search ? 'Cap persona coincideix amb la cerca.' : 'No hi ha candidats plausibles. Cerca per nom si la coneixes.' })]));
        status.textContent = data.truncated ? 'Hi ha més coincidències de les que es mostren. Afina la cerca.' : '';
      } catch (error) {
        if (error.status === 401) return;
        list.replaceChildren(h('p', { className: 'field-error', text: error.status === 400 ? 'Escriu almenys 2 lletres per a cercar.' : 'No s’han pogut carregar els candidats.' }),
          h('button', { className: 'btn btn-secondary btn-small', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void candidates(search) } }));
      } finally { list.removeAttribute('aria-busy'); }
    }
    searchButton.addEventListener('click', () => { const value = searchInput.value.trim(); if (value.length < 2) { status.textContent = 'Escriu almenys 2 lletres per a cercar.'; return; } void candidates(value); });
    searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchButton.click(); } });
    async function review(decision) {
      const body = decision === 'MATCH' ? { decision, participantId: chosen } : { decision };
      const button = decision === 'MATCH' ? link : reject;
      button.setAttribute('aria-busy', 'true'); button.disabled = true;
      try {
        await call(`/api/registrations/${row.id}/review`, { method: 'POST', body: JSON.stringify(body) });
        toast(decision === 'MATCH' ? 'Inscripció vinculada' : 'Inscripció rebutjada');
        expanded.delete(row.id); if (cache) cache.stale = true;
        onChanged();
      } catch (error) {
        if (error.status === 401) return;
        status.textContent = error.code === 'invalid_transition' ? 'Aquesta inscripció ja s’ha revisat. Actualitza la llista.' : errorCopy(error.code);
      } finally { button.removeAttribute('aria-busy'); button.disabled = decision === 'MATCH' ? !chosen : false; }
    }
    link.addEventListener('click', () => { if (chosen) void review('MATCH'); });
    reject.addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Rebutjar la inscripció?', body: `La sol·licitud de «${row.submitted_name}» quedarà rebutjada.`, confirm: 'Rebutja', tone: 'danger' })) void review('REJECT');
    });
    void candidates();
    return h('section', { className: 'review-panel', attrs: { id: `review-${row.id}`, 'aria-labelledby': `review-title-${row.id}` } },
      h('div', { className: 'review-header' },
        h('h3', { className: 'review-title', text: 'Revisa la inscripció', attrs: { id: `review-title-${row.id}`, tabindex: '-1' } }),
        h('button', { className: 'btn btn-quiet btn-icon review-close', attrs: { type: 'button', 'aria-label': 'Tanca la revisió' }, on: { click: collapse } }, icon('close'))),
      h('p', { className: 'review-subject', text: row.submitted_name }),
      row.submitted_birth_date ? h('p', { className: 'review-birth' }, h('span', { className: 'field-label', text: 'Naixement declarat' }),
        h('span', { text: birthLabel(row.submitted_birth_date) })) : null,
      list, status,
      h('div', { className: 'candidate-search' }, h('label', { className: 'field-label', attrs: { for: searchInput.id }, text: 'Cerca una altra persona' }),
        h('div', { className: 'search-row' }, searchInput, searchButton)),
      h('div', { className: 'review-actions' }, link, h('span', { className: 'review-spacer' }), reject));
  }

  // ---- contextual payment evidence (§11.4)
  function evidenceBlock(payment) {
    const verify = h('button', { className: 'btn btn-secondary btn-small', text: 'Verifica', attrs: { type: 'button' } });
    verify.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Verificar el pagament?', body: `Confirmes que el pagament de ${formatMoney(payment.expected_amount_cents)} s’ha rebut al banc?`,
        confirm: 'Verifica', tone: 'primary' })) return;
      await reviewPayment(payment, 'VERIFIED', verify);
    });
    const issue = payment.review_status === 'PENDING_REVIEW' ? h('button', { className: 'btn btn-quiet btn-small', text: 'Marca incidència', attrs: { type: 'button' } }) : null;
    issue?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Marcar una incidència?', body: 'La família rebrà un avís que hi ha un problema amb el justificant.', confirm: 'Marca incidència', tone: 'strong' })) return;
      await reviewPayment(payment, 'ISSUE', issue);
    });
    return h('div', { className: 'evidence' },
      h('span', { className: 'evidence-amount', text: formatMoney(payment.expected_amount_cents) }),
      h('span', { className: 'evidence-state', text: label(payment.review_status) }),
      h('a', { className: 'link-button', text: 'Veure justificant', attrs: { href: `/api/payments/${payment.id}/evidence`, download: 'justificant' } }),
      h('span', { className: 'review-spacer' }), verify, issue);
  }
  async function reviewPayment(payment, decision, button) {
    button.setAttribute('aria-busy', 'true'); button.disabled = true;
    try {
      await call(`/api/payments/${payment.id}/review`, { method: 'POST', body: JSON.stringify({ decision }) });
      toast(decision === 'VERIFIED' ? 'Pagament verificat' : 'Incidència registrada');
      if (cache) cache.stale = true;
      onChanged();
    } catch (error) {
      if (error.status === 401) return;
      toast(errorCopy(error.code));
      button.removeAttribute('aria-busy'); button.disabled = false;
    }
  }

  return { render, clear() { token++; cache = null; expanded.clear(); contacts.clear(); } };
}
