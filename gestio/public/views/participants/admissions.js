// Participants → Noves altes (3.5H.2): the operational inbox of membership requests that arrive through the
// existing public form, and the request detail with its workflow. Matching information never leaves the
// people who can decide; candidate lists only reach group-wide reviewers.
import { confirmDialog, formDialog, h, icon, toast } from '../../ui.js';
import { ACTION_LABELS, EVENTS, FILTERS, REJECTIONS, SECTIONS, actionsFor, ageOn, apiQuery, errorCopy, parseFilters, sectionLabel, statusOf } from './admissions-model.js';

const day = ms => new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
const birth = iso => iso ? new Intl.DateTimeFormat('ca-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '';
const badge = ({ label, tone }) => h('span', { className: `badge tone-${tone}`, text: label });
const fact = (label, value) => h('div', { className: 'fact' }, h('span', { className: 'fact-label', text: label }), h('span', { className: 'fact-value fact-value-small', text: value }));

export function createAdmissionsInbox({ call, routes }) {
  const go = (path, query = {}, options) => routes.go({ page: 'participants', path: ['altes', ...path], query }, options);
  let token = 0;

  async function renderList(root, query) {
    const mine = ++token;
    const filters = parseFilters(query);
    const set = (key, value) => go([], Object.fromEntries(Object.entries({ ...filters, [key]: value }).filter(([, v]) => v)), { replace: true });
    const search = h('input', { attrs: { type: 'search', value: filters.q, placeholder: 'Busca per nom', 'aria-label': 'Busca per nom', maxlength: 80 } });
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => set('q', search.value.trim()), 350); });
    const section = h('select', { attrs: { 'aria-label': 'Secció' }, on: { change: event => set('seccio', event.target.value) } },
      h('option', { text: 'Totes les seccions', attrs: { value: '' } }), SECTIONS.map(item => h('option', { text: item.label, attrs: { value: item.value, selected: item.value === filters.seccio } })));
    const list = h('div', { className: 'activity-surface' }, h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    root.replaceChildren(
      h('div', { className: 'filter-chips admissions-filters', attrs: { role: 'group', 'aria-label': 'Estat' } }, FILTERS.map(item => h('button', { className: 'filter-chip', text: item.label,
        attrs: { type: 'button', 'aria-pressed': String(item.value === filters.estat) }, on: { click: () => set('estat', item.value) } }))),
      h('div', { className: 'activity-filters admissions-toolbar' }, h('label', { className: 'search-field' }, icon('search'), search), h('label', { className: 'select-field' }, section)),
      list);
    try {
      const { admissions } = await call(`/api/admissions?${apiQuery(filters)}`);
      if (mine !== token) return;
      list.replaceChildren(admissions.length ? h('ul', { className: 'tx-list admissions-list', attrs: { role: 'list' } }, admissions.map(row => h('li', { className: 'admissions-row' },
        h('a', { className: 'tx-label', attrs: { href: `#/participants/altes/${row.id}` }, on: { click: event => { event.preventDefault(); go([row.id]); } } },
          h('span', { className: 'tx-label-text', text: `${row.given_name} ${row.family_names}` }),
          h('span', { className: 'tx-sub', text: [`${ageOn(row.birth_date)} anys`, `${sectionLabel(row.section_code)}${row.section_confirmed ? '' : ' (sol·licitada)'}`, `rebuda ${day(row.received_at)}`].join(' · ') })),
        h('span', { className: 'admissions-badges' }, badge(statusOf(row.status)),
          row.match_status === 'AMBIGUOUS' ? badge({ label: 'Coincidència per revisar', tone: 'warning' }) : null))))
        : h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: filters.estat || filters.seccio || filters.q ? 'Cap sol·licitud coincideix amb els filtres.' : 'No hi ha sol·licituds obertes.' })));
    } catch (error) {
      if (mine === token) list.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) })));
    }
  }

  async function renderDetail(root, id) {
    const mine = ++token;
    root.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, h('span', { className: 'skeleton-line' })));
    let data;
    try { data = await call(`/api/admissions/${id}`); }
    catch (error) { if (mine === token) root.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: errorCopy(error) }))); return; }
    if (mine !== token) return;
    const a = data.admission, reload = () => renderDetail(root, id);
    const post = async (op, body = {}, success) => {
      try { await call(`/api/admissions/${id}/${op}`, { method: 'POST', body: JSON.stringify({ expectedVersion: a.version, ...body }) }); toast(success); await reload(); }
      catch (error) { toast(errorCopy(error), { tone: 'danger', timeout: 7000 }); if (error.code === 'stale_admission') await reload(); }
    };
    const handlers = {
      'start-review': () => post('start-review', {}, 'Revisió començada'),
      waitlist: async () => { if (await confirmDialog({ title: 'Passar a llista d’espera?', body: 'La sol·licitud continua activa i es pot reprendre més endavant.', confirm: 'Llista d’espera' })) await post('waitlist', {}, 'A la llista d’espera'); },
      'return-to-review': () => post('return-to-review', {}, 'Tornada a revisió'),
      withdraw: async () => { if (await confirmDialog({ title: 'Marcar com a retirada?', body: 'Vol dir que la família ha retirat la sol·licitud. No és un rebuig del grup.', confirm: 'Marca com a retirada', tone: 'danger' })) await post('withdraw', {}, 'Sol·licitud retirada'); },
      section: async () => {
        const values = await formDialog({ title: 'Confirma la secció', confirm: 'Confirma', fields: [{ name: 'section', label: 'Secció on entrarà', type: 'select',
          value: a.section ?? a.requestedSection ?? 'MANADA', options: SECTIONS }] });
        if (values) await post('section', { section: values.section }, 'Secció confirmada');
      },
      reject: async () => {
        const values = await formDialog({ title: 'Rebutjar la sol·licitud', confirm: 'Rebutja', tone: 'danger', fields: [{ name: 'category', label: 'Motiu', type: 'select', value: 'NO_PLACES', options: REJECTIONS }] });
        if (values) await post('reject', { category: values.category }, 'Sol·licitud rebutjada');
      },
      accept: async () => {
        const match = data.match;
        if (match?.status === 'AMBIGUOUS') { toast(errorCopy('admission_match_ambiguous'), { tone: 'danger', timeout: 7000 }); return; }
        const linking = match?.status === 'CLEAR' && match.participant;
        const body = linking ? `Ja existeix «${match.participant.name}» (${sectionLabel(match.participant.section)}${match.participant.active ? '' : ', antiga participant'}). Es vincularà la sol·licitud a aquesta persona${match.participant.active ? '' : ' i es reactivarà'}; no se’n crearà cap de nova.`
          : `Es crearà ${a.givenName} ${a.familyNames} a Participants, a ${sectionLabel(a.section)}${a.adult ? ' amb el seu contacte' : ', amb el tutor i el contacte de la sol·licitud'}.`;
        if (!await confirmDialog({ title: 'Acceptar l’alta?', body, confirm: linking ? 'Vincula i accepta' : 'Crea i accepta' })) return;
        await post('accept', linking ? { linkParticipantId: match.participant.id } : {}, 'Alta acceptada');
      }
    };
    const actions = actionsFor(a, data.actions);
    const matchBlock = data.match ? h('div', { className: `info-block admissions-match match-${data.match.status.toLowerCase()}` }, h('h3', { className: 'info-title', text: 'Coincidències a Participants' }),
      data.match.status === 'NONE' || data.match.status === 'RESOLVED_NEW' ? h('p', { text: 'Cap persona coincident: en acceptar es crearà una persona nova.' })
        : data.match.status === 'CLEAR' ? h('p', { text: data.match.participant ? `Coincideix amb «${data.match.participant.name}» (${sectionLabel(data.match.participant.section)}). En acceptar caldrà confirmar-ho.` : 'Coincideix amb una persona fora del teu abast. Ho ha de revisar Secretaria.' })
          : data.match.status === 'RESOLVED_EXISTING' ? h('p', { text: 'Resolta: és una persona que ja existeix.' })
            : h('div', {}, h('p', { className: 'field-error', text: 'Hi ha més d’una persona semblant. No es pot acceptar fins que es revise.' }),
              data.match.canResolve && data.match.candidates ? h('div', { className: 'candidate-list' }, data.match.candidates.map(person => h('div', { className: 'candidate' },
                h('span', { className: 'candidate-name', text: person.name }), h('span', { className: 'candidate-meta', text: `${birth(person.birthDate)} · ${sectionLabel(person.section)}${person.active ? '' : ' · inactiva'}` }),
                h('button', { className: 'btn btn-secondary btn-small', text: 'És aquesta persona', attrs: { type: 'button' }, on: { click: () => post('resolve-match', { decision: 'SAME_PERSON', participantId: person.id }, 'Coincidència resolta') } }))),
              h('button', { className: 'btn btn-secondary', text: 'És una persona diferent', attrs: { type: 'button' }, on: { click: () => post('resolve-match', { decision: 'DIFFERENT_PERSON' }, 'Coincidència resolta') } })) : null)) : null;
    root.replaceChildren(
      h('header', { className: 'detail-header' },
        h('a', { className: 'back-link', attrs: { href: '#/participants/altes' }, on: { click: event => { event.preventDefault(); go([]); } } }, icon('arrow-left'), h('span', { text: 'Noves altes' })),
        h('div', { className: 'detail-title-row' }, h('h1', { className: 'detail-title', text: `${a.givenName} ${a.familyNames}`, attrs: { tabindex: '-1' } }), badge(statusOf(a.status))),
        actions.length ? h('div', { className: 'detail-actions' }, actions.map(action => h('button', { className: `btn ${action === 'accept' ? 'btn-primary' : action === 'reject' || action === 'withdraw' ? 'btn-quiet' : 'btn-secondary'}`,
          text: ACTION_LABELS[action], attrs: { type: 'button' }, on: { click: handlers[action] } }))) : null),
      h('div', { className: 'summary-strip' }, fact('Naixement', birth(a.birthDate)), fact('Edat', `${ageOn(a.birthDate)} anys${a.adult ? ' · adulta' : ''}`),
        fact('Secció sol·licitada', sectionLabel(a.requestedSection)), fact('Secció confirmada', a.section ? sectionLabel(a.section) : 'Pendent')),
      h('div', { className: 'activity-surface info-surface' },
        a.contact ? h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Contacte de la sol·licitud' }),
          h('dl', { className: 'info-list' }, h('div', { className: 'info-row' }, h('dt', { text: a.adult ? 'Persona de contacte' : 'Mare, pare o tutor/a' }), h('dd', { text: a.contact.guardianName })),
            h('div', { className: 'info-row' }, h('dt', { text: 'Telèfon' }), h('dd', { text: a.contact.phone })), h('div', { className: 'info-row' }, h('dt', { text: 'Correu' }), h('dd', { text: a.contact.email })),
            a.heardFrom ? h('div', { className: 'info-row' }, h('dt', { text: 'Com ens ha conegut' }), h('dd', { text: a.heardFrom })) : null))
          : a.contactTransferred ? h('div', { className: 'info-block' }, h('p', { className: 'field-hint', text: 'El contacte ja és a la fitxa de Participants.' })) : null,
        a.participantId ? h('div', { className: 'info-block' }, h('a', { className: 'link-button', attrs: { href: `#/participants/${a.participantId}` }, text: 'Obri la fitxa a Participants',
          on: { click: event => { event.preventDefault(); routes.go({ page: 'participants', path: [a.participantId] }); } } })) : null,
        matchBlock,
        h('div', { className: 'info-block' }, h('h3', { className: 'info-title', text: 'Historial' }),
          h('ol', { className: 'history-list' }, data.events.map(event => h('li', {}, h('span', { text: EVENTS[event.action] ?? event.action }),
            h('span', { className: 'tx-sub', text: [day(event.created_at), event.actor_name, event.section_code ? sectionLabel(event.section_code) : null,
              event.action === 'REJECTED' ? REJECTIONS.find(item => item.value === event.category)?.label : null].filter(Boolean).join(' · ') })))))));
    root.querySelector('.detail-title')?.focus({ preventScroll: true });
  }
  return { renderList, renderDetail, clear() { token++; } };
}
