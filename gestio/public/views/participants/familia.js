// Família tab (3.5E §9–§10): guardians and contacts. Contact values only on an explicit, audited
// consultation. Shared-guardian edits the user cannot make directly become a request to Secretaria.
import { confirmDialog, formDialog, h, icon, openMenu, toast } from '../../ui.js';
import { RELATIONSHIP_OPTIONS, contactKindLabel, relationshipLabel, relationshipPeriod, relinkableIds, representationLine } from './model.js';

const errorCopy = code => ({ forbidden: 'No tens permís per a fer aquest canvi.', invalid_guardian: 'Revisa les dades.',
  invalid_contact: 'Revisa les dades del contacte.', primary_contact_exists: 'Ja hi ha un contacte principal d’aquest tipus.',
  not_found: 'Ja no està disponible.', invalid_transition: 'L’estat ha canviat.', already_linked: 'Aquesta relació ja està vigent.' }[code] ?? 'No s’ha pogut completar l’acció.');

/**
 * @param {{call, caps:()=>any, onChanged:()=>void}} options
 */
export function createFamiliaTab({ call, caps, onChanged }) {
  let cache = null, token = 0, activityId = null;

  async function render(container, participant) {
    activityId = participant.id;
    const mine = ++token;
    if (!cache || cache.id !== participant.id || cache.stale) {
      container.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2].map(() => h('span', { className: 'skeleton-line' }))));
      try { cache = { id: participant.id, data: await call(`/api/participants/${participant.id}/familia`) }; }
      catch (error) {
        if (mine !== token || error.status === 401) return;
        container.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: 'No s’han pogut carregar els tutors i contactes.' }),
          h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => { cache = null; void render(container, participant); } } })));
        return;
      }
      if (mine !== token) return;
    }
    draw(container, participant);
  }

  function draw(container, participant) {
    const c = caps().participants, { guardians, participantContacts } = cache.data;
    const canGuardian = sectionAllows(c.manageGuardians, participant.currentSectionId);
    const canContact = sectionAllows(c.manageContacts, participant.currentSectionId);
    const canAccredit = !!c.accredit;
    const nodes = [];
    // Guardians
    const guardianBlock = h('section', { className: 'family-block' },
      h('div', { className: 'family-head' }, h('h2', { className: 'info-title', text: 'Tutors' }),
        canGuardian ? h('button', { className: 'btn btn-secondary btn-small', text: 'Afegeix un tutor', attrs: { type: 'button' }, on: { click: () => addGuardian(participant) } }) : null));
    const active = guardians.filter(g => !g.ended), ended = guardians.filter(g => g.ended);
    if (!active.length) guardianBlock.append(h('p', { className: 'info-empty', text: 'Encara no hi ha tutors registrats.' }));
    else guardianBlock.append(h('ul', { className: 'guardian-list', attrs: { role: 'list' } }, active.map(g => guardianRow(participant, g, { canGuardian, canContact, canAccredit }))));
    const relinkable = canGuardian ? relinkableIds(guardians) : new Set();
    if (ended.length) guardianBlock.append(h('details', { className: 'ended-relations' }, h('summary', { text: `Relacions anteriors (${ended.length})` }),
      h('ul', { className: 'guardian-list' }, ended.map(g => guardianRow(participant, g, { canGuardian: false, canContact: false, canAccredit: false, canRelink: relinkable.has(g.relationshipId) })))));
    nodes.push(guardianBlock);
    // Participant's own contacts
    const ownBlock = h('section', { className: 'family-block' },
      h('div', { className: 'family-head' }, h('h2', { className: 'info-title', text: 'Contactes del participant' }),
        canContact ? h('button', { className: 'btn btn-secondary btn-small', text: 'Afegeix un contacte', attrs: { type: 'button' }, on: { click: () => addContact(participant, { ownerType: 'participant' }) } }) : null));
    ownBlock.append(participantContacts.length
      ? h('ul', { className: 'contact-list', attrs: { role: 'list' } }, participantContacts.map(ct => contactRow(participant, ct, { canContact })))
      : h('p', { className: 'info-empty', text: 'Sense contactes propis.' }));
    nodes.push(ownBlock);
    container.replaceChildren(...nodes);
  }

  function guardianRow(participant, g, { canGuardian, canContact, canAccredit, canRelink = false }) {
    const rep = representationLine(g);
    const head = h('div', { className: 'guardian-head' },
      h('span', { className: 'guardian-name', text: g.displayName }),
      h('span', { className: 'guardian-rel', text: relationshipLabel(g.relationship) }),
      g.ended ? h('span', { className: 'guardian-rel', text: relationshipPeriod(g) }) : null,
      rep ? h('span', { className: `guardian-rep${g.representationBasis === 'ACREDITAT' ? ' rep-accredited' : ''}`, text: rep }) : null);
    if (!g.ended && (canGuardian || (canAccredit && g.legalRepresentative && g.representationBasis === 'COMUNICAT'))) {
      const items = [];
      if (canGuardian) items.push(g.legalRepresentative
        ? { label: 'Treure representació legal', onSelect: () => setRepresentation(participant, g, false) }
        : { label: 'Marca com a representant legal', onSelect: () => setRepresentation(participant, g, true) });
      if (canAccredit && g.legalRepresentative && g.representationBasis === 'COMUNICAT') items.push({ label: 'Marca com a acreditada', onSelect: () => accredit(participant, g) });
      if (canGuardian) items.push({ label: 'Finalitza la relació', tone: 'danger', onSelect: () => endRelationship(participant, g) });
      const more = h('button', { className: 'btn btn-quiet btn-icon btn-small', attrs: { type: 'button', 'aria-label': `Accions de ${g.displayName}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, icon('more'));
      more.addEventListener('click', () => openMenu(more, items));
      head.append(more);
    }
    const contacts = g.contacts.length
      ? h('ul', { className: 'contact-list', attrs: { role: 'list' } }, g.contacts.map(ct => contactRow(participant, ct, { canContact })))
      : h('p', { className: 'info-empty small', text: 'Sense contactes.' });
    const add = !g.ended && canContact ? h('button', { className: 'link-button', text: 'Afegeix un contacte', attrs: { type: 'button' }, on: { click: () => addContact(participant, { ownerType: 'guardian', guardianId: g.id }) } }) : null;
    const relink = canRelink ? h('button', { className: 'link-button', text: 'Torna a vincular', attrs: { type: 'button' }, on: { click: () => relinkGuardian(participant, g) } }) : null;
    return h('li', { className: 'guardian-item' }, head, contacts, add, relink);
  }

  function contactRow(participant, ct, { canContact }) {
    const valueSpan = h('span', { className: 'contact-value', text: '•••' });
    const reveal = h('button', { className: 'link-button contact-reveal', text: 'Consulta el contacte', attrs: { type: 'button', 'aria-expanded': 'false' } });
    reveal.addEventListener('click', async () => {
      if (reveal.getAttribute('aria-expanded') === 'true') { valueSpan.textContent = '•••'; reveal.textContent = 'Consulta el contacte'; reveal.setAttribute('aria-expanded', 'false'); return; }
      try { const { contact } = await call(`/api/contacts/${ct.id}`); valueSpan.textContent = contact.value; reveal.textContent = 'Amaga'; reveal.setAttribute('aria-expanded', 'true'); }
      catch (error) { if (error.status !== 401) toast('No s’ha pogut consultar el contacte.'); }
    });
    const row = h('li', { className: 'contact-item' },
      h('span', { className: 'contact-kind', text: `${contactKindLabel(ct.kind)}${ct.isPrimary ? ' · principal' : ''}` }),
      valueSpan, reveal);
    if (canContact) {
      const end = h('button', { className: 'link-button contact-end', text: 'Retira', attrs: { type: 'button' } });
      end.addEventListener('click', () => endContact(participant, ct));
      row.append(end);
    }
    return row;
  }

  function sectionAllows(scope, sectionId) { return !!scope && (scope.all || scope.sections.some(s => s.id === sectionId)); }
  function refresh() { cache = null; onChanged(); }
  function requested() { toast('Sol·licitud enviada a Secretaria'); refresh(); }

  async function addGuardian(participant) {
    const values = await formDialog({ title: 'Afegeix un tutor', confirm: 'Afegeix', fields: [
      { name: 'name', label: 'Nom del tutor', required: true, attrs: { maxlength: '120' } },
      { name: 'relationship', label: 'Vincle', type: 'select', options: RELATIONSHIP_OPTIONS, value: 'PARENT' },
      { name: 'legalRepresentative', label: 'Representació legal', type: 'checkbox', checkboxLabel: 'És representant legal (comunicat per la família)' }] });
    if (!values) return;
    await run(() => call(`/api/participants/${participant.id}/guardians`, { method: 'POST', body: JSON.stringify({ name: values.name, relationship: values.relationship, legalRepresentative: values.legalRepresentative }) }), 'Tutor afegit');
  }
  // A new episode with a former guardian: relationship and representation start again (never inherited).
  async function relinkGuardian(participant, g) {
    const values = await formDialog({ title: `Torna a vincular «${g.displayName}»`, confirm: 'Vincula', fields: [
      { name: 'relationship', label: 'Vincle', type: 'select', options: RELATIONSHIP_OPTIONS, value: g.relationship },
      { name: 'legalRepresentative', label: 'Representació legal', type: 'checkbox', checkboxLabel: 'És representant legal (comunicat per la família)' }] });
    if (!values) return;
    await run(() => call(`/api/participants/${participant.id}/guardians`, { method: 'POST', body: JSON.stringify({ guardianId: g.id, relationship: values.relationship, legalRepresentative: values.legalRepresentative }) }), 'Relació represa');
  }
  async function addContact(participant, owner) {
    const values = await formDialog({ title: 'Afegeix un contacte', confirm: 'Afegeix', fields: [
      { name: 'kind', label: 'Tipus', type: 'select', options: [{ value: 'PHONE', label: 'Telèfon' }, { value: 'EMAIL', label: 'Correu' }], value: 'PHONE' },
      { name: 'value', label: 'Valor', required: true },
      { name: 'purpose', label: 'Finalitat', type: 'select', options: [{ value: 'GENERAL', label: 'General' }, { value: 'NOTIFICATIONS', label: 'Notificacions' }], value: 'GENERAL' }] });
    if (!values) return;
    const body = { ...owner, kind: values.kind, value: values.value, purpose: values.purpose };
    await run(() => call(`/api/participants/${participant.id}/contacts`, { method: 'POST', body: JSON.stringify(body) }), 'Contacte afegit', { onRequested: requested });
  }
  async function endContact(participant, ct) {
    if (!await confirmDialog({ title: 'Retirar el contacte?', body: 'El contacte deixarà d’estar vigent. Es conserva l’historial.', confirm: 'Retira', tone: 'danger' })) return;
    await run(() => call(`/api/participants/${participant.id}/contacts/${ct.id}`, { method: 'DELETE' }), 'Contacte retirat', { onRequested: requested });
  }
  async function endRelationship(participant, g) {
    if (!await confirmDialog({ title: 'Finalitzar la relació?', body: `La relació amb «${g.displayName}» deixarà d’estar vigent. Es conserva l’historial.`, confirm: 'Finalitza', tone: 'danger' })) return;
    await run(() => call(`/api/participants/${participant.id}/guardians/${g.id}`, { method: 'DELETE' }), 'Relació finalitzada');
  }
  async function setRepresentation(participant, g, on) {
    if (!await confirmDialog({ title: on ? 'Marca com a representant legal?' : 'Treure la representació legal?',
      body: on ? 'Quedarà registrat com a comunicat per la família i s’obrirà una revisió per a Secretaria.' : 'Es registra el canvi i s’obri una revisió per a Secretaria.', confirm: on ? 'Marca' : 'Treu', tone: 'strong' })) return;
    await run(() => call(`/api/participants/${participant.id}/guardians/${g.id}/representation`, { method: 'POST', body: JSON.stringify({ legalRepresentative: on }) }), 'Canvi registrat');
  }
  async function accredit(participant, g) {
    if (!await confirmDialog({ title: 'Marca com a acreditada?', body: 'Confirmes que has vist un document que acredita la representació legal. No és una verificació jurídica.', confirm: 'Acredita', tone: 'primary' })) return;
    await run(() => call(`/api/participants/${participant.id}/guardians/${g.id}/accredit`, { method: 'POST', body: JSON.stringify({}) }), 'Representació acreditada');
  }
  async function run(request, success, { onRequested } = {}) {
    try {
      const result = await request();
      if (result?.requested && onRequested) { onRequested(); return; }
      toast(success); refresh();
    } catch (error) { if (error.status !== 401) toast(errorCopy(error.code)); }
  }

  return { render, clear() { token++; cache = null; }, markStale() { if (cache) cache.stale = true; }, current: () => activityId };
}
