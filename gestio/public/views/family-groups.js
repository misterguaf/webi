import { fetchAllPages } from '../api.js';

const $ = id => document.getElementById(id);
const item = text => { const li = document.createElement('li'); li.textContent = text; return li; };

export function createFamilyGroupsView({ call, message, reportLoadError }) {
  let roundId = '';
  let selected = [];
  let initialized = false;

  async function loadGroups() {
    if (!roundId) { $('familyGroupsList').replaceChildren(); return; }
    const { groups } = await fetchAllPages(call, `/api/fees/rounds/${roundId}/groups`, 'groups');
    $('familyGroupsList').replaceChildren(...groups.map(row =>
      item(`${row.reference} · ${row.sibling_ordinal}. ${row.display_name}`)));
  }

  async function load() {
    try {
      const { rounds } = await call('/api/fees/family-rounds');
      $('familyGroupsPanel').hidden = false;
      $('familyGroupsRound').replaceChildren(...rounds.map(round => {
        const option = document.createElement('option'); option.value = round.id; option.textContent = round.code; return option;
      }));
      if (!rounds.some(round => round.id === roundId)) roundId = rounds[0]?.id || '';
      $('familyGroupsRound').value = roundId;
      await loadGroups();
    } catch (error) { $('familyGroupsPanel').hidden = true; reportLoadError(error); message(error.message); }
  }

  if (!initialized) {
    initialized = true;
    $('familyGroupsRound').addEventListener('change', () => {
      roundId = $('familyGroupsRound').value; selected = [];
      $('familyGroupsSearchResults').replaceChildren();
      loadGroups().catch(error => message(error.message));
    });
    $('familyGroupsSearchButton').addEventListener('click', async () => {
      try {
        if (!roundId) return;
        const query = $('familyGroupsSearch').value.trim();
        const result = await call(`/api/fees/rounds/${roundId}/participants?search=${encodeURIComponent(query)}`);
        if (result.truncated) message('Hi ha més resultats. Afina la cerca.');
        $('familyGroupsSearchResults').replaceChildren(...result.participants.map(person => {
          const li = item(`${person.display_name} · ${person.section_code} `);
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = selected.includes(person.id) ? 'Seleccionat' : 'Afig en este ordre';
          button.disabled = selected.includes(person.id);
          button.addEventListener('click', () => {
            if (selected.includes(person.id)) return;
            selected.push(person.id); button.disabled = true; button.textContent = `Seleccionat · ${selected.length}`;
          });
          li.append(button); return li;
        }));
      } catch (error) { message(error.message); }
    });
    $('familyGroupsCreate').addEventListener('click', async () => {
      try {
        if (selected.length < 2) { message('Selecciona almenys dos educands.'); return; }
        await call('/api/fees/groups', { method: 'POST', body: JSON.stringify({
          roundId, reference: $('familyGroupsReference').value.trim(), participantIds: selected
        }) });
        selected = []; $('familyGroupsSearchResults').replaceChildren(); $('familyGroupsReference').value = '';
        message('Agrupació familiar guardada.'); await loadGroups();
      } catch (error) { message(error.message); }
    });
  }

  return { id: 'family-groups', page: 'quotes', available: caps => !!caps.fees.readFamily && !caps.fees.read?.all,
    load, unload() { $('familyGroupsPanel').hidden = true; $('familyGroupsList').replaceChildren();
      $('familyGroupsSearchResults').replaceChildren(); selected = []; } };
}
