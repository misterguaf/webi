// Payment evidence (3.5F §14–§15) shared by the activity tab and the global queue: authenticated
// preview inside Gestió (image or PDF, same-origin), named download as fallback, verification with
// confirmation. Nothing is preloaded: each preview or download is one explicit, audited request.
import { confirmDialog, h, toast, trapTab } from '../../ui.js';
import { evidenceKind, paymentStateLabel } from './model.js';

const formatMoney = cents => new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const url = (id, mode) => `/api/payments/${id}/evidence?mode=${mode}`;
const ERRORS = { invalid_transition: 'Aquest pagament ja s’ha revisat. S’ha actualitzat la informació.', forbidden: 'No tens permís per a fer aquesta acció.',
  not_found: 'No tens accés a aquest pagament o ja no existeix.' };

export function openEvidencePreview(payment) {
  const previous = document.activeElement;
  const kind = evidenceKind(payment.evidence?.mime);
  const fallback = h('p', { className: 'evidence-fallback', attrs: { hidden: true }, text: 'No s’ha pogut mostrar el justificant aquí. Pots descarregar-lo.' });
  const viewer = kind === 'image'
    ? h('img', { className: 'evidence-image', attrs: { src: url(payment.id, 'view'), alt: 'Justificant de pagament' },
      on: { error: () => { viewer.hidden = true; fallback.hidden = false; } } })
    : kind === 'pdf'
      ? h('iframe', { className: 'evidence-frame', attrs: { src: url(payment.id, 'view'), title: 'Justificant de pagament' } })
      : null;
  if (!viewer) fallback.hidden = false;
  const close = () => { document.removeEventListener('keydown', onKey, true); layer.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  const closeButton = h('button', { className: 'btn btn-secondary', text: 'Tanca', attrs: { type: 'button' }, on: { click: close } });
  const dialog = h('div', { className: 'dialog evidence-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Justificant de pagament' } },
    h('h2', { className: 'dialog-title', text: 'Justificant de pagament' }),
    h('p', { className: 'dialog-body', text: [payment.activity?.name, payment.submittedName, formatMoney(payment.amountCents)].filter(Boolean).join(' · ') }),
    h('div', { className: 'evidence-viewer' }, viewer, fallback),
    kind === 'pdf' ? h('p', { className: 'field-hint', text: 'Si el document no es mostra, descarrega’l.' }) : null,
    h('div', { className: 'dialog-actions' },
      h('a', { className: 'btn btn-secondary', text: 'Descarrega', attrs: { href: url(payment.id, 'download'), download: '' } }), closeButton));
  const layer = h('div', { className: 'dialog-layer', on: { mousedown: event => { if (event.target === layer) close(); } } }, dialog);
  const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } else trapTab(dialog, event); };
  document.addEventListener('keydown', onKey, true);
  document.body.append(layer);
  closeButton.focus();
}

/**
 * Evidence actions block for one payment row. `onChanged` refreshes the caller after a decision.
 * @param {{call: Function, payment: any, onChanged: () => void, showActivity?: boolean}} options
 */
export function evidenceBlock({ call, payment, onChanged }) {
  const available = payment.evidence?.available !== false;
  const nodes = [h('span', { className: 'evidence-amount', text: formatMoney(payment.amountCents) }),
    h('span', { className: 'evidence-state', text: paymentStateLabel(payment.paymentState) })];
  if (payment.registrationState === 'WITHDRAWN') nodes.push(h('span', { className: 'evidence-flag', text: 'Inscripció retirada' }));
  if (available) {
    nodes.push(h('button', { className: 'link-button', text: 'Veure justificant', attrs: { type: 'button' }, on: { click: () => openEvidencePreview(payment) } }),
      h('a', { className: 'link-button', text: 'Descarrega', attrs: { href: url(payment.id, 'download'), download: '' } }));
  } else nodes.push(h('span', { className: 'evidence-state', text: 'Justificant eliminat per la política de conservació' }));
  nodes.push(h('span', { className: 'review-spacer' }));
  const status = h('p', { className: 'field-error evidence-error', attrs: { hidden: true, role: 'alert' } });
  if (['PENDING_REVIEW', 'ISSUE'].includes(payment.paymentState)) {
    const verify = h('button', { className: 'btn btn-secondary btn-small', text: 'Verifica', attrs: { type: 'button' } });
    verify.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Verificar el pagament?', body: `Confirmes que el pagament de ${formatMoney(payment.amountCents)} s’ha rebut al banc?`,
        confirm: 'Verifica', tone: 'primary' })) return;
      await review('VERIFIED', verify);
    });
    nodes.push(verify);
  }
  if (payment.paymentState === 'PENDING_REVIEW' && payment.registrationState !== 'WITHDRAWN') {
    const issue = h('button', { className: 'btn btn-quiet btn-small', text: 'Marca incidència', attrs: { type: 'button' } });
    issue.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Marcar una incidència?', body: 'La família rebrà un avís que hi ha un problema amb el justificant.', confirm: 'Marca incidència', tone: 'strong' })) return;
      await review('ISSUE', issue);
    });
    nodes.push(issue);
  }
  async function review(decision, button) {
    button.setAttribute('aria-busy', 'true'); button.disabled = true; status.hidden = true;
    try {
      await call(`/api/payments/${payment.id}/review`, { method: 'POST', body: JSON.stringify({ decision }) });
      toast(decision === 'VERIFIED' ? 'Pagament verificat' : 'Incidència registrada');
      onChanged();
    } catch (error) {
      if (error.status === 401) return;
      status.textContent = ERRORS[error.code] ?? 'No s’ha pogut completar l’acció. Torna-ho a provar.'; status.hidden = false;
      button.removeAttribute('aria-busy'); button.disabled = false;
      if (error.code === 'invalid_transition') onChanged();
    }
  }
  return h('div', { className: 'evidence-wrap' }, h('div', { className: 'evidence' }, nodes), status);
}
