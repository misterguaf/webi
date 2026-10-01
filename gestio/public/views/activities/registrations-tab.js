// Inscripcions tab of an activity (ACTIVITIES.md §11, REGISTRATIONS.md §10): the surface where a
// registration is worked. Only what the reviewer's scope returns; partial scopes labelled; no contact
// data or declared birth date in the list (explicit requests); escalated rows only actionable by
// global reviewers; payments for this activity only (server-filtered by activityId).
import { fetchAllPages } from '../../api.js';
import { confirmDialog, formDialog, h, icon, openMenu, toast } from '../../ui.js';
import { canVerifyPayments, dateTime, errorCopy, partialLabel, shortDate } from './model.js';
import {
  ESCALATION_LABELS, SECTION_LABELS, WITHDRAWAL_SOURCES, accessibleRowName, canRevealContact, correctionTargets, defaultNotify,
  displayName, groupConfirmed, isActionable, isGlobalReviewer, paymentLine, paymentStateLabel, registrationStateLabel, rowActions, secondaryLine,
  transportTotals, visibleFilters
} from '../registrations/model.js';
import { evidenceBlock } from '../registrations/evidence.js';

const birthLabel = value => value ? new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${value}T00:00:00Z`)) : '';
const REG_ERRORS = {
  invalid_transition: 'Aquesta inscripció ha canviat. S’ha actualitzat la informació.', stale_registration: 'Aquesta inscripció ha canviat. S’ha actualitzat la informació.',
  section_not_in_audience: 'Aquesta activitat no admet aquesta secció.', section_mismatch: 'La persona és d’una altra secció: primer cal corregir la secció de la inscripció.',
  global_review_required: 'Aquesta inscripció està en revisió global.', invalid_review: 'Revisa la selecció.', forbidden: 'No tens permís per a fer aquesta acció.',
  not_found: 'No tens accés a aquesta inscripció o ja no existeix.', already_registered: 'Aquesta persona ja té una inscripció en aquesta activitat.' };
const regError = code => REG_ERRORS[code] ?? errorCopy(code);

/**
 * @param {{call: Function, caps: () => any, sections: () => Array<{id: string, code: string}>, onChanged: () => void,
 *   setFilter: (activityId: string, filter: string) => void, setQuery: (activityId: string, query: Record<string,string>) => void}} options
 */
export function createRegistrationsTab({ call, caps, sections, onChanged, setFilter, setQuery }) {
  let cache = null, token = 0;
  const expanded = new Set(), contacts = new Map();

  async function load(activity) {
    const verify = canVerifyPayments(activity, caps());
    const [rows, payments] = await Promise.allSettled([
      fetchAllPages(call, `/api/activities/${activity.id}/registrations`, 'registrations'),
      verify ? fetchAllPages(call, `/api/payments?vista=totes&activityId=${encodeURIComponent(activity.id)}`, 'payments') : Promise.resolve({ payments: [] })]);
    if (rows.status === 'rejected') throw rows.reason;
    // A registration may have several payment attempts (proofs); keep them all, oldest first.
    const evidence = payments.status === 'fulfilled' ? new Map() : null;
    if (evidence) for (const payment of [...payments.value.payments].sort((a, b) => a.evidence.receivedAt - b.evidence.receivedAt))
      evidence.set(payment.registrationId, [...(evidence.get(payment.registrationId) ?? []), payment]);
    return { activityId: activity.id, version: activity.version, rows: rows.value.registrations, evidence, evidenceError: payments.status === 'rejected' && verify };
  }

  async function render(container, activity, query) {
    const mine = ++token;
    if (query?.vista === 'confirmats') { await renderConfirmed(container, activity, mine); return; }
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
  function refresh() { if (cache) cache.stale = true; contacts.clear(); onChanged(); }

  function draw(container, activity, query) {
    const rows = cache.rows;
    const filters = visibleFilters(rows, { paid: activity.price_cents > 0 });
    const counts = Object.fromEntries(filters.map(filter => [filter.value, rows.filter(filter.match).length]));
    const requested = filters.some(filter => filter.value === query?.filtre) ? query.filtre : null;
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
    const confirmedCount = rows.filter(row => row.status === 'CONFIRMED').length;
    nodes.push(h('div', { className: 'reg-toolbar' }, chips,
      confirmedCount ? h('button', { className: 'btn btn-secondary btn-small', text: 'Llista de confirmats', attrs: { type: 'button' },
        on: { click: () => setQuery(activity.id, { vista: 'confirmats' }) } }) : null));
    if (!visible.length) nodes.push(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: 'No hi ha inscripcions en aquest estat.' }),
      h('button', { className: 'btn btn-secondary', text: 'Mostra-les totes', attrs: { type: 'button' }, on: { click: () => setFilter(activity.id, 'totes') } })));
    else nodes.push(h('ul', { className: 'registration-list', attrs: { role: 'list' } }, visible.map(row => registrationRow(row, activity, container, query))));
    container.replaceChildren(...nodes);
  }

  function registrationRow(row, activity, container, query) {
    const capabilities = caps(), allSections = sections();
    const attempts = cache.evidence?.get(row.id) ?? [];
    const evidence = attempts[0] ?? null;
    const redraw = () => draw(container, activity, query);
    const state = h('span', { className: `badge reg-${row.status.toLowerCase().replaceAll('_', '-')}`, text: registrationStateLabel(row.status) });
    const payment = activity.price_cents > 0 && row.payment_status && row.payment_status !== 'NOT_REQUIRED' && ['AWAITING_PAYMENT_REVIEW', 'WITHDRAWN'].includes(row.status)
      ? h('span', { className: 'reg-payment', text: evidence ? paymentLine(evidence) : paymentStateLabel(row.payment_status) }) : null;
    const escalated = row.review_level === 'GLOBAL' && row.status === 'NEEDS_PARTICIPANT_REVIEW'
      ? h('span', { className: 'badge reg-escalated', text: 'En revisió global' }) : null;
    const reason = escalated && row.escalation_reason ? h('span', { className: 'reg-payment', text: ESCALATION_LABELS[row.escalation_reason] }) : null;
    const name = row.participant
      ? h('a', { className: 'reg-name reg-linked', text: row.participant.name, attrs: { href: `#/participants/${row.participant.id}`, title: 'Obre la fitxa' } })
      : h('span', { className: 'reg-name', text: displayName(row) });
    const main = h('div', { className: 'reg-main' }, name, state, escalated, reason, payment);
    const item = h('li', { className: 'registration-row', dataset: { id: row.id }, attrs: { 'aria-label': accessibleRowName(row) } },
      main, h('p', { className: 'reg-secondary', text: secondaryLine(row, activity, allSections, shortDate) }));

    // Review disclosure (pending, actionable).
    if (row.status === 'NEEDS_PARTICIPANT_REVIEW' && isActionable(capabilities, row)) {
      const open = expanded.has(row.id);
      const toggle = h('button', { className: 'btn btn-secondary btn-small reg-toggle', text: open ? 'Amaga la revisió' : 'Revisa',
        attrs: { type: 'button', 'aria-expanded': String(open), 'aria-controls': `review-${row.id}` } });
      toggle.addEventListener('click', () => { if (open) expanded.delete(row.id); else expanded.add(row.id); redraw();
        if (!open) requestAnimationFrame(() => document.querySelector(`#review-${row.id} .review-title`)?.focus()); });
      main.append(toggle);
    }
    // Row menu (§10.3).
    const actions = rowActions(activity, capabilities, row, allSections);
    if (actions.length) {
      const more = h('button', { className: 'btn btn-quiet btn-icon btn-small reg-more', attrs: { type: 'button', 'aria-label': `Accions de ${displayName(row)}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, icon('more'));
      more.addEventListener('click', () => openMenu(more, actions.map(action => ({
        'correct-section': { label: 'Corregeix la secció', onSelect: () => correctSection(row, activity) },
        escalate: { label: 'Envia a revisió global', onSelect: () => escalate(row) },
        withdraw: { label: 'Registra la retirada', tone: 'danger', onSelect: () => withdraw(row) } }[action]))));
      main.append(more);
    }
    // Submitter contact: explicit, audited request.
    if (canRevealContact(capabilities, row)) {
      const shown = contacts.get(row.id);
      const contact = h('button', { className: 'link-button reg-contact-toggle', text: shown ? 'Amaga' : 'Mostra el contacte', attrs: { type: 'button', 'aria-expanded': String(!!shown) } });
      contact.addEventListener('click', async () => {
        if (shown) { contacts.delete(row.id); redraw(); return; }
        contact.setAttribute('aria-busy', 'true');
        try { contacts.set(row.id, (await call(`/api/registrations/${row.id}/contact`)).contact); redraw(); }
        catch (error) { contact.removeAttribute('aria-busy'); if (error.status !== 401) toast('No s’ha pogut consultar el contacte.'); }
      });
      item.append(h('div', { className: 'reg-tools' }, contact));
      if (shown) item.append(h('dl', { className: 'reg-contact' },
        h('div', {}, h('dt', { text: 'Qui la va enviar' }), h('dd', { text: shown.submittedByName || '—' })),
        h('div', {}, h('dt', { text: 'Telèfon' }), h('dd', { text: shown.phone || 'No indicat' })),
        h('div', {}, h('dt', { text: 'Correu' }), h('dd', { text: shown.email }))));
    }
    if (row.status === 'NEEDS_PARTICIPANT_REVIEW' && expanded.has(row.id) && isActionable(capabilities, row))
      item.append(reviewPanel(row, activity, () => { expanded.delete(row.id); redraw(); document.querySelector(`[data-id="${row.id}"] .reg-toggle`)?.focus(); }));
    // One block per attempt that still needs attention (pending, flagged, or more can be verified on it).
    if (['AWAITING_PAYMENT_REVIEW', 'WITHDRAWN'].includes(row.status))
      for (const attempt of attempts)
        if (attempt.evidenceStatus !== 'VERIFIED' || attempt.remainingCents > 0) item.append(evidenceBlock({ call, payment: attempt, onChanged: refresh, attemptOnly: true }));
    return item;
  }

  // ---- participant review (§12.4): signals, not master data; no auto-merge, no auto-create
  function reviewPanel(row, activity, collapse) {
    let chosen = null;
    const declared = h('p', { className: 'review-birth', attrs: { hidden: true } });
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
        if (data.declared?.birthDate) { declared.hidden = false; declared.replaceChildren(h('span', { className: 'field-label', text: 'Naixement declarat' }), h('span', { text: birthLabel(data.declared.birthDate) })); }
        chosen = null; link.disabled = true;
        list.replaceChildren(...(data.candidates.length ? data.candidates.map(person => {
          const radio = h('input', { attrs: { type: 'radio', name: `candidate-${row.id}`, value: person.id, id: `candidate-${row.id}-${person.id}` } });
          radio.addEventListener('change', () => { chosen = person; link.disabled = person.section_matches === false; status.textContent = person.section_matches === false
            ? 'Aquesta persona és d’una altra secció. Corregeix primer la secció de la inscripció.' : ''; });
          return h('label', { className: 'candidate', attrs: { for: radio.id } }, radio,
            h('span', { className: 'candidate-name', text: person.display_name }),
            h('span', { className: 'candidate-meta', text: [SECTION_LABELS[person.section_code] ?? person.section_code,
              person.section_matches === false ? 'secció diferent' : null,
              person.birth_date_matches ? 'naixement coincideix' : 'naixement no coincideix', person.birth_date ? birthLabel(person.birth_date) : null].filter(Boolean).join(' · ') }));
        }) : [h('p', { className: 'field-hint', text: search ? 'Cap persona coincideix amb la cerca.' : 'No hi ha candidats plausibles. Cerca per nom si la coneixes.' })]));
        status.textContent = data.truncated ? 'Hi ha més coincidències de les que es mostren. Afina la cerca.' : '';
      } catch (error) {
        if (error.status === 401) return;
        list.replaceChildren(h('p', { className: 'field-error', text: error.status === 400 ? 'Escriu almenys 2 lletres per a cercar.' : regError(error.code) }),
          h('button', { className: 'btn btn-secondary btn-small', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void candidates(search) } }));
      } finally { list.removeAttribute('aria-busy'); }
    }
    searchButton.addEventListener('click', () => { const value = searchInput.value.trim(); if (value.length < 2) { status.textContent = 'Escriu almenys 2 lletres per a cercar.'; return; } void candidates(value); });
    searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchButton.click(); } });
    async function review(decision) {
      const body = decision === 'MATCH' ? { decision, participantId: chosen.id, expectedVersion: row.version } : { decision, expectedVersion: row.version };
      const button = decision === 'MATCH' ? link : reject;
      button.setAttribute('aria-busy', 'true'); button.disabled = true;
      try {
        await call(`/api/registrations/${row.id}/review`, { method: 'POST', body: JSON.stringify(body) });
        toast(decision === 'MATCH' ? 'Inscripció vinculada' : 'Inscripció rebutjada');
        expanded.delete(row.id); refresh();
      } catch (error) {
        if (error.status === 401) return;
        status.textContent = regError(error.code);
        if (['invalid_transition', 'stale_registration'].includes(error.code)) refresh();
      } finally { button.removeAttribute('aria-busy'); button.disabled = decision === 'MATCH' ? !chosen || chosen.section_matches === false : false; }
    }
    link.addEventListener('click', () => { if (chosen) void review('MATCH'); });
    reject.addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Rebutjar la inscripció?', body: `La sol·licitud de «${row.submitted_name}» quedarà rebutjada. La família rebrà un avís que no s’ha pogut acceptar.`,
        confirm: 'Rebutja', tone: 'danger' })) void review('REJECT');
    });
    void candidates();
    return h('section', { className: 'review-panel', attrs: { id: `review-${row.id}`, 'aria-labelledby': `review-title-${row.id}` } },
      h('div', { className: 'review-header' },
        h('h3', { className: 'review-title', text: 'Revisa la inscripció', attrs: { id: `review-title-${row.id}`, tabindex: '-1' } }),
        h('button', { className: 'btn btn-quiet btn-icon review-close', attrs: { type: 'button', 'aria-label': 'Tanca la revisió' }, on: { click: collapse } }, icon('close'))),
      h('p', { className: 'review-subject', text: row.submitted_name }), declared, list, status,
      h('div', { className: 'candidate-search' }, h('label', { className: 'field-label', attrs: { for: searchInput.id }, text: 'Cerca una altra persona' }),
        h('div', { className: 'search-row' }, searchInput, searchButton)),
      h('div', { className: 'review-actions' }, link, h('span', { className: 'review-spacer' }), reject));
  }

  // ---- row actions (§12.2, §12.3, §13.2)
  async function post(path, body, success) {
    try { await call(path, { method: 'POST', body: JSON.stringify(body) }); toast(success); refresh(); }
    catch (error) { if (error.status === 401) return; toast(regError(error.code)); if (['invalid_transition', 'stale_registration'].includes(error.code)) refresh(); }
  }
  async function correctSection(row, activity) {
    const targets = correctionTargets(activity, caps(), row, sections());
    const values = await formDialog({ title: 'Corregir la secció', confirm: 'Continua', fields: [
      { name: 'sectionId', label: 'Secció correcta', type: 'select', options: targets.map(section => ({ value: section.id, label: SECTION_LABELS[section.code] ?? section.code })), value: targets[0]?.id }] });
    if (!values) return;
    const target = targets.find(section => section.id === values.sectionId);
    if (!target || !await confirmDialog({ title: 'Corregir la secció?', body: `La inscripció passarà a ${SECTION_LABELS[target.code] ?? target.code}. La secció declarada per la família es conserva.`,
      confirm: 'Corregeix', tone: 'strong' })) return;
    await post(`/api/registrations/${row.id}/section`, { sectionId: target.id, expectedVersion: row.version }, 'Secció corregida');
  }
  async function escalate(row) {
    if (!await confirmDialog({ title: 'Enviar a revisió global?', body: 'La revisarà Secretaria o la coordinació general. Fins aleshores no la podràs vincular ni rebutjar.',
      confirm: 'Envia', tone: 'strong' })) return;
    await post(`/api/registrations/${row.id}/escalate`, { expectedVersion: row.version }, 'Enviada a revisió global');
  }
  async function withdraw(row) {
    const pending = formDialog({ title: 'Registrar la retirada?', confirm: 'Registra la retirada', tone: 'danger', fields: [
      { name: 'source', label: 'Origen', type: 'select', options: WITHDRAWAL_SOURCES, value: 'FAMILY_COMMUNICATION' },
      { name: 'notifyFamily', label: 'Avís', type: 'checkbox', checkboxLabel: 'Envia una confirmació a la família', value: defaultNotify('FAMILY_COMMUNICATION') }] });
    // The notice default follows the source until the user changes it explicitly.
    const source = document.getElementById('fd-source'), notify = document.getElementById('fd-notifyFamily');
    let touched = false;
    notify?.addEventListener('change', () => { touched = true; });
    source?.addEventListener('change', () => { if (!touched && notify) notify.checked = defaultNotify(source.value); });
    const note = h('p', { className: 'dialog-body', text: 'La inscripció quedarà retirada. No s’elimina cap dada ni s’inicia cap devolució.' });
    document.querySelector('.dialog-layer:last-of-type .dialog-form')?.prepend(note);
    const values = await pending;
    if (!values) return;
    await post(`/api/registrations/${row.id}/withdraw`, { source: values.source, notifyFamily: !!values.notifyFamily, expectedVersion: row.version }, 'Retirada registrada');
  }

  // ---- confirmed list (§17)
  async function renderConfirmed(container, activity, mine) {
    container.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2].map(() => h('span', { className: 'skeleton-line' }))));
    let rows;
    try { rows = (await call(`/api/activities/${activity.id}/registrations/confirmed`)).confirmed; }
    catch (error) {
      if (mine !== token || error.status === 401) return;
      container.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: 'No s’ha pogut carregar la llista de confirmats.' })));
      return;
    }
    if (mine !== token) return;
    const back = h('button', { className: 'btn btn-quiet btn-small', text: '← Totes les inscripcions', attrs: { type: 'button' }, on: { click: () => setQuery(activity.id, {}) } });
    const totals = transportTotals(rows), partial = partialLabel(activity.registrations);
    const summary = [`${rows.length} ${rows.length === 1 ? 'confirmada' : 'confirmades'}`,
      totals.group || totals.family ? `${totals.group} amb transport del grup` : null].filter(Boolean).join(' · ');
    const nodes = [h('div', { className: 'reg-toolbar' }, back), h('h3', { className: 'confirmed-title', text: 'Llista de confirmats' }), h('p', { className: 'confirmed-summary', text: summary })];
    if (partial) nodes.push(h('p', { className: 'scope-note', text: `Veus les inscripcions de ${partial}.` }));
    if (!rows.length) nodes.push(h('p', { className: 'empty-title', text: 'Encara no hi ha inscripcions confirmades.' }));
    for (const group of groupConfirmed(rows, sections()))
      nodes.push(h('div', { className: 'confirmed-group' }, h('h4', { className: 'confirmed-section', text: `${group.label} · ${group.rows.length}` }),
        h('ul', { className: 'confirmed-list', attrs: { role: 'list' } }, group.rows.map(row => h('li', { className: 'confirmed-row' },
          row.participant ? h('a', { text: row.name, attrs: { href: `#/participants/${row.participant.id}` } }) : h('span', { text: row.name }),
          row.transport_code ? h('span', { className: 'confirmed-meta', text: row.transport_code === 'GROUP' ? 'Transport del grup' : 'Transport de la família' }) : null)))));
    container.replaceChildren(...nodes);
  }

  return { render, clear() { token++; cache = null; expanded.clear(); contacts.clear(); } };
}
