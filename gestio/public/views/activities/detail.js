// Activity detail (ACTIVITIES.md §10–§14): an operational page, not a form. Header with state and
// actions, an operational summary (or the DRAFT readiness block), and the Inscripcions / Informació
// tabs. Transitions are never optimistic: the state changes after the server confirms.
import { confirmDialog, h, icon, openMenu, toast } from '../../ui.js';
import { NOT_FOUND_MESSAGE, SECTION_LABELS, STATUS_LABELS, canManage, canReview, dateTime, errorCopy, formatMoney, longRange,
  partialLabel, phase, priceLabel, readOnlyReason, scopeLabel, signedMoney, timingLine } from './model.js';
import { createRegistrationsTab } from './registrations-tab.js';

const TABS = [{ id: 'inscripcions', label: 'Inscripcions' }, { id: 'informacio', label: 'Informació' }];

/**
 * @param {{root: HTMLElement, call: Function, caps: () => any, sections: () => Array<{id: string, code: string}>,
 *   go: (route: any, options?: any) => void, back: () => void, onEdit: (activity: any, trigger: HTMLElement) => void,
 *   onChanged: (change?: {discarded?: string}) => void}} options
 */
export function createActivityDetail({ root, call, caps, sections, go, back, onEdit, onChanged }) {
  let current = null, token = 0, message = null;
  const registrations = createRegistrationsTab({ call, caps, sections, onChanged: () => { void reload({ keepTab: true }); onChanged(); },
    setFilter: (id, filter) => go({ page: 'activitats', path: [id, 'inscripcions'], query: filter ? { filtre: filter } : {} }, { replace: true }),
    setQuery: (id, query) => go({ page: 'activitats', path: [id, 'inscripcions'], query }) });

  async function fetchActivity(id) { return (await call(`/api/activities/${id}`)).activity; }

  /** Render the detail for a route: #/activitats/<id>[/<tab>][?filtre=...]. */
  async function show(route, { focus = true } = {}) {
    const [id, requestedTab] = route.path;
    const mine = ++token;
    if (current?.id !== id) {
      current = null; message = null;
      root.replaceChildren(skeleton());
    }
    try {
      const activity = current?.id === id ? current : await fetchActivity(id);
      if (mine !== token) return;
      current = activity;
      render(activity, requestedTab, route.query, { focus });
    } catch (error) {
      if (mine !== token) return;
      current = null;
      if (error.status === 401) return;
      root.replaceChildren(error.status === 404 || error.status === 403 ? notFound() : loadError(route));
      document.title = 'Activitats · Gestió';
    }
  }
  async function reload({ keepTab = true, note = null } = {}) {
    if (!current) return;
    const id = current.id;
    try {
      current = await fetchActivity(id);
      if (note) message = note;
      render(current, keepTab ? activeTab : null, lastQuery, { focus: false });
    } catch (error) {
      if (error.status === 404 || error.status === 403) { current = null; root.replaceChildren(notFound()); }
    }
  }

  let activeTab = null, lastQuery = {};
  function tabsFor(activity) {
    const capabilities = caps();
    if (activity.status === 'DRAFT') return [];
    return TABS.filter(tab => tab.id === 'informacio' || canReview(activity, capabilities));
  }

  function render(activity, requestedTab, query = {}, { focus = true } = {}) {
    const capabilities = caps();
    const manageable = canManage(activity, capabilities);
    const tabs = tabsFor(activity);
    const fallback = tabs.some(tab => tab.id === 'inscripcions') ? 'inscripcions' : 'informacio';
    const tab = tabs.some(tab => tab.id === requestedTab) ? requestedTab : fallback;
    if (requestedTab && requestedTab !== tab) go({ page: 'activitats', path: [activity.id] }, { replace: true });
    activeTab = tab; lastQuery = query;
    document.title = `${activity.name} · Activitats · Gestió`;

    const title = h('h1', { className: 'detail-title', text: activity.name, attrs: { tabindex: '-1', id: 'activityDetailTitle' } });
    const badge = h('span', { className: `badge badge-${activity.status.toLowerCase()}`, text: STATUS_LABELS[activity.status], attrs: { id: 'activityDetailBadge' } });
    const timing = timingLine(activity);
    const soon = phase(activity) === 'deadline-soon', ended = phase(activity) === 'ended';
    const reason = readOnlyReason(activity, capabilities);
    const header = h('header', { className: 'detail-header' },
      h('a', { className: 'back-link', attrs: { href: '#/activitats' }, on: { click: event => { event.preventDefault(); back(); } } },
        icon('arrow-left'), h('span', { text: 'Activitats' })),
      h('div', { className: 'detail-heading' },
        h('div', { className: 'detail-title-row' }, title, badge),
        h('div', { className: 'detail-actions' }, actions(activity, manageable))),
      h('p', { className: 'detail-context', text: [scopeLabel(activity), longRange(activity.starts_at, activity.ends_at), activity.location].filter(Boolean).join(' · ') }),
      timing ? h('p', { className: `detail-timing${soon ? ' timing-warning' : ''}${ended || activity.status === 'DRAFT' ? ' timing-attention' : ''}`, text: timing }) : null,
      reason && activity.status !== 'CLOSED' ? h('p', { className: 'detail-readonly', text: reason }) : null,
      message ? h('p', { className: 'detail-message', attrs: { role: 'status' }, text: message }) : null);
    message = null;

    // Keyboard users switching tabs keep focus on the tab bar across the re-render.
    const tabHadFocus = root.contains(document.activeElement) && document.activeElement?.getAttribute('role') === 'tab';
    const body = activity.status === 'DRAFT' ? readiness(activity) : summary(activity);
    const content = h('div', { className: 'detail-tabpanel', attrs: tabs.length ? { role: 'tabpanel', id: 'activityTabPanel', 'aria-labelledby': `tab-${tab}` } : {} });
    root.replaceChildren(h('article', { className: 'activity-detail' }, header, body, tabs.length ? tabBar(activity, tabs, tab) : null, content));
    if (tab === 'inscripcions') registrations.render(content, activity, query);
    else content.append(information(activity));
    if (tabHadFocus) root.querySelector(`#tab-${tab}`)?.focus({ preventScroll: true });
    else if (focus) title.focus({ preventScroll: true });
  }

  // ---- actions per state and capability (§10.1)
  function actions(activity, manageable) {
    if (!manageable || activity.status === 'CLOSED') return [];
    const nodes = [];
    if (activity.status === 'DRAFT') nodes.push(h('button', { className: 'btn btn-primary detail-publish', text: 'Publicar', attrs: { type: 'button' },
      on: { click: event => publish(activity, event.currentTarget) } }));
    const edit = h('button', { className: 'btn btn-secondary', text: 'Editar', attrs: { type: 'button' } });
    edit.addEventListener('click', () => onEdit(activity, edit));
    nodes.push(edit);
    const menuItems = activity.status === 'DRAFT'
      ? (activity.termsLocked ? [] : [{ label: 'Descartar esborrany', tone: 'danger', onSelect: () => discard(activity) }])
      : [{ label: 'Tancar activitat', onSelect: () => closeActivity(activity) }];
    if (menuItems.length) {
      const more = h('button', { className: 'btn btn-secondary btn-icon', attrs: { type: 'button', 'aria-label': 'Més accions', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, icon('more'));
      more.addEventListener('click', () => openMenu(more, menuItems));
      nodes.push(more);
    }
    return nodes;
  }
  async function transition(activity, request, { success, onDone }) {
    try {
      await request();
      toast(success);
      onChanged();
      await reload({ keepTab: false });
      onDone?.();
    } catch (error) {
      if (error.status === 401) return;
      if (error.code === 'stale_activity') await reload({ note: 'L’activitat ha canviat. Revisa-la abans de continuar.' });
      else if (error.code === 'invalid_transition') await reload({ note: errorCopy('invalid_transition') });
      else { message = errorCopy(error.code); render(current ?? activity, activeTab, lastQuery, { focus: false }); }
    }
  }
  async function publish(activity, trigger) {
    const ok = await confirmDialog({ title: 'Publicar l’activitat?',
      body: `Les famílies la veuran al portal i s’hi podran inscriure fins al ${dateTime(activity.registration_deadline)}. Després de rebre inscripcions, les dates, el preu i l’abast ja no es podran canviar.`,
      confirm: 'Publica', tone: 'primary' });
    if (!ok) return;
    trigger.setAttribute('aria-busy', 'true'); trigger.disabled = true;
    await transition(activity, () => call(`/api/activities/${activity.id}/publish`, { method: 'POST', body: JSON.stringify({ expectedVersion: activity.version }) }),
      { success: 'Activitat publicada', onDone: () => root.querySelector('#activityDetailBadge')?.classList.add('badge-pulse') });
  }
  async function closeActivity(activity) {
    const ok = await confirmDialog({ title: 'Tancar l’activitat?', body: 'Ja no s’hi podran fer inscripcions noves i no es pot tornar a obrir.',
      confirm: 'Tanca l’activitat', tone: 'strong' });
    if (!ok) return;
    await transition(activity, () => call(`/api/activities/${activity.id}/close`, { method: 'POST', body: JSON.stringify({ expectedVersion: activity.version }) }),
      { success: 'Activitat tancada' });
  }
  async function discard(activity) {
    const ok = await confirmDialog({ title: 'Descartar l’esborrany?', body: `S’eliminarà «${activity.name}» definitivament. Aquesta acció no es pot desfer.`,
      confirm: 'Descarta l’esborrany', tone: 'danger' });
    if (!ok) return;
    try {
      await call(`/api/activities/${activity.id}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion: activity.version }) });
      current = null;
      toast('Esborrany descartat');
      onChanged({ discarded: activity.id });
      back({ replace: true });
    } catch (error) {
      if (error.status === 401) return;
      if (error.code === 'stale_activity') await reload({ note: 'L’activitat ha canviat. Revisa-la abans de continuar.' });
      else if (error.code === 'invalid_transition' || error.code === 'activity_has_registrations') await reload({ note: errorCopy(error.code) });
      else { message = errorCopy(error.code); render(activity, activeTab, lastQuery, { focus: false }); }
    }
  }

  // ---- operational summary (§10.2)
  function fact(value, label, extra = null) {
    return h('div', { className: 'fact' }, h('span', { className: 'fact-value', text: value }), h('span', { className: 'fact-label', text: label }), extra);
  }
  function summary(activity) {
    const facts = [];
    const summaryData = activity.registrations;
    if (summaryData) {
      const partial = partialLabel(summaryData);
      facts.push(fact(String(summaryData.total), `${summaryData.total === 1 ? 'inscripció' : 'inscripcions'}${partial ? ` de ${partial}` : ''}`,
        summaryData.needsReview ? h('span', { className: 'fact-extra signal-attention', text: `${summaryData.needsReview} per revisar` }) : null));
      if (activity.price_cents > 0) facts.push(fact(String(summaryData.awaitingPayment), summaryData.awaitingPayment === 1 ? 'pagament per revisar' : 'pagaments per revisar'));
    }
    if (activity.status === 'PUBLISHED') {
      const current = phase(activity);
      const text = { open: null, 'deadline-soon': null, 'registration-closed': 'Inscripcions tancades', 'in-progress': 'En curs', ended: 'Pendent de tancar' }[current];
      if (text) facts.push(fact(text, current === 'ended' ? 'ja ha finalitzat' : 'situació'));
      else {
        const days = Math.max(0, Math.ceil((activity.registration_deadline - Date.now()) / 86400000));
        facts.push(fact(days <= 1 ? 'Últim dia' : `${days} dies`, 'fins al termini', null));
      }
    }
    const group = activity.transportOptions?.find(option => option.code === 'GROUP');
    facts.push(fact(priceLabel(activity.price_cents), 'preu', group ? h('span', { className: 'fact-extra', text: `transport del grup ${signedMoney(group.price_adjustment_cents)}` }) : null));
    return h('section', { className: 'summary-strip', attrs: { 'aria-label': 'Resum de l’activitat' } }, facts.slice(0, 4));
  }
  function readiness(activity) {
    const futureDeadline = activity.registration_deadline >= Date.now();
    return h('section', { className: 'readiness', attrs: { 'aria-labelledby': 'readinessTitle' } },
      h('h2', { className: 'readiness-title', text: 'Abans de publicar', attrs: { id: 'readinessTitle' } }),
      h('ul', { className: 'readiness-list' },
        h('li', { className: futureDeadline ? 'ready-ok' : 'ready-blocked', text: futureDeadline ? 'Termini d’inscripció futur' : 'El termini ja ha passat: canvia’l per a poder publicar' }),
        !activity.short_description ? h('li', { className: 'ready-recommended', text: 'Recomanat: afegeix una descripció per a les famílies' }) : null));
  }

  // ---- tabs (WAI-ARIA)
  function tabBar(activity, tabs, selected) {
    const buttons = tabs.map(tab => {
      const summaryData = activity.registrations, partial = partialLabel(summaryData);
      const count = tab.id === 'inscripcions' && summaryData ? `${summaryData.total}${partial ? ` · ${partial}` : ''}` : null;
      return h('button', { className: 'tab', attrs: { type: 'button', role: 'tab', id: `tab-${tab.id}`, 'aria-selected': String(tab.id === selected),
        'aria-controls': 'activityTabPanel', tabindex: tab.id === selected ? '0' : '-1' }, dataset: { tab: tab.id } },
      h('span', { text: tab.label }), count ? h('span', { className: 'tab-count', text: count }) : null);
    });
    const select = tabId => go({ page: 'activitats', path: [activity.id, tabId] });
    for (const [index, button] of buttons.entries()) {
      button.addEventListener('click', () => select(button.dataset.tab));
      button.addEventListener('keydown', event => {
        const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const target = buttons[(next + buttons.length) % buttons.length];
        select(target.dataset.tab);
      });
    }
    return h('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Seccions de l’activitat' } }, buttons);
  }

  // ---- Informació (§12): a read view, not a disabled form
  function information(activity) {
    const group = activity.transportOptions?.find(option => option.code === 'GROUP');
    const row = (label, value) => value ? h('div', { className: 'info-row' }, h('dt', { text: label }), h('dd', { text: value })) : null;
    const block = (title, ...rows) => h('section', { className: 'info-block' }, h('h3', { className: 'info-title', text: title }), h('dl', { className: 'info-list' }, rows));
    const families = [['Descripció', activity.short_description], ['Material', activity.materials], ['Avís especial', activity.special_notice]].filter(([, value]) => value);
    const code = h('code', { className: 'public-code', text: activity.public_code });
    const copy = h('button', { className: 'btn btn-quiet btn-small', attrs: { type: 'button', 'aria-label': 'Copia el codi públic' } }, icon('copy'), h('span', { text: 'Copia' }));
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(activity.public_code); toast('Codi copiat'); } catch { toast('No s’ha pogut copiar el codi'); }
    });
    return h('div', { className: 'information' },
      block('Quan i on', row('Inici', dateTime(activity.starts_at)), row('Final', dateTime(activity.ends_at)),
        row('Termini d’inscripció', dateTime(activity.registration_deadline)), row('Lloc', activity.location)),
      block('Per a qui', row('Abast', activity.audience === 'GENERAL' ? 'Tot el grup' : (activity.sections || '').split(',').map(code => SECTION_LABELS[code.trim()]).filter(Boolean).join(', '))),
      block('Preu', row('Preu', activity.price_cents > 0 ? formatMoney(activity.price_cents) : 'Gratuïta'),
        group ? row('Transport del grup', signedMoney(group.price_adjustment_cents)) : null,
        group ? row('Transport per compte de la família', 'Sense cost per al grup') : null),
      h('section', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Per a les famílies' }),
        families.length ? h('dl', { className: 'info-list' }, families.map(([label, value]) => row(label, value)))
          : h('p', { className: 'info-empty', text: 'Encara no hi ha informació per a les famílies.' })),
      h('details', { className: 'info-internal' }, h('summary', { text: 'Dades internes' }),
        h('dl', { className: 'info-list' },
          h('div', { className: 'info-row' }, h('dt', { text: 'Codi públic' }), h('dd', { className: 'code-row' }, code, copy)),
          row('Creada el', dateTime(activity.created_at)), row('Actualitzada el', dateTime(activity.updated_at)))));
  }

  // ---- states
  function skeleton() {
    return h('div', { className: 'detail-skeleton', attrs: { 'aria-busy': 'true', 'aria-label': 'Carregant l’activitat' } },
      h('span', { className: 'skeleton-line short' }), h('span', { className: 'skeleton-block' }), h('span', { className: 'skeleton-line' }),
      h('div', { className: 'summary-strip' }, [1, 2, 3].map(() => h('span', { className: 'skeleton-block' }))));
  }
  function notFound() {
    return h('div', { className: 'detail-empty', attrs: { role: 'alert' } }, h('p', { className: 'empty-title', text: NOT_FOUND_MESSAGE }),
      h('a', { className: 'btn btn-secondary', text: 'Torna a Activitats', attrs: { href: '#/activitats' },
        on: { click: event => { event.preventDefault(); go({ page: 'activitats' }); } } }));
  }
  function loadError(route) {
    return h('div', { className: 'detail-empty', attrs: { role: 'alert' } }, h('p', { className: 'empty-title', text: 'No s’ha pogut carregar l’activitat.' }),
      h('div', { className: 'detail-empty-actions' },
        h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void show(route) } }),
        h('a', { className: 'link-button', text: 'Torna a Activitats', attrs: { href: '#/activitats' },
          on: { click: event => { event.preventDefault(); go({ page: 'activitats' }); } } })));
  }

  return {
    show, reload,
    current: () => current,
    fetch: fetchActivity,
    clear() { token++; current = null; root.replaceChildren(); registrations.clear(); }
  };
}
