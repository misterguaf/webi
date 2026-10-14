// Small DOM helpers shared by the 3.5D screens: element builder, toasts, confirmation dialogs, overflow
// menus and focus management. No framework. Strict CSP: no inline style attributes or handlers
// (CSSOM property changes such as element.style.height are allowed).

/**
 * h('div', {className: 'x', text: 'y', attrs: {role: 'list'}, on: {click}}, ...children)
 * @param {string} tag
 * @param {{className?: string, text?: string|null, attrs?: Record<string, any>, on?: Record<string, EventListener>, dataset?: Record<string, string>}} [props]
 * @param {...any} children
 */
// 3.5I: a button whose click handler returns a promise is busy until it settles: further clicks are ignored
// (no double submit) and it is announced with aria-busy. It is not disabled, so focus stays where it was and each
// screen keeps managing its own disabled states.
export function guardBusy(node, listener) {
  return event => {
    if (node.getAttribute('aria-busy') === 'true') { event?.preventDefault?.(); return undefined; }
    const result = listener(event);
    if (result && typeof result.then === 'function') {
      node.setAttribute('aria-busy', 'true');
      Promise.resolve(result).catch(() => {}).finally(() => node.removeAttribute('aria-busy'));
    }
    return result;
  };
}

// Phase J: one icon family for actions. A text button with a known action verb gets its icon (the label and the
// accessible name do not change). Dismissive actions (Cancel·la, Tanca) and icon-only buttons stay as they are.
const ACTION_ICONS = [
  [/^(Guarda|Guardar|Desa)/, 'check'], [/^(Crea|Nou |Nova |Nou$|Afegeix|Afig|Agrupa)/, 'plus'], [/^(Edita|Editar|Corregeix|Corregir)/, 'pencil'],
  [/^Classifica/, 'tag'], [/^(Concilia|Vincula|Torna a vincular)/, 'link'], [/^(Confirma|Accepta|Aprova|Reconeix|Marca com a vista|Aplica)/, 'check'],
  [/^Verifica/, 'check-circle'], [/^Revisa el llibre/, 'eye'], [/^(Publica|Envia|Proposa)/, 'send'], [/^(Importa|Puja)/, 'upload'], [/^(Descarrega|Exporta)/, 'download'],
  [/^(Torna-ho a (intentar|provar)|Actualitza|Reobri|Reactiva|Torna a obrir)/, 'refresh'], [/^(Busca|Cerca)/, 'search'],
  [/^(Anul·la|Rebutja|Revoca|Descarta|Dona de baixa|Retira|Finalitza|Elimina|Arxiva)/, 'x-circle'], [/^(Ratifica|Concedeix|Acredita|Marca com a acreditada)/, 'shield'],
  [/^(Carrega’n més|Mostra’n més|Mostra-les totes)/, 'chevron'], [/^(Mostra|Veure)/, 'eye'], [/^(Assenyala|Obri una incidència|Marcar una incidència|Marca incidència)/, 'alert'],
  [/^(Prepara|Inicia)/, 'play'], [/^(Escala|Continua)/, 'arrow-right'], [/^(Torna a carregar|Canvia)/, 'refresh'], [/^(Treu)/, 'x-circle'],
  [/^(Registra|És un moviment vàlid|És aquesta persona)/, 'check'], [/^Resol/, 'check-circle'], [/^Llista de/, 'list'], [/^Tanca (totes|les)/, 'log-out'], [/^Tanca la ronda/, 'lock'], [/^Obri la ronda/, 'play'],
  [/^Torna a (Participants|Activitats)/, 'arrow-left'], [/^Reassigna/, 'link'], [/^Neteja/, 'x-small'], [/^Obri /, 'arrow-right']];
const actionIcon = text => ACTION_ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? null;

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  const glyph = tag === 'button' && props.text && !children.length && /\bbtn\b/.test(props.className ?? '') && !/btn-icon|btn-quiet/.test(props.className ?? '')
    ? actionIcon(String(props.text)) : null;
  if (glyph) node.append(icon(glyph), Object.assign(document.createElement('span'), { textContent: props.text }));
  else if (props.text != null) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === false || value == null) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, value] of Object.entries(props.dataset ?? {})) node.dataset[name] = value;
  for (const [name, listener] of Object.entries(props.on ?? {}))
    node.addEventListener(name, tag === 'button' && name === 'click' ? guardBusy(node, listener) : listener);
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}
export const icon = (name, className = '') => {
  if (!document.createElementNS) return document.createElement('span'); // minimal test DOMs without SVG support
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
};
export const button = (text, onClick, { className = 'btn', type = 'button', attrs = {} } = {}) =>
  h('button', { className, text, attrs: { type, ...attrs }, on: onClick ? { click: onClick } : {} });

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Resolve after a CSS transition/animation on `node`, or immediately with reduced motion. */
export function afterMotion(node, fallbackMs = 400) {
  if (reducedMotion()) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    node.addEventListener('transitionend', finish, { once: true });
    node.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, fallbackMs);
  });
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const focusables = container => [...container.querySelectorAll(FOCUSABLE)].filter(node => node.getClientRects().length && !node.closest('[hidden]'));
/** Keep Tab inside `container` (dialogs, drawer, sheets). */
export function trapTab(container, event) {
  if (event.key !== 'Tab') return;
  const items = focusables(container);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

// ---------------------------------------------------------------- toasts (MOTION 15)

function toastRegion() {
  let region = document.getElementById('toastRegion');
  if (!region) {
    region = h('div', { className: 'toast-region', attrs: { id: 'toastRegion', role: 'status', 'aria-live': 'polite' } });
    document.body.append(region);
  }
  return region;
}
// Phase J: tone + icon (CSS). Confirmations leave on their own; errors stay until they are closed, so they can be
// read and acted on. The region keeps at most three toasts.
export function toast(text, { tone = 'neutral', timeout = tone === 'danger' ? Infinity : 4200 } = {}) {
  const close = async () => {
    if (!node.isConnected || node.classList.contains('toast-leaving')) return;
    node.classList.add('toast-leaving'); await afterMotion(node, 200); node.remove();
  };
  const node = h('div', { className: `toast toast-${tone}`, attrs: tone === 'danger' ? { role: 'alert' } : {} },
    h('span', { className: 'toast-text', text }),
    h('button', { className: 'toast-close', attrs: { type: 'button', 'aria-label': 'Tanca l’avís' }, on: { click: () => void close() } }, icon('close')));
  const region = toastRegion();
  region.append(node);
  while (region.children.length > 3) region.firstElementChild.remove();
  if (Number.isFinite(timeout)) setTimeout(() => void close(), timeout);
  return node;
}

// ---------------------------------------------------------------- confirmation dialog

/**
 * Modal alertdialog. Default focus on the safe choice (Cancel·la). Bottom sheet on mobile via CSS.
 * @param {{title: string, body: string, confirm: string, tone?: 'primary'|'danger'|'strong', cancel?: string}} options
 * @returns {Promise<boolean>}
 */
// 3.5I: every overlay (dialog, drawer, sheet, menu) registers how to dismiss itself. Ending a session dismisses
// them all, so no protected data stays over the login screen and no keyboard handler keeps trapping focus.
const overlays = new Set();
/** @param {() => void} dismiss @returns {() => void} untrack */
export function trackOverlay(dismiss) { overlays.add(dismiss); return () => { overlays.delete(dismiss); }; }
export function dismissOverlays() {
  for (const dismiss of [...overlays]) { try { dismiss(); } catch { /* an overlay that already left */ } }
  overlays.clear();
  document.body.classList.remove('drawer-open');
}

export function confirmDialog({ title, body, confirm, tone = 'primary', cancel = 'Cancel·la' }) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`, bodyId = `${titleId}-body`;
    const cancelButton = button(cancel, () => close(false), { className: 'btn btn-secondary' });
    const confirmButton = button(confirm, () => close(true), { className: `btn btn-${tone}` });
    const dialog = h('div', { className: 'dialog', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': bodyId } },
      h('h2', { className: 'dialog-title', text: title, attrs: { id: titleId } }),
      h('p', { className: 'dialog-body', text: body, attrs: { id: bodyId } }),
      h('div', { className: 'dialog-actions' }, cancelButton, confirmButton));
    const layer = h('div', { className: 'dialog-layer', on: { mousedown: event => { if (event.target === layer) close(false); } } }, dialog);
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false); }
      else trapTab(dialog, event);
    };
    const untrack = trackOverlay(() => close(false));
    function close(result) {
      untrack();
      document.removeEventListener('keydown', onKey, true);
      layer.classList.add('dialog-leaving');
      afterMotion(dialog, 180).then(() => layer.remove());
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(result);
    }
    document.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    cancelButton.focus();
  });
}

/**
 * A small modal form dialog. Resolves to a values object (keyed by field name) or null on cancel.
 * @param {{title:string, fields:Array<{name,label,type?,options?,value?,required?,attrs?}>, confirm:string, tone?:string}} options
 */
export function formDialog({ title, fields, confirm, tone = 'primary' }) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const controls = {};
    const nodes = fields.map(f => {
      let control;
      if (f.type === 'select') control = h('select', { attrs: { id: `fd-${f.name}`, ...f.attrs } }, (f.options ?? []).map(o => h('option', { text: o.label, attrs: { value: o.value, selected: o.value === f.value } })));
      else if (f.type === 'textarea') control = h('textarea', { text: f.value ?? '', attrs: { id: `fd-${f.name}`, rows: 4, ...f.attrs } });
      else if (f.type === 'checkbox') control = h('input', { attrs: { id: `fd-${f.name}`, type: 'checkbox', ...(f.value ? { checked: '' } : {}), ...f.attrs } });
      else control = h('input', { attrs: { id: `fd-${f.name}`, type: f.type ?? 'text', value: f.value ?? '', autocomplete: 'off', ...f.attrs } });
      controls[f.name] = control;
      const error = h('p', { className: 'field-error', attrs: { hidden: true } });
      return h('div', { className: 'form-field', dataset: { field: f.name } },
        h('label', { className: 'field-label', attrs: { for: `fd-${f.name}` } }, f.label, f.required ? h('span', { className: 'field-required', text: ' · obligatori' }) : null),
        f.type === 'checkbox' ? h('label', { className: 'checkbox-row' }, control, h('span', { text: f.checkboxLabel ?? '' })) : control, error);
    });
    const read = () => Object.fromEntries(fields.map(f => [f.name, f.type === 'checkbox' ? controls[f.name].checked : controls[f.name].value]));
    const submit = () => {
      for (const f of fields) {
        const wrap = dialog.querySelector(`[data-field="${f.name}"]`), err = wrap.querySelector('.field-error');
        const invalid = f.required && !String(controls[f.name].value ?? '').trim();
        err.hidden = !invalid; err.textContent = invalid ? 'Aquest camp és obligatori' : '';
        if (invalid) { controls[f.name].focus(); return; }
      }
      close(read());
    };
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close(null); } else trapTab(dialog, event); };
    const untrack = trackOverlay(() => close(null));
    function close(result) { untrack(); document.removeEventListener('keydown', onKey, true); layer.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); resolve(result); }
    const dialog = h('div', { className: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
      h('h2', { className: 'dialog-title', text: title }),
      h('div', { className: 'dialog-form' }, nodes),
      h('div', { className: 'dialog-actions' },
        h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => close(null) } }),
        h('button', { className: `btn btn-${tone}`, text: confirm, attrs: { type: 'button' }, on: { click: submit } })));
    const layer = h('div', { className: 'dialog-layer', on: { mousedown: e => { if (e.target === layer) close(null); } } }, dialog);
    document.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    (fields[0] && controls[fields[0].name])?.focus();
  });
}

// ---------------------------------------------------------------- overflow menu (MOTION 07)

/**
 * @param {HTMLElement} trigger
 * @param {Array<{label: string, onSelect: () => void, tone?: 'danger'}>} items
 */
export function openMenu(trigger, items) {
  document.querySelector('.menu-popover')?.remove();
  const menu = h('div', { className: 'menu-popover', attrs: { role: 'menu' } },
    items.map(item => h('button', { className: `menu-item${item.tone === 'danger' ? ' menu-item-danger' : ''}`,
      attrs: { type: 'button', role: 'menuitem' }, on: { click: () => { close(); item.onSelect(); } } }, item.icon ? icon(item.icon) : null, h('span', { text: item.label }))));
  const rect = trigger.getBoundingClientRect();
  menu.style.top = `${Math.round(rect.bottom + 6 + window.scrollY)}px`;
  menu.style.right = `${Math.round(document.documentElement.clientWidth - rect.right)}px`;
  trigger.setAttribute('aria-expanded', 'true');
  const onKey = event => {
    const entries = [...menu.querySelectorAll('button')], index = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); entries[(index + 1) % entries.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus(); }
    else if (event.key === 'Tab') close();
  };
  const onPointer = event => { if (!menu.contains(event.target) && event.target !== trigger && !trigger.contains(event.target)) close(); };
  const untrack = trackOverlay(() => close());
  function close() {
    untrack();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
    trigger.setAttribute('aria-expanded', 'false');
    menu.remove();
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  document.body.append(menu);
  menu.querySelector('button')?.focus();
  return close;
}

/** Announce politely to screen readers (route changes, result counts). */
export function announce(text) {
  let region = document.getElementById('politeAnnouncer');
  if (!region) {
    region = h('div', { className: 'visually-hidden', attrs: { id: 'politeAnnouncer', 'aria-live': 'polite', role: 'status' } });
    document.body.append(region);
  }
  region.textContent = '';
  setTimeout(() => { region.textContent = text; }, 40);
}
