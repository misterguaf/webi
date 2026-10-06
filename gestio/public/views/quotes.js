// Quotes (3.5I-Q, docs/design/screens/QUOTES.md): «Quins educands han pagat la quota anual i quins no?».
// One screen for everybody with fee visibility; GET /api/quotes decides the projection (basic: name, section,
// status; financial: amounts, family, payments, plan, issues). Actions reuse the existing fee endpoints, and the
// Treasury tools (round configuration, payment review) live at #/quotes/eines. View contract: ../view-registry.js.
import { confirmDialog, h, icon, toast } from '../ui.js';
import { QUICK, apiQuery, chargedPercent, emptyCopy, errorCopy, issueCopy, money, ordinalLabel, overpaymentCopy, parseFilters,
  reviewLabel, scopeLabel, sectionLabel, statusOf } from './quotes/model.js';

const $ = id => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = ms => ms ? new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)) : '';
const badge = code => { const status = statusOf(code); return h('span', { className: `badge tone-${status.tone} quota-status`, text: status.label }); };
const fact = (label, value) => h('div', { className: 'fact' }, h('span', { className: 'fact-label', text: label }), h('span', { className: 'fact-value', text: value }));
const block = (title, ...children) => h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: title }), ...children);

export function createQuotesView({ call, reportLoadError, routes, setPageHeader }) {
  const root = () => $('quotesView');
  let me = null, token = 0;
  const go = (path = [], query = {}, options) => routes.go({ page: 'quotes', path, query }, options);
  const link = (text, route, className = 'link-button') => h('a', { className, text, attrs: { href: `#/${[route.page, ...(route.path ?? [])].join('/')}` },
    on: { click: event => { event.preventDefault(); routes.go(route); } } });

  // ---------------------------------------------------------------- list
  async function renderList(query) {
    const mine = ++token, filters = parseFilters(query);
    const set = (key, value) => go([], Object.fromEntries(Object.entries({ ...filters, [key]: value }).filter(([, v]) => v)), { replace: true });
    root().replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    let data;
    try { data = await call(`/api/quotes?${apiQuery(filters)}`); }
    catch (error) { if (mine !== token) return; reportLoadError(error); root().replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }))); return; }
    if (mine !== token) return;
    const financial = data.mode === 'financial';
    setPageHeader({ hidden: false, title: `Quotes${data.roundCode ? ` · ${data.roundCode}` : ''}`, subtitle: scopeLabel(data.sections) });
    const search = h('input', { attrs: { type: 'search', value: filters.q, placeholder: 'Busca un educand', 'aria-label': 'Busca un educand', maxlength: 80 } });
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => set('q', search.value.trim()), 350); });
    const select = (label, key, options) => h('label', { className: 'select-field' }, h('span', { text: label }),
      h('select', { attrs: { 'aria-label': label }, on: { change: event => set(key, event.target.value) } },
        options.map(item => h('option', { text: item.label, attrs: { value: item.value, selected: item.value === filters[key] } }))));
    // Counts are allowed to every viewer of the scope; money only to financial readers.
    const summary = h('div', { className: 'summary-strip quotes-summary' }, fact('Educands', String(data.total)),
      ...['PAID', 'PARTIAL', 'PENDING', 'ISSUE'].map(code => h('button', { className: `fact quotes-count${filters.estat === code ? ' quotes-count-active' : ''}`,
        attrs: { type: 'button', 'aria-pressed': String(filters.estat === code) }, on: { click: () => set('estat', filters.estat === code ? '' : code) } },
        h('span', { className: 'fact-label', text: statusOf(code).label }), h('span', { className: 'fact-value', text: String(data.counts[code]) }))));
    const moneyStrip = h('div', { className: 'quotes-money', attrs: { hidden: true } });
    const list = h('div', { className: 'activity-surface quotes-surface' });
    const more = h('button', { className: 'btn btn-secondary list-more', text: 'Carrega’n més', attrs: { type: 'button', hidden: true } });
    const typing = !!document.activeElement?.closest?.('.quotes-filters .search-field');
    root().replaceChildren(summary, moneyStrip,
      h('div', { className: 'filter-chips quotes-quick', attrs: { role: 'group', 'aria-label': 'Estat de la quota' } }, QUICK.map(item => h('button', {
        className: 'filter-chip', text: item.label, attrs: { type: 'button', 'aria-pressed': String(item.value === filters.estat) }, on: { click: () => set('estat', item.value) } }))),
      h('div', { className: 'activity-filters quotes-filters' },
        h('label', { className: 'search-field' }, icon('search'), search),
        data.sections.length > 1 ? select('Secció', 'seccio', [{ value: '', label: 'Totes' }, ...data.sections.map(code => ({ value: code, label: sectionLabel(code) }))]) : null,
        data.rounds.length > 1 ? select('Curs', 'ronda', data.rounds.map(round => ({ value: round.id, label: round.code }))) : null,
        financial && me?.capabilities?.fees?.read?.all ? link('Eines de Tresoreria', { page: 'quotes', path: ['eines'] }, 'btn btn-secondary quotes-tools') : null),
      h('div', { className: 'quotes-list-wrap' }, list, more));
    if (typing) { search.focus({ preventScroll: true }); search.setSelectionRange(search.value.length, search.value.length); }
    const row = item => h('li', { className: 'quotes-row' },
      h('a', { className: 'tx-label', attrs: { href: `#/quotes/${item.participantId}` }, on: { click: event => { event.preventDefault();
        go([item.participantId], data.selectedRoundId && data.rounds[0]?.id !== data.selectedRoundId ? { ronda: data.selectedRoundId } : {}); } } },
        h('span', { className: 'tx-label-text', text: item.displayName }),
        h('span', { className: 'tx-sub', text: [sectionLabel(item.sectionCode), financial && item.active === false ? 'baixa' : null,
          financial ? `Rebut ${money(item.receivedCents)} de ${money(item.amountDueCents)}` : null].filter(Boolean).join(' · ') })),
      badge(item.status));
    const paint = (rows, append = false) => {
      if (!append) list.replaceChildren();
      if (!rows.length && !append) { list.append(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: emptyCopy(filters) }))); return; }
      let ul = list.querySelector('ul');
      if (!ul) { ul = h('ul', { className: 'tx-list quotes-list', attrs: { role: 'list' } }); list.append(ul); }
      ul.append(...rows.map(row));
    };
    paint(data.rows);
    let cursor = data.nextCursor; more.hidden = !cursor;
    more.addEventListener('click', async () => {
      try { const next = await call(`/api/quotes?${apiQuery(filters, cursor)}`); if (mine !== token) return; paint(next.rows, true); cursor = next.nextCursor; more.hidden = !cursor; }
      catch (error) { toast(errorCopy(error), { tone: 'danger' }); }
    });
    if (financial && data.selectedRoundId) {
      try {
        const { metrics } = await call(`/api/fees/rounds/${data.selectedRoundId}/metrics`);
        if (mine !== token) return;
        moneyStrip.replaceChildren(fact('Previst', money(metrics.expectedCents)), fact('Rebut verificat', money(metrics.confirmedAllocatedCents)),
          fact('Pendent', money(metrics.pendingCents)), fact('Verificat sense assignar', money(metrics.unallocatedVerifiedCents)));
        moneyStrip.className = 'summary-strip quotes-money'; moneyStrip.hidden = false;
      } catch { /* the money strip is optional */ }
    }
  }

  // ---------------------------------------------------------------- detail
  async function renderDetail(participantId, query) {
    const mine = ++token, round = parseFilters(query).ronda;
    setPageHeader({ hidden: true });
    root().replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    const back = link('Quotes', { page: 'quotes', query: round ? { ronda: round } : {} }, 'back-link');
    back.prepend(icon('arrow-left'));
    let data;
    try { data = await call(`/api/quotes/participants/${participantId}${round ? `?roundId=${round}` : ''}`); }
    catch (error) { if (mine !== token) return; root().replaceChildren(back, h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }))); return; }
    if (mine !== token) return;
    const q = data.quota, financial = data.mode === 'financial';
    const header = h('header', { className: 'detail-header' }, back,
      h('div', { className: 'detail-title-row' }, h('h1', { className: 'detail-title', text: q.displayName, attrs: { tabindex: '-1' } }), badge(q.status)),
      h('p', { className: 'detail-meta', text: `${sectionLabel(q.sectionCode)} · Quota ${q.roundCode}${financial && q.active === false ? ' · baixa' : ''}` }));
    const links = h('div', { className: 'quotes-links' },
      q.links.participant ? link('Obri la fitxa', { page: 'participants', path: [participantId] }) : null,
      financial && data.actions.treasury ? link('Obri Tresoreria', { page: 'tresoreria', path: [q.overpayments.length ? 'families' : 'inici'] }) : null,
      financial && me?.capabilities?.fees?.read?.all ? link('Eines de Tresoreria', { page: 'quotes', path: ['eines'] }) : null);
    if (!financial) {
      // Section coordinator / basic reader: the status and nothing else (no money, payer, evidence or siblings).
      root().replaceChildren(h('article', { className: 'quotes-detail' }, header,
        h('div', { className: 'activity-surface info-surface' }, block('Estat de la quota', h('p', { className: 'quotes-basic-status' }, badge(q.status))), links)));
      root().querySelector('.detail-title')?.focus({ preventScroll: true });
      return;
    }
    const reload = () => renderDetail(participantId, query);
    const act = async (path, body, success) => {
      try { await call(path, { method: 'POST', body: JSON.stringify(body) }); toast(success); await reload(); }
      catch (error) { toast(errorCopy(error), { tone: 'danger', timeout: 7000 }); }
    };
    const extra = overpaymentCopy(q.overpayments);
    const statusText = q.status === 'ISSUE' ? (q.issues.find(issue => issue.status === 'OPEN') ? issueCopy(q.issues.find(issue => issue.status === 'OPEN').code) : 'Hi ha més diners assignats que l’import degut.')
      : q.status === 'PAID' ? 'Quota coberta.' : q.status === 'PARTIAL' ? `Falten ${money(q.pendingCents)}.` : 'Encara no s’ha rebut cap pagament verificat.';
    const reviewHere = paymentId => data.actions.reviewPayments
      ? link('Revisa el pagament', { page: 'quotes', path: ['eines'], query: { pagament: paymentId } }) : null;
    const evidence = evidenceId => evidenceId && data.actions.reviewPayments
      ? h('a', { className: 'link-button', text: 'Veure justificant', attrs: { href: `/api/fees/evidence/${evidenceId}?mode=view`, target: '_blank', rel: 'noopener' } }) : null;
    root().replaceChildren(h('article', { className: 'quotes-detail' }, header,
      h('div', { className: 'summary-strip' }, fact('Import degut', money(q.amountDueCents)), fact('Rebut', money(q.receivedCents)), fact('Pendent', money(q.pendingCents)),
        fact('Ordre', ordinalLabel(q.siblingOrdinal)), fact('Quota aplicada', `${chargedPercent(q.baseCents, q.discountCents)} %`)),
      h('div', { className: 'activity-surface info-surface' },
        block('Situació', h('p', { text: statusText }), extra ? h('p', { className: 'field-hint', text: extra }) : null),
        q.family ? block(`Família ${q.family.reference}`, h('ul', { className: 'tx-list quotes-family', attrs: { role: 'list' } }, q.family.members.map(member => h('li', { className: 'quotes-row' },
          member.current ? h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${member.displayName} (aquesta fitxa)` }),
            h('span', { className: 'tx-sub', text: `${ordinalLabel(member.ordinal)} · ${sectionLabel(member.sectionCode)} · ${chargedPercent(member.baseCents, member.discountCents)} %` }))
            : h('a', { className: 'tx-label', attrs: { href: `#/quotes/${member.participantId}` }, on: { click: event => { event.preventDefault(); go([member.participantId], query); } } },
              h('span', { className: 'tx-label-text', text: member.displayName }),
              h('span', { className: 'tx-sub', text: `${ordinalLabel(member.ordinal)} · ${sectionLabel(member.sectionCode)} · ${chargedPercent(member.baseCents, member.discountCents)} %` })),
          badge(member.status)))),
        q.family.members.length < 2 ? h('p', { className: 'field-hint', text: 'Només es mostren els germans dins del teu abast.' }) : null) : null,
        block('Pagaments assignats', q.payments.length ? h('ul', { className: 'tx-list', attrs: { role: 'list' } }, q.payments.map(payment => h('li', { className: 'quotes-row' },
          h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${day(payment.receivedAt)} · ${money(payment.allocatedCents)}` }),
            h('span', { className: 'tx-sub', text: [reviewLabel(payment.reviewStatus), payment.openIssue ? 'amb incidència oberta' : null].filter(Boolean).join(' · ') })),
          h('span', { className: 'quotes-actions' }, evidence(payment.evidenceId), reviewHere(payment.paymentId))))) : h('p', { className: 'field-hint', text: 'Cap pagament assignat encara.' })),
        q.proofs.length ? block('Justificants rebuts pendents d’assignar', h('p', { className: 'field-hint', text: 'Un justificant no és un pagament verificat: cal comprovar-lo amb el banc.' }),
          h('ul', { className: 'tx-list', attrs: { role: 'list' } }, q.proofs.map(proof => h('li', { className: 'quotes-row' },
            h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${day(proof.receivedAt)}${proof.declaredCents != null ? ` · declarat ${money(proof.declaredCents)}` : ''}` }),
              h('span', { className: 'tx-sub', text: reviewLabel(proof.reviewStatus) })),
            h('span', { className: 'quotes-actions' }, evidence(proof.evidenceId), reviewHere(proof.paymentId)))))) : null,
        q.plan ? block('Pla de terminis', h('ul', { className: 'tx-list', attrs: { role: 'list' } }, q.plan.parts.map(part => h('li', { className: 'quotes-row' },
          h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${part.ordinal}a quota · ${money(part.plannedCents)}` }),
            h('span', { className: 'tx-sub', text: part.targetAt ? `Termini ${day(part.targetAt)}` : '' })))))) : null,
        block('Incidències', q.issues.length ? h('ul', { className: 'tx-list', attrs: { role: 'list' } }, q.issues.map(issue => h('li', { className: 'quotes-row' },
          h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: issueCopy(issue.code) }),
            h('span', { className: 'tx-sub', text: issue.status === 'OPEN' ? `Oberta des del ${day(issue.createdAt)}` : `Resolta el ${day(issue.resolvedAt)}` })),
          issue.status === 'OPEN' && (issue.paymentLevel ? data.actions.reviewPayments : data.actions.manage)
            ? h('button', { className: 'btn btn-secondary btn-small', text: 'Resol', attrs: { type: 'button' }, on: { click: async () => {
              if (await confirmDialog({ title: 'Resoldre la incidència?', body: issueCopy(issue.code), confirm: 'Resol' })) await act(`/api/fees/issues/${issue.id}/resolve`, {}, 'Incidència resolta');
            } } }) : null)))
          : h('p', { className: 'field-hint', text: 'Cap incidència.' }),
          data.actions.manage ? h('button', { className: 'btn btn-quiet btn-small', text: 'Obri una incidència', attrs: { type: 'button' }, on: { click: async () => {
            if (await confirmDialog({ title: 'Obrir una incidència?', body: 'Quedarà marcada com a discrepància d’import fins que Tresoreria la resolga.', confirm: 'Obri' }))
              await act('/api/fees/issues', { obligationId: q.obligationId, code: 'DISCREPANCY' }, 'Incidència oberta');
          } } }) : null),
        q.corrections.length ? block('Correccions de l’import', h('ul', { className: 'tx-list', attrs: { role: 'list' } }, q.corrections.map(change => h('li', { className: 'quotes-row' },
          h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: `${money(change.previousCents)} → ${money(change.newCents)}` }),
            h('span', { className: 'tx-sub', text: day(change.changedAt) })))))) : null,
        links)));
    root().querySelector('.detail-title')?.focus({ preventScroll: true });
  }

  function render(route) {
    const id = route?.path?.[0];
    if (id === 'eines') { root().hidden = true; token++; return; } // the Treasury tools are the legacy fee panel
    root().hidden = false;
    if (id && UUID.test(id)) void renderDetail(id, route.query ?? {});
    else if (id) go([], {}, { replace: true });
    else void renderList(route?.query ?? {});
  }
  return {
    id: 'quotes', page: 'quotes',
    // Anybody with basic or financial fee visibility; the server picks the projection.
    available: caps => !!(caps.fees.status || caps.fees.read),
    load(nextMe) { me = nextMe; },
    enter(nextMe, route) { me = nextMe; render(route); },
    unload() { me = null; token++; root().hidden = true; root().replaceChildren(); }
  };
}
