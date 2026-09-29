// Activitats (legacy UI, unchanged behaviour; the 3.5D redesign replaces this module's rendering).
import { fetchAllPages } from '../api.js';
import { label } from '../labels.js';

const $ = id => document.getElementById(id);
const dateInput = value => { const d = new Date(value), two = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`; };
const dateValue = id => new Date($(id).value).getTime();
const FORM_FIELDS = ['activityName', 'activityAudience', 'activitySections', 'activityLocation', 'activityStart', 'activityEnd',
  'activityDeadline', 'activityPrice', 'activityDescription', 'activityMaterials', 'activityNotice', 'activityTransport', 'activityTransportPrice'];

export function createActivitiesView({ call, post, message, reportLoadError, openRegistrations }) {
  let editing = null;
  async function load() {
    try {
      const data = await fetchAllPages(call, '/api/activities', 'activities'); $('activityPanel').hidden = false;
      $('activityList').replaceChildren(...data.activities.map(activity => {
        const li = document.createElement('li'); li.textContent = `${activity.name} · ${label(activity.status)} · ${activity.audience === 'GENERAL' ? label('GENERAL') : activity.sections} · ${(activity.price_cents / 100).toFixed(2)} € `;
        const edit = document.createElement('button'); edit.textContent = activity.status === 'CLOSED' ? 'Consulta' : 'Edita'; edit.addEventListener('click', () => open(activity.id));
        const registrations = document.createElement('button'); registrations.textContent = 'Inscripcions'; registrations.addEventListener('click', () => openRegistrations(activity.id, false, activity.name));
        li.append(edit, registrations); return li;
      }));
    } catch (error) { $('activityPanel').hidden = true; reportLoadError(error); }
  }
  function setReadOnly(closed) {
    for (const id of FORM_FIELDS) $(id).disabled = closed;
    $('activitySave').hidden = closed;
    $('activityClosedNotice').hidden = !closed;
  }
  async function open(id) {
    try {
      const { activity } = await call(`/api/activities/${id}`); editing = id; $('activityForm').hidden = false;
      const closed = activity.status === 'CLOSED';
      setReadOnly(closed);
      $('activityFormTitle').textContent = `${closed ? 'Consulta' : 'Edita'}: ${activity.name}`;
      $('activityName').value = activity.name; $('activityAudience').value = activity.audience;
      for (const option of $('activitySections').options) option.selected = activity.sectionIds.includes(option.value);
      $('activityLocation').value = activity.location; $('activityStart').value = dateInput(activity.starts_at);
      $('activityEnd').value = dateInput(activity.ends_at); $('activityDeadline').value = dateInput(activity.registration_deadline);
      $('activityPrice').value = activity.price_cents; $('activityDescription').value = activity.short_description;
      $('activityMaterials').value = activity.materials; $('activityNotice').value = activity.special_notice;
      $('activityTransport').checked = activity.transportOptions.length > 0;
      $('activityTransportPrice').value = activity.transportOptions.find(option => option.code === 'GROUP')?.price_adjustment_cents ?? 0;
      $('publishActivity').hidden = activity.status !== 'DRAFT'; $('closeActivity').hidden = activity.status !== 'PUBLISHED';
    } catch (error) { message(error.message); }
  }
  function unload() { $('activityPanel').hidden = true; $('activityForm').hidden = true; $('activityForm').reset(); editing = null; }

  $('newActivity').addEventListener('click', () => {
    editing = null; $('activityForm').reset(); $('activityForm').hidden = false;
    setReadOnly(false);
    $('activityFormTitle').textContent = 'Activitat nova'; $('publishActivity').hidden = true; $('closeActivity').hidden = true;
    $('activityForm').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    $('activityName').focus({ preventScroll: true });
  });
  $('reloadActivities').addEventListener('click', load);
  $('activityForm').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('activitySave').hidden) return;
    const body = { name: $('activityName').value, audience: $('activityAudience').value,
      sectionIds: $('activityAudience').value === 'GENERAL' ? [] : [...$('activitySections').selectedOptions].map(option => option.value),
      location: $('activityLocation').value, startsAt: dateValue('activityStart'), endsAt: dateValue('activityEnd'),
      registrationDeadline: dateValue('activityDeadline'), priceCents: Number($('activityPrice').value),
      shortDescription: $('activityDescription').value, materials: $('activityMaterials').value, specialNotice: $('activityNotice').value,
      transportOptions: $('activityTransport').checked ? [{ code: 'GROUP', adjustmentCents: Number($('activityTransportPrice').value) },
        { code: 'FAMILY', adjustmentCents: 0 }] : [] };
    try {
      const result = await call(editing ? `/api/activities/${editing}` : '/api/activities',
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      editing = result.id; message('Activitat guardada.'); await load(); await open(result.id);
    } catch (error) { message(error.message); }
  });
  for (const [button, action] of [['publishActivity', 'publish'], ['closeActivity', 'close']]) {
    $(button).addEventListener('click', async () => { if (!editing) return; try {
      await post(`/api/activities/${editing}/${action}`); message('Estat actualitzat.'); await load(); await open(editing);
    } catch (error) { message(error.message); } });
  }

  return { id: 'activities', page: 'activitats',
    available: caps => !!(caps.activities.read || caps.activities.manage || caps.activities.manageGeneral),
    load, unload, open };
}
