// Nou participant (guided, progressive) and Editar (3.5E §14). A large drawer on desktop, a
// full-screen sheet on mobile (drawer CSS from activities.css). Creating a provisional record is
// allowed (the birth date may be left empty). Duplicate matches in scope are shown before creating;
// nothing is merged automatically. Guardians and contacts join this flow in batch 4.
import { afterMotion, confirmDialog, h, icon, trapTab } from '../../ui.js';
import { PROVENANCE_OPTIONS, SECTION_LABELS, findDuplicates, manageableSections, validateEditor } from './model.js';

const STALE_MESSAGE = 'Esta fitxa ha canviat mentre l’editaves. Actualitza-la abans de guardar.';
const ERROR_COPY = {
  invalid_participant: 'Revisa els camps marcats.', forbidden: 'No tens permís per a fer aquest canvi.',
  stale_participant: STALE_MESSAGE, not_found: 'No tens accés a aquest participant o ja no existeix.'
};
const errorCopy = code => ERROR_COPY[code] ?? 'No s’ha pogut completar l’acció. Torna-ho a provar.';

/**
 * @param {{call, caps:()=>any, sectionIds:()=>Record<string,string>, rows:()=>any[],
 *   onCreated:(r)=>void, onSaved:(id)=>void, reload:(id)=>Promise<any>}} options
 */
export function createParticipantEditor({ call, caps, sectionIds, rows, onCreated, onSaved, reload }) {
  let state = null;

  function open({ participant = null, trigger = document.activeElement } = {}) {
    close({ immediate: true });
    const mode = participant ? 'edit' : 'create';
    const manageable = manageableSections(caps());
    const values = {
      name: participant?.displayName ?? '',
      birthDate: participant?.birthDate ?? '',
      sectionCode: mode === 'create' && manageable.length === 1 ? manageable[0] : '',
      provenance: participant?.provenance ?? '', provenanceNote: participant?.provenanceNote ?? ''
    };
    const touched = new Set();
    let submitting = false;
    const ids = {};

    const errorNode = key => h('p', { className: 'field-error', attrs: { id: `p-${key}-error`, hidden: true } });
    function field(key, control, { label, required = false, hint = null } = {}) {
      ids[key] = control;
      control.addEventListener('input', () => { values[key === 'audience' ? 'sectionCode' : key] = control.value; if (touched.has(key)) validate(); });
      control.addEventListener('blur', () => { touched.add(key); validate(); });
      return h('div', { className: 'form-field', dataset: { field: key } },
        h('label', { className: 'field-label', attrs: { for: `p-${key}` } }, label, required ? h('span', { className: 'field-required', text: ' · obligatori' }) : null),
        control, hint ? h('p', { className: 'field-hint', text: hint }) : null, errorNode(key));
    }
    const nameInput = h('input', { attrs: { id: 'p-name', type: 'text', maxlength: '120', autocomplete: 'off', value: values.name } });
    const birthInput = h('input', { attrs: { id: 'p-birthDate', type: 'date', value: values.birthDate } });
    const noteInput = h('input', { attrs: { id: 'p-provenanceNote', type: 'text', maxlength: '200', autocomplete: 'off', value: values.provenanceNote } });

    // Section: chips among the sections the user manages (create only; fixed text for a single one).
    const sectionBox = h('div', { className: 'chip-group', attrs: { role: 'radiogroup', 'aria-label': 'Secció' } });
    function renderSections() {
      sectionBox.replaceChildren(...manageable.map(code => {
        const radio = h('input', { attrs: { type: 'radio', name: 'p-section', value: code, id: `p-section-${code}` } });
        radio.checked = values.sectionCode === code;
        radio.addEventListener('change', () => { values.sectionCode = code; touched.add('audience'); validate(); });
        return h('label', { className: 'chip', attrs: { for: `p-section-${code}` } }, radio, h('span', { text: SECTION_LABELS[code] }));
      }));
    }
    renderSections();

    // Duplicate hint (create): in-scope matches by name.
    const duplicates = h('div', { className: 'duplicate-hint', attrs: { hidden: true } });
    function refreshDuplicates() {
      if (mode !== 'create') return;
      const matches = findDuplicates(rows() ?? [], nameInput.value, birthInput.value).slice(0, 4);
      duplicates.hidden = !matches.length;
      if (!matches.length) return;
      duplicates.replaceChildren(
        h('p', { className: 'duplicate-title', text: matches.length === 1 ? 'Ja hi ha un participant amb aquest nom:' : 'Ja hi ha participants amb aquest nom:' }),
        h('ul', { className: 'duplicate-list' }, matches.map(match => h('li', {},
          h('a', { className: 'link-button', attrs: { href: `#/participants/${match.id}` }, text: `Obre ${match.display_name}`,
            on: { click: () => close() } })))),
        h('p', { className: 'field-hint', text: 'Comprova que no siga la mateixa persona abans de crear-ne una de nova.' }));
    }
    nameInput.addEventListener('input', refreshDuplicates);
    birthInput.addEventListener('input', refreshDuplicates);

    const provenanceSelect = h('select', { attrs: { id: 'p-provenance' } }, PROVENANCE_OPTIONS.map(o =>
      h('option', { text: o.label, attrs: { value: o.value, selected: o.value === values.provenance } })));
    provenanceSelect.addEventListener('change', () => { values.provenance = provenanceSelect.value; noteField.hidden = provenanceSelect.value !== 'ALTRES'; });
    const noteField = field('provenanceNote', noteInput, { label: 'Nota de procedència' });
    noteField.hidden = values.provenance !== 'ALTRES';

    const banner = h('div', { className: 'conflict-banner', attrs: { role: 'alert', hidden: true, tabindex: '-1' } });
    const form = h('form', { className: 'editor-form', attrs: { novalidate: true, id: 'participantEditorForm' } },
      banner,
      h('section', { className: 'form-section' }, h('h3', { className: 'form-section-title', text: 'Identitat' }),
        field('name', nameInput, { label: 'Nom', required: true }),
        mode === 'create' ? duplicates : null,
        field('birthDate', birthInput, { label: 'Data de naixement', hint: mode === 'create' ? 'Opcional ara: pots crear una fitxa provisional i completar-la després.' : null })),
      mode === 'create' ? h('section', { className: 'form-section', dataset: { field: 'audience' } },
        h('h3', { className: 'form-section-title', text: 'Secció' }),
        manageable.length === 1 ? h('p', { className: 'field-fixed', text: SECTION_LABELS[manageable[0]] }) : sectionBox,
        errorNode('audience')) : null,
      h('section', { className: 'form-section' }, h('h3', { className: 'form-section-title', text: 'Procedència' }),
        h('div', { className: 'form-field' }, h('label', { className: 'field-label', attrs: { for: 'p-provenance' }, text: 'D’on surt aquesta informació' }), provenanceSelect),
        noteField));

    function validate({ all = false } = {}) {
      const result = validateEditor(values, { mode, sectionIds: sectionIds() });
      for (const key of ['name', 'birthDate', 'provenanceNote', 'audience']) {
        const show = (all || touched.has(key)) && result.errors[key];
        const node = form.querySelector(`#p-${key}-error`);
        if (node) { node.hidden = !show; node.textContent = show ? result.errors[key] : ''; }
        const control = ids[key] ?? form.querySelector(`#p-${key}`);
        if (control) { if (show) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid'); }
        form.querySelector(`[data-field="${key}"]`)?.classList.toggle('field-invalid', !!show);
      }
      return result;
    }

    const title = mode === 'create' ? 'Nou participant' : 'Editar participant';
    const primary = h('button', { className: 'btn btn-primary', text: mode === 'create' ? 'Crea el participant' : 'Guardar canvis', attrs: { type: 'submit', form: 'participantEditorForm' } });
    const drawer = h('aside', { className: 'drawer', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'participantEditorTitle' } },
      h('header', { className: 'drawer-header' },
        h('button', { className: 'link-button drawer-cancel-mobile', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => requestClose() } }),
        h('h2', { className: 'drawer-title', text: title, attrs: { id: 'participantEditorTitle' } }),
        h('button', { className: 'btn btn-quiet btn-icon drawer-close', attrs: { type: 'button', 'aria-label': 'Tanca (Esc)' }, on: { click: () => requestClose() } }, icon('close'))),
      h('div', { className: 'drawer-body' }, form),
      h('footer', { className: 'drawer-footer' },
        h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => requestClose() } }), primary));
    const layer = h('div', { className: 'drawer-layer' }, drawer);
    layer.addEventListener('mousedown', event => { if (event.target === layer) requestClose(); });
    const onKey = event => {
      if (!document.body.contains(layer) || document.querySelector('.dialog-layer')) return;
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); } else trapTab(drawer, event);
    };
    document.addEventListener('keydown', onKey);
    document.body.append(layer);
    document.body.classList.add('drawer-open');
    validate();
    nameInput.focus();

    const dirty = () => values.name.trim() !== (participant?.displayName ?? '') || values.birthDate !== (participant?.birthDate ?? '') ||
      values.sectionCode !== (mode === 'create' && manageable.length === 1 ? manageable[0] : '') ||
      values.provenance !== (participant?.provenance ?? '') || values.provenanceNote !== (participant?.provenanceNote ?? '');
    async function requestClose() {
      if (submitting) return;
      if (dirty() && !await confirmDialog({ title: 'Vols descartar els canvis?', body: 'Els canvis que has fet es perdran.', confirm: 'Descarta', tone: 'danger', cancel: 'Continua editant' })) return;
      close();
    }
    function showBanner(text, { reloadable = false } = {}) {
      banner.hidden = false;
      banner.replaceChildren(h('p', { text }), reloadable ? h('button', { className: 'btn btn-secondary', text: 'Torna a carregar', attrs: { type: 'button' },
        on: { click: async () => { const fresh = await reload(participant.id).catch(() => null); if (fresh) open({ participant: fresh, trigger }); } } }) : null);
      banner.focus?.();
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting) return;
      const result = validate({ all: true });
      if (!result.valid) { (form.querySelector('[aria-invalid="true"]') ?? nameInput).focus(); return; }
      submitting = true; primary.setAttribute('aria-busy', 'true'); primary.disabled = true; banner.hidden = true;
      try {
        if (mode === 'create') {
          const created = await call('/api/participants', { method: 'POST', body: JSON.stringify(result.body) });
          close({ restoreFocus: false });
          onCreated(created);
        } else {
          await call(`/api/participants/${participant.id}`, { method: 'PATCH', body: JSON.stringify({ ...result.body, expectedVersion: participant.version }) });
          close();
          onSaved(participant.id);
        }
      } catch (error) {
        if (error.status === 401) { close({ immediate: true }); return; }
        showBanner(errorCopy(error.code), { reloadable: error.code === 'stale_participant' });
      } finally { submitting = false; primary.removeAttribute('aria-busy'); primary.disabled = false; }
    });
    state = { layer, drawer, trigger, onKey };
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
  return { open, close, isOpen: () => !!state };
}
