// Nova activitat / Editar (ACTIVITIES.md §9): a large drawer on desktop and compact, a full-screen sheet
// on mobile. Progressive disclosure over the real backend contract only; creation always yields a DRAFT.
// Edits carry the version the user opened (optimistic concurrency): a stale save is never retried and
// the user's input is kept.
import { afterMotion, confirmDialog, h, icon, trapTab } from '../../ui.js';
import { LOCKED_FIELDS, LOCKED_MESSAGE, MAX_CENTS, SECTION_LABELS, STALE_MESSAGE, editorValues, errorCopy, formatMoney,
  manageableSections, parseEuros, sectionCodes, validateEditor } from './model.js';

const FIELD_LABELS = { name: 'Nom', audience: 'Per a qui', startsAt: 'Inici', endsAt: 'Final', deadline: 'Termini d’inscripció',
  location: 'Lloc', price: 'Preu', transportSupplement: 'Suplement transport del grup', shortDescription: 'Descripció breu',
  materials: 'Material', specialNotice: 'Avís especial' };
const COUNTED = { name: 120, location: 160, shortDescription: 600, materials: 400, specialNotice: 400 };

/**
 * @param {{call: Function, caps: () => any, sectionIds: () => Record<string, string>,
 *   onCreated: (result: {id: string}) => void, onSaved: (id: string) => void, reload: (id: string) => Promise<any>}} options
 */
export function createEditor({ call, caps, sectionIds, onCreated, onSaved, reload }) {
  let state = null;

  function open({ activity = null, trigger = document.activeElement, keep = null } = {}) {
    close({ immediate: true });
    const capabilities = caps();
    const mode = activity ? 'edit' : 'create';
    const locked = mode === 'edit' && !!activity.termsLocked;
    const manageable = manageableSections(capabilities);
    const canGeneral = !!capabilities.activities.manageGeneral;
    const initial = editorValues(activity);
    if (mode === 'create') initial.audience = canGeneral && !manageable.length ? 'GENERAL' : manageable.length ? 'SECTIONS' : '';
    if (mode === 'create' && manageable.length === 1) initial.sections = [...manageable];
    const values = { ...initial };
    const touched = new Set();
    const ids = {};
    let submitting = false;

    // ---- field builders
    const errorNode = key => h('p', { className: 'field-error', attrs: { id: `activity-${key}-error`, hidden: true } });
    const noteNode = key => h('p', { className: 'field-note', attrs: { id: `activity-${key}-note`, hidden: true } });
    function input(key, type = 'text', extra = {}) {
      const node = h(type === 'textarea' ? 'textarea' : 'input', { attrs: { id: `activity-${key}`, name: key,
        ...(type === 'textarea' ? { rows: key === 'shortDescription' ? 4 : 3 } : { type }), ...(COUNTED[key] ? { maxlength: COUNTED[key] } : {}), ...extra,
        'aria-describedby': `activity-${key}-error activity-${key}-note` } });
      node.value = values[key] ?? '';
      node.addEventListener('input', () => { values[key] = node.value; refreshCounter(key); if (touched.has(key)) validate(); });
      node.addEventListener('blur', () => { touched.add(key); validate(); });
      ids[key] = node;
      return node;
    }
    const counters = {};
    function counter(key) { counters[key] = h('span', { className: 'field-counter', attrs: { 'aria-live': 'polite' } }); return counters[key]; }
    function refreshCounter(key) {
      const node = counters[key]; if (!node) return;
      const length = String(values[key] ?? '').length, max = COUNTED[key];
      node.textContent = length >= max * 0.8 ? `${length}/${max}` : '';
    }
    const field = (key, control, { required = false, hint = null, extra = null } = {}) => h('div', { className: 'form-field', dataset: { field: key } },
      h('label', { className: 'field-label', attrs: { for: `activity-${key}` } }, FIELD_LABELS[key],
        required ? h('span', { className: 'field-required', text: ' · obligatori' }) : null, COUNTED[key] ? counter(key) : null),
      control, hint ? h('p', { className: 'field-hint', text: hint }) : null, extra, errorNode(key), noteNode(key));

    // ---- Què i qui
    const audienceChoice = (() => {
      const options = [...(canGeneral ? [['GENERAL', 'Tot el grup']] : []), ...(manageable.length ? [['SECTIONS', 'Seccions']] : [])];
      if (mode === 'edit' && !options.some(([value]) => value === values.audience)) options.push([values.audience, values.audience === 'GENERAL' ? 'Tot el grup' : 'Seccions']);
      if (options.length === 1) return h('p', { className: 'field-fixed', text: options[0][1] });
      const radios = options.map(([value, label]) => {
        const radio = h('input', { attrs: { type: 'radio', name: 'activity-audience', value, id: `activity-audience-${value}` } });
        radio.checked = values.audience === value;
        radio.addEventListener('change', () => { values.audience = value; renderSections(); touched.add('audience'); validate(); });
        return h('label', { className: 'choice', attrs: { for: `activity-audience-${value}` } }, radio, h('span', { text: label }));
      });
      return h('div', { className: 'choice-group', attrs: { role: 'radiogroup', 'aria-labelledby': 'activity-audience-label', id: 'activity-audience' } }, radios);
    })();
    const sectionsBox = h('div', { className: 'chip-group', attrs: { role: 'group', 'aria-label': 'Seccions' } });
    function renderSections() {
      const available = mode === 'edit' ? [...new Set([...manageable, ...values.sections])] : manageable;
      sectionsBox.hidden = values.audience !== 'SECTIONS';
      sectionsBox.replaceChildren(...available.map(code => {
        const box = h('input', { attrs: { type: 'checkbox', value: code, id: `activity-section-${code}` } });
        box.checked = values.sections.includes(code);
        box.disabled = locked || !manageable.includes(code);
        box.addEventListener('change', () => {
          values.sections = box.checked ? [...values.sections, code] : values.sections.filter(item => item !== code);
          touched.add('audience'); validate();
        });
        return h('label', { className: 'chip', attrs: { for: `activity-section-${code}` } }, box, h('span', { text: SECTION_LABELS[code] }));
      }));
    }
    renderSections();
    const audienceField = h('div', { className: 'form-field', dataset: { field: 'audience' } },
      h('span', { className: 'field-label', attrs: { id: 'activity-audience-label' } }, 'Per a qui', h('span', { className: 'field-required', text: ' · obligatori' })),
      audienceChoice, sectionsBox, errorNode('audience'), noteNode('audience'));

    // ---- Preu + transport
    const paidRadios = [['free', 'Gratuïta'], ['paid', 'De pagament']].map(([value, label]) => {
      const radio = h('input', { attrs: { type: 'radio', name: 'activity-paid', value, id: `activity-paid-${value}` } });
      radio.checked = (value === 'paid') === values.paid;
      radio.addEventListener('change', () => { values.paid = value === 'paid'; priceWrap.hidden = !values.paid; touched.add('price'); validate(); });
      return h('label', { className: 'choice', attrs: { for: `activity-paid-${value}` } }, radio, h('span', { text: label }));
    });
    const priceInput = input('price', 'text', { inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off' });
    const priceWrap = h('div', { className: 'money-field' }, priceInput, h('span', { className: 'money-suffix', text: '€' }));
    priceWrap.hidden = !values.paid;
    const supplementInput = input('transportSupplement', 'text', { inputmode: 'decimal', autocomplete: 'off' });
    const transportToggle = h('button', { className: 'disclosure', attrs: { type: 'button', 'aria-expanded': String(values.transport), 'aria-controls': 'activity-transport-panel' } },
      icon('chevron-right', 'disclosure-icon'), h('span', { text: 'Transport organitzat pel grup' }));
    const transportPanel = h('div', { className: 'disclosure-panel', attrs: { id: 'activity-transport-panel' } },
      h('p', { className: 'field-hint', text: 'Les famílies triaran entre el transport del grup i el transport per compte seu.' }),
      field('transportSupplement', h('div', { className: 'money-field' }, supplementInput, h('span', { className: 'money-suffix', text: '€' })),
        { hint: 'Pot ser negatiu si el transport del grup té descompte.' }),
      h('p', { className: 'fixed-fact' }, h('span', { text: 'Transport per compte de la família' }), h('strong', { text: 'sense cost per al grup (0 €)' })));
    transportPanel.hidden = !values.transport;
    transportToggle.addEventListener('click', () => {
      if (locked) return;
      values.transport = !values.transport;
      transportToggle.setAttribute('aria-expanded', String(values.transport)); transportPanel.hidden = !values.transport;
      if (values.transport) supplementInput.focus();
      touched.add('transportSupplement'); validate();
    });

    // ---- Informació per a les famílies (collapsed by default unless it already has content)
    const hasInfo = !!(values.shortDescription || values.materials || values.specialNotice);
    const infoToggle = h('button', { className: 'disclosure', attrs: { type: 'button', 'aria-expanded': String(hasInfo), 'aria-controls': 'activity-info-panel' } },
      icon('chevron-right', 'disclosure-icon'), h('span', { text: 'Afegeix informació per a les famílies (opcional)' }));
    const infoPanel = h('div', { className: 'disclosure-panel', attrs: { id: 'activity-info-panel' } },
      field('shortDescription', input('shortDescription', 'textarea')), field('materials', input('materials', 'textarea')),
      field('specialNotice', input('specialNotice', 'textarea')));
    infoPanel.hidden = !hasInfo;
    infoToggle.addEventListener('click', () => {
      const openNow = infoPanel.hidden; infoPanel.hidden = !openNow; infoToggle.setAttribute('aria-expanded', String(openNow));
      if (openNow) ids.shortDescription.focus();
    });

    const lockNotice = locked ? h('p', { className: 'form-notice', attrs: { role: 'note' }, text: LOCKED_MESSAGE }) : null;
    const banner = h('div', { className: 'conflict-banner', attrs: { role: 'alert', hidden: true } });
    const form = h('form', { className: 'editor-form', attrs: { novalidate: true, id: 'activityEditorForm' } },
      banner, lockNotice,
      h('section', { className: 'form-section', attrs: { 'aria-labelledby': 'form-section-what' } },
        h('h3', { className: 'form-section-title', text: 'Què i qui', attrs: { id: 'form-section-what' } }),
        field('name', input('name', 'text', { autocomplete: 'off' }), { required: true }), audienceField),
      h('section', { className: 'form-section', attrs: { 'aria-labelledby': 'form-section-when' } },
        h('h3', { className: 'form-section-title', text: 'Quan i on', attrs: { id: 'form-section-when' } }),
        h('div', { className: 'field-row' }, field('startsAt', input('startsAt', 'datetime-local'), { required: true }),
          field('endsAt', input('endsAt', 'datetime-local'), { required: true })),
        field('deadline', input('deadline', 'datetime-local'), { required: true }),
        field('location', input('location', 'text', { autocomplete: 'off' }), { required: true })),
      h('section', { className: 'form-section', attrs: { 'aria-labelledby': 'form-section-price' } },
        h('h3', { className: 'form-section-title', text: 'Preu', attrs: { id: 'form-section-price' } }),
        h('div', { className: 'form-field', dataset: { field: 'price' } },
          h('div', { className: 'choice-group', attrs: { role: 'radiogroup', 'aria-label': 'Preu' } }, paidRadios),
          h('label', { className: 'visually-hidden', attrs: { for: 'activity-price' }, text: 'Preu en euros' }),
          priceWrap, errorNode('price'), noteNode('price')),
        transportToggle, transportPanel),
      h('section', { className: 'form-section' }, infoToggle, infoPanel));
    if (keep) form.prepend(yourChanges(keep));
    if (locked) for (const key of LOCKED_FIELDS) {
      if (ids[key]) ids[key].disabled = true;
      form.querySelector(`[data-field="${key}"]`)?.classList.add('field-locked');
    }
    if (locked) {
      for (const radio of form.querySelectorAll('input[type="radio"]')) radio.disabled = true;
      transportToggle.disabled = true;
    }

    // ---- validation
    function validate({ all = false } = {}) {
      const result = validateEditor(values, { sectionIds: sectionIds() });
      for (const key of Object.keys(FIELD_LABELS)) {
        const show = (all || touched.has(key)) && result.errors[key];
        const error = form.querySelector(`#activity-${key}-error`), note = form.querySelector(`#activity-${key}-note`);
        if (error) { error.hidden = !show; error.textContent = show ? result.errors[key] : ''; }
        if (note) { const text = result.notes[key]; note.hidden = !text || !!show; note.textContent = text || ''; }
        const control = ids[key] ?? form.querySelector(`#activity-${key}`);
        if (control) { if (show) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid'); }
        form.querySelector(`[data-field="${key}"]`)?.classList.toggle('field-invalid', !!show);
      }
      if (values.paid) {
        const cents = parseEuros(values.price);
        priceWrap.dataset.preview = cents && cents <= MAX_CENTS ? formatMoney(cents) : '';
      }
      return result;
    }

    // ---- surface
    const title = mode === 'create' ? 'Nova activitat' : 'Editar activitat';
    const primary = h('button', { className: 'btn btn-primary', text: mode === 'create' ? 'Crear esborrany' : 'Guardar canvis', attrs: { type: 'submit', form: 'activityEditorForm' } });
    const cancel = h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => requestClose() } });
    const closeButton = h('button', { className: 'btn btn-quiet btn-icon drawer-close', attrs: { type: 'button', 'aria-label': 'Tanca', title: 'Tanca (Esc)' }, on: { click: () => requestClose() } }, icon('close'));
    const drawer = h('aside', { className: 'drawer', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'activityEditorTitle' } },
      h('header', { className: 'drawer-header' },
        h('button', { className: 'link-button drawer-cancel-mobile', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => requestClose() } }),
        h('h2', { className: 'drawer-title', text: title, attrs: { id: 'activityEditorTitle' } }), closeButton),
      h('div', { className: 'drawer-body' }, form),
      h('footer', { className: 'drawer-footer' }, cancel, primary));
    const layer = h('div', { className: 'drawer-layer' }, drawer);
    layer.addEventListener('mousedown', event => { if (event.target === layer) requestClose(); });
    const onKey = event => {
      if (!document.body.contains(layer) || document.querySelector('.dialog-layer')) return;
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
      else trapTab(drawer, event);
    };
    document.addEventListener('keydown', onKey);
    document.body.append(layer);
    document.body.classList.add('drawer-open');
    for (const key of Object.keys(COUNTED)) refreshCounter(key);
    validate();
    // After a stale reload the user's own text comes first; otherwise the name field.
    if (keep) form.querySelector('.your-changes summary')?.focus(); else ids.name.focus();

    const dirty = () => JSON.stringify(values) !== JSON.stringify(initial);
    async function requestClose() {
      if (submitting) return;
      if (dirty() && !await confirmDialog({ title: 'Vols descartar els canvis?', body: 'Els canvis que has fet en aquesta activitat es perdran.',
        confirm: 'Descarta', tone: 'danger', cancel: 'Continua editant' })) return;
      close();
    }
    function showBanner(text, { reloadable = false } = {}) {
      banner.hidden = false;
      banner.replaceChildren(h('p', { text }), reloadable ? h('button', { className: 'btn btn-secondary', text: 'Torna a carregar', attrs: { type: 'button' },
        on: { click: async () => {
          const snapshot = { ...values };
          const fresh = await reload(activity.id).catch(() => null);
          if (fresh) open({ activity: fresh, trigger, keep: snapshot });
        } } }) : null);
      banner.classList.remove('banner-enter'); void banner.offsetWidth; banner.classList.add('banner-enter');
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting) return;
      const result = validate({ all: true });
      if (!result.valid) {
        const first = Object.keys(FIELD_LABELS).find(key => result.errors[key]);
        (ids[first] ?? form.querySelector(`#activity-${first}`) ?? form.querySelector('#activity-audience input'))?.focus();
        return;
      }
      submitting = true; primary.setAttribute('aria-busy', 'true'); primary.disabled = true; banner.hidden = true;
      try {
        if (mode === 'create') {
          const created = await call('/api/activities', { method: 'POST', body: JSON.stringify(result.body) });
          close({ restoreFocus: false });
          onCreated(created);
        } else {
          await call(`/api/activities/${activity.id}`, { method: 'PATCH', body: JSON.stringify({ ...result.body, expectedVersion: activity.version }) });
          close();
          onSaved(activity.id);
        }
      } catch (error) {
        if (error.status === 401) { close({ immediate: true }); return; }
        const code = error.code;
        if (code === 'stale_activity') showBanner(STALE_MESSAGE, { reloadable: true });
        else if (code === 'activity_terms_locked') showBanner(`${errorCopy(code)}. Torna a carregar l’activitat per a continuar.`, { reloadable: true });
        else showBanner(errorCopy(code));
        banner.focus?.();
      } finally {
        submitting = false; primary.removeAttribute('aria-busy'); primary.disabled = false;
      }
    });
    banner.tabIndex = -1;
    state = { layer, drawer, trigger, onKey };
  }

  function yourChanges(snapshot) {
    const rows = Object.entries(FIELD_LABELS).map(([key, label]) => {
      let value = snapshot[key];
      if (key === 'audience') value = snapshot.audience === 'GENERAL' ? 'Tot el grup' : snapshot.sections.map(code => SECTION_LABELS[code]).join(', ');
      if (key === 'price') value = snapshot.paid ? `${snapshot.price} €` : 'Gratuïta';
      if (key === 'transportSupplement') value = snapshot.transport ? `${snapshot.transportSupplement} €` : '';
      return value ? h('div', { className: 'changes-row' }, h('dt', { text: label }), h('dd', { text: String(value).replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/, '$1 $2') })) : null;
    });
    return h('details', { className: 'your-changes', attrs: { open: true } }, h('summary', { text: 'Els teus canvis (no guardats)' }),
      h('p', { className: 'field-hint', text: 'S’han carregat les dades actuals. Revisa-les i torna a aplicar el que calga.' }), h('dl', {}, rows));
  }

  function close({ immediate = false, restoreFocus = true } = {}) {
    if (!state) return;
    const { layer, trigger, onKey } = state;
    state = null;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('drawer-open');
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    if (immediate) { layer.remove(); return; }
    layer.classList.add('drawer-leaving');
    afterMotion(layer.querySelector('.drawer'), 260).then(() => layer.remove());
  }
  return { open, close, isOpen: () => !!state, sectionCodes };
}
