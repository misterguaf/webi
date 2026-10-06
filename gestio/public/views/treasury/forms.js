// Tresoreria (3.5G.2A) — drawers and pickers: the generic drawer with busy state and inline errors, the
// budget line tree picker, the Total / Distribuït / Pendent line split and the counterparty choice.
import { afterMotion, formDialog, h, icon, toast, trackOverlay, trapTab } from '../../ui.js';
import { COUNTERPARTY_KIND, budgetPath, budgetTree, centsInput, errorCopy, filterTree, formatEur, splitState } from './model.js';

let drawerSeq = 0;
/**
 * A right-hand drawer (full-screen sheet on mobile) with one primary action. `onSubmit` returns true to
 * close; a thrown error is shown inline with human copy. The primary button is busy while submitting,
 * so a double click never sends twice.
 * @param {{title: string, content: Node[], primary: string, tone?: string, onSubmit: () => Promise<boolean>}} options
 */
export function openDrawer({ title, content, primary, tone = 'primary', onSubmit }) {
  const previous = document.activeElement, titleId = `treasuryDrawer${++drawerSeq}`;
  const error = h('p', { className: 'field-error drawer-error', attrs: { role: 'alert', hidden: true } });
  const cancel = h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => close() } });
  const submit = h('button', { className: `btn btn-${tone}`, text: primary, attrs: { type: 'submit', form: `${titleId}Form` } });
  const form = h('form', { className: 'editor-form treasury-form', attrs: { id: `${titleId}Form`, novalidate: true }, on: { submit: event => { event.preventDefault(); void run(); } } }, content);
  // An edited field drops its stale error; the footer message goes with it.
  const clearField = event => {
    const wrap = event.target.closest?.('[data-field]');
    if (wrap) { wrap.classList.remove('field-invalid'); const slot = wrap.querySelector(':scope > .field-error'); if (slot) slot.hidden = true; }
    error.hidden = true;
  };
  form.addEventListener('input', clearField); form.addEventListener('change', clearField);
  const drawer = h('aside', { className: 'drawer', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } },
    h('header', { className: 'drawer-header' },
      h('button', { className: 'link-button drawer-cancel-mobile', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => close() } }),
      h('h2', { className: 'drawer-title', text: title, attrs: { id: titleId } }),
      h('button', { className: 'btn btn-quiet btn-icon drawer-close', attrs: { type: 'button', 'aria-label': 'Tanca', title: 'Tanca (Esc)' }, on: { click: () => close() } }, icon('close'))),
    h('div', { className: 'drawer-body' }, form),
    h('footer', { className: 'drawer-footer' }, error, cancel, submit));
  const layer = h('div', { className: 'drawer-layer' }, drawer);
  let busy = false, closed = false;
  const onKey = event => {
    if (document.querySelector('.dialog-layer')) return;
    if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); } else trapTab(drawer, event);
  };
  async function run() {
    if (busy) return;
    busy = true; submit.setAttribute('aria-busy', 'true'); submit.disabled = true; error.hidden = true;
    try { if (await onSubmit()) close(); }
    catch (cause) { showError(errorCopy(cause)); }
    finally { busy = false; submit.removeAttribute('aria-busy'); submit.disabled = false; }
  }
  function showError(text) { error.textContent = text; error.hidden = false; }
  const untrack = trackOverlay(() => close());
  function close() {
    if (closed) return;
    closed = true;
    untrack();
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('drawer-open');
    layer.classList.add('drawer-leaving');
    afterMotion(drawer, 260).then(() => layer.remove());
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('drawer-open');
  document.body.append(layer);
  requestAnimationFrame(() => (form.querySelector('input,select,button') ?? submit).focus());
  return { close, showError, submit };
}

/** A labelled field: label, control, optional hint and an error slot keyed by `name`. */
export function field(name, label, control, { hint = null, required = false } = {}) {
  const id = control.id || `tf-${name}-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { className: 'form-field', dataset: { field: name } },
    h('label', { className: 'field-label', attrs: { for: id } }, label, required ? h('span', { className: 'field-required', text: ' · obligatori' }) : null),
    control, hint ? h('p', { className: 'field-hint', text: hint }) : null,
    h('p', { className: 'field-error', attrs: { hidden: true } }));
}
/** Show per-field errors ({name: message}); returns true when there are none. */
export function showErrors(container, errors) {
  for (const wrap of container.querySelectorAll('[data-field]')) {
    const slot = wrap.querySelector(':scope > .field-error'), message = errors[wrap.dataset.field];
    if (!slot) continue;
    slot.hidden = !message; slot.textContent = message ?? '';
    wrap.classList.toggle('field-invalid', !!message);
  }
  const first = Object.keys(errors)[0];
  if (first) container.querySelector(`[data-field="${first}"] :is(input,select,button)`)?.focus();
  return !first;
}
export const moneyInput = (value = '', attrs = {}) => h('div', { className: 'money-field' },
  h('input', { attrs: { type: 'text', inputmode: 'decimal', autocomplete: 'off', value, ...attrs } }), h('span', { className: 'money-suffix', text: '€', attrs: { 'aria-hidden': 'true' } }));

// ---------------------------------------------------------------- budget line picker

/**
 * Hierarchical picker: headings are shown for orientation and only active assignable leaves can be
 * chosen (the lines endpoint already returns only active lines of the requested nature).
 * @returns {Promise<{id, code, name, path}|null>}
 */
export function pickBudgetLine({ lines, title = 'Tria una línia del pressupost', selected = null }) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const tree = budgetTree(lines);
    const search = h('input', { attrs: { type: 'search', placeholder: 'Busca per codi o nom', 'aria-label': 'Busca una línia', autocomplete: 'off' } });
    const list = h('div', { className: 'tree-list', attrs: { role: 'listbox', 'aria-label': title } });
    const render = () => {
      const shown = filterTree(tree, search.value);
      list.replaceChildren(...shown.map(node => node.assignable
        ? h('button', { className: `tree-leaf tree-depth-${Math.min(node.depth, 4)}`, attrs: { type: 'button', role: 'option', 'aria-selected': String(node.id === selected) },
          on: { click: () => close({ id: node.id, code: node.code, name: node.name, path: node.path }) } },
          h('span', { className: 'tree-code', text: node.code }), h('span', { text: node.name }))
        : h('div', { className: `tree-heading tree-depth-${Math.min(node.depth, 4)}`, attrs: { role: 'presentation' } },
          h('span', { className: 'tree-code', text: node.code }), h('span', { text: node.name }))));
      if (!shown.length) list.append(h('p', { className: 'empty-detail', text: 'Cap línia coincideix amb la cerca.' }));
    };
    search.addEventListener('input', render);
    const dialog = h('div', { className: 'dialog tree-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
      h('h2', { className: 'dialog-title', text: title }), search, list,
      h('div', { className: 'dialog-actions' }, h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => close(null) } })));
    const layer = h('div', { className: 'dialog-layer', on: { mousedown: event => { if (event.target === layer) close(null); } } }, dialog);
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(null); } else trapTab(dialog, event); };
    const untrack = trackOverlay(() => close(null));
    function close(result) {
      untrack();
      document.removeEventListener('keydown', onKey, true);
      layer.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(result);
    }
    render();
    document.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    search.focus();
  });
}

/** A button that shows the chosen line's path and opens the picker. */
export function budgetLineButton({ lines, value = null, label = null, onChange, emptyText = 'Tria una línia' }) {
  let current = value ? { id: value, path: label?.path ?? null, name: label?.name ?? '' } : null;
  const text = h('span', { className: 'line-button-text' });
  const node = h('button', { className: 'btn btn-secondary line-button', attrs: { type: 'button' }, on: { click: async () => {
    const picked = await pickBudgetLine({ lines, selected: current?.id });
    if (picked) { current = picked; paint(); onChange?.(picked); }
  } } }, text, icon('chevron'));
  const paint = () => { text.textContent = current ? budgetPath(current) : emptyText; node.classList.toggle('line-button-empty', !current); };
  paint();
  return { node, get value() { return current?.id ?? null; } };
}

// ---------------------------------------------------------------- line split

/**
 * Split editor for expense lines. `total()` gives the amount to distribute (cents). Shows Total /
 * Distribuït / Pendent live; the caller blocks confirmation until it balances.
 */
export function lineSplit({ lines, total, initial = [] }) {
  const rows = [];
  const body = h('div', { className: 'split-rows' });
  const facts = h('div', { className: 'split-facts', attrs: { 'aria-live': 'polite' } });
  const add = (start = {}) => {
    const amount = moneyInput(start.amount ?? '', { 'aria-label': 'Import de la línia' });
    const picker = budgetLineButton({ lines, value: start.budgetLineId ?? null, label: start.label ?? null, onChange: () => refresh() });
    const row = { picker, amount: amount.querySelector('input') };
    const remove = h('button', { className: 'btn btn-quiet btn-icon', attrs: { type: 'button', 'aria-label': 'Elimina la línia', title: 'Elimina la línia' },
      on: { click: () => { rows.splice(rows.indexOf(row), 1); row.node.remove(); refresh(); } } }, icon('close'));
    row.node = h('div', { className: 'split-row' }, picker.node, amount, remove);
    row.amount.addEventListener('input', () => refresh());
    rows.push(row); body.append(row.node); refresh();
    return row;
  };
  const fillPending = h('button', { className: 'link-button', text: 'Assigna el pendent a l’última línia', attrs: { type: 'button' }, on: { click: () => {
    const state = current(); const last = rows.at(-1);
    if (!last || state.pending <= 0) return;
    const now = splitState(0, [{ budgetLineId: 'x', amount: last.amount.value }]).distributed;
    last.amount.value = centsInput(now + state.pending); refresh();
  } } });
  const values = () => rows.map(row => ({ budgetLineId: row.picker.value, amount: row.amount.value }));
  const current = () => splitState(total(), values());
  function refresh() {
    const state = current();
    facts.replaceChildren(
      fact('Total', formatEur(state.total)), fact('Distribuït', formatEur(state.distributed)),
      fact('Pendent', formatEur(state.pending), state.balanced ? 'split-balanced' : state.pending !== 0 ? 'split-pending' : ''));
    fillPending.hidden = !(state.pending > 0 && rows.length);
    const wrap = facts.closest('[data-field]');
    if (wrap && state.balanced) { wrap.classList.remove('field-invalid'); const slot = wrap.querySelector(':scope > .field-error'); if (slot) slot.hidden = true; }
  }
  const node = h('div', { className: 'line-split' }, facts, body,
    h('div', { className: 'split-actions' },
      h('button', { className: 'btn btn-secondary btn-small', attrs: { type: 'button' }, on: { click: () => add().picker.node.focus() } }, icon('plus'), 'Afig línia'),
      fillPending));
  for (const start of initial.length ? initial : [{}]) add(start);
  return { node, values, refresh, state: current };
}
const fact = (label, value, className = '') => h('div', { className: `split-fact ${className}` }, h('span', { className: 'fact-label', text: label }), h('span', { className: 'split-value', text: value }));

// ---------------------------------------------------------------- counterparties

/** Select an existing counterparty or create a minimal one (kind + name; no IBAN, no CRM data). */
export function counterpartyChooser({ call, counterparties, value = '', allowCreate, kind = null, label = 'Tercer', optional = true, name = 'counterpartyId' }) {
  let list = counterparties;
  const select = h('select');
  const paint = selected => {
    const options = list.filter(row => row.status === 'ACTIVE' && (!kind || row.kind === kind));
    select.replaceChildren(h('option', { text: optional ? 'Sense tercer' : 'Tria…', attrs: { value: '' } }),
      ...options.map(row => h('option', { text: `${row.displayName} · ${COUNTERPARTY_KIND[row.kind]}`, attrs: { value: row.id, selected: row.id === selected } })));
  };
  paint(value);
  const create = allowCreate ? h('button', { className: 'link-button', text: kind === 'PERSON' ? 'Nova persona' : 'Nou tercer', attrs: { type: 'button' }, on: { click: async () => {
    const created = await newCounterparty({ call, kind });
    if (!created) return;
    list = [...list, created]; paint(created.id); select.dispatchEvent(new Event('change'));
  } } }) : null;
  const wrap = field(name, label, select, { hint: allowCreate ? 'Només nom i tipus. Sense IBAN ni dades de contacte.' : null });
  if (create) wrap.append(create);
  return { node: wrap, get value() { return select.value || null; }, select };
}
async function newCounterparty({ call, kind }) {
  for (;;) {
    const values = await formDialog({ title: kind === 'PERSON' ? 'Nova persona' : 'Nou tercer', confirm: 'Crea',
      fields: [
        ...(kind ? [] : [{ name: 'kind', label: 'Tipus', type: 'select', value: 'ORGANIZATION', options: [{ value: 'ORGANIZATION', label: 'Entitat' }, { value: 'PERSON', label: 'Persona' }] }]),
        { name: 'displayName', label: 'Nom (en l’entorn de prova ha d’incloure «(fictici)»)', required: true, attrs: { maxlength: 120 } }] });
    if (!values) return null;
    try {
      const body = { kind: kind ?? values.kind, displayName: values.displayName.trim() };
      const created = await call('/api/finance/counterparties', { method: 'POST', body: JSON.stringify(body) });
      return { id: created.id, kind: body.kind, displayName: body.displayName, status: 'ACTIVE' };
    } catch (error) {
      toast(errorCopy(error), { tone: 'danger' });
    }
  }
}
