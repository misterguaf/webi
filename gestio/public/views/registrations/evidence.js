// Payment evidence (3.5F §14–§15) shared by the activity tab and the global queue: authenticated
// preview inside Gestió (image or PDF, same-origin), named download as fallback, verification with
// confirmation. Nothing is preloaded: each preview or download is one explicit, audited request.
import { confirmDialog, h, toast, trapTab } from '../../ui.js';
import { evidenceKind, formatEuros, parseEurosToCents, paymentActions, paymentLine, validateVerifiedAmount } from './model.js';

const formatMoney = cents => new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const url = (id, mode) => `/api/payments/${id}/evidence?mode=${mode}`;
const ERRORS = { invalid_transition: 'Aquest pagament ja s’ha revisat. S’ha actualitzat la informació.', forbidden: 'No tens permís per a fer aquesta acció.',
  not_found: 'No tens accés a aquest pagament o ja no existeix.', stale_payment: 'Algú ha verificat aquest pagament alhora. S’ha actualitzat la informació.',
  invalid_amount: 'L’import no és vàlid o supera el que falta.' };

/**
 * Verification of one instalment (3.5F): shows total, already verified and remaining, proposes the
 * remaining amount, and resolves to the cents to verify or null.
 */
export function verifyAmountDialog(payment) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const input = h('input', { attrs: { id: 'verify-amount', type: 'text', inputmode: 'decimal', autocomplete: 'off',
      value: (payment.remainingCents / 100).toFixed(2).replace('.', ','), 'aria-describedby': 'verify-amount-error' } });
    const error = h('p', { className: 'field-error', attrs: { id: 'verify-amount-error', hidden: true, role: 'alert' } });
    const figure = (label, cents, strong = false) => h('div', { className: `verify-figure${strong ? ' verify-figure-strong' : ''}` },
      h('dt', { text: label }), h('dd', { text: formatEuros(cents) }));
    const close = result => { document.removeEventListener('keydown', onKey, true); layer.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); resolve(result); };
    const submit = () => {
      const cents = parseEurosToCents(input.value), problem = validateVerifiedAmount(cents, payment.remainingCents);
      if (problem) { error.textContent = problem; error.hidden = false; input.focus(); return; }
      close(cents);
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    const dialog = h('div', { className: 'dialog verify-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'verify-title' } },
      h('h2', { className: 'dialog-title', text: 'Verificar un pagament', attrs: { id: 'verify-title' } }),
      h('p', { className: 'dialog-body', text: 'Indica l’import que has comprovat al banc. Si encara falta part, quedarà com a pagament parcial.' }),
      h('dl', { className: 'verify-figures' }, figure('Total', payment.amountCents), figure('Ja verificat', payment.paidCents),
        figure('Pendent', payment.remainingCents, true)),
      h('div', { className: 'form-field' }, h('label', { className: 'field-label', attrs: { for: 'verify-amount' }, text: 'Import que verifiques (€)' }), input, error),
      h('div', { className: 'dialog-actions' },
        h('button', { className: 'btn btn-secondary', text: 'Cancel·la', attrs: { type: 'button' }, on: { click: () => close(null) } }),
        h('button', { className: 'btn btn-primary', text: 'Verifica', attrs: { type: 'button' }, on: { click: submit } })));
    const layer = h('div', { className: 'dialog-layer', on: { mousedown: event => { if (event.target === layer) close(null); } } }, dialog);
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); close(null); } else trapTab(dialog, event); };
    document.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    input.focus(); input.select();
  });
}

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
    h('span', { className: 'evidence-state', text: paymentLine(payment) })];
  if (payment.registrationState === 'WITHDRAWN') nodes.push(h('span', { className: 'evidence-flag', text: 'Inscripció retirada' }));
  if (available) {
    nodes.push(h('button', { className: 'link-button', text: 'Veure justificant', attrs: { type: 'button' }, on: { click: () => openEvidencePreview(payment) } }),
      h('a', { className: 'link-button', text: 'Descarrega', attrs: { href: url(payment.id, 'download'), download: '' } }));
  } else nodes.push(h('span', { className: 'evidence-state', text: 'Justificant eliminat per la política de conservació' }));
  nodes.push(h('span', { className: 'review-spacer' }));
  const status = h('p', { className: 'field-error evidence-error', attrs: { hidden: true, role: 'alert' } });
  const actions = paymentActions(payment);
  if (actions.includes('verify')) {
    const verify = h('button', { className: 'btn btn-secondary btn-small', text: 'Verifica', attrs: { type: 'button' } });
    verify.addEventListener('click', async () => {
      const cents = await verifyAmountDialog(payment);
      if (cents == null) return;
      await review('VERIFIED', verify, cents);
    });
    nodes.push(verify);
  }
  if (actions.includes('issue')) {
    const issue = h('button', { className: 'btn btn-quiet btn-small', text: 'Marca incidència', attrs: { type: 'button' } });
    issue.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Marcar una incidència?', body: 'Queda registrat que hi ha un problema amb el pagament. Els imports ja verificats es mantenen. La família rep un avís la primera vegada.', confirm: 'Marca incidència', tone: 'strong' })) return;
      await review('ISSUE', issue);
    });
    nodes.push(issue);
  }
  async function review(decision, button, amountCents = null) {
    button.setAttribute('aria-busy', 'true'); button.disabled = true; status.hidden = true;
    try {
      const result = await call(`/api/payments/${payment.id}/review`, { method: 'POST',
        body: JSON.stringify({ decision, expectedVersion: payment.registrationVersion, ...(decision === 'VERIFIED' ? { amountCents } : {}) }) });
      toast(decision !== 'VERIFIED' ? 'Incidència registrada' : result.paymentState === 'PAID' ? 'Pagament complet verificat'
        : `Pagament parcial: ${formatEuros(result.paidCents)} / ${formatEuros(payment.amountCents)} · ${formatEuros(result.remainingCents)} pendents`);
      onChanged();
    } catch (error) {
      if (error.status === 401) return;
      status.textContent = ERRORS[error.code] ?? 'No s’ha pogut completar l’acció. Torna-ho a provar.'; status.hidden = false;
      button.removeAttribute('aria-busy'); button.disabled = false;
      if (['invalid_transition', 'stale_payment'].includes(error.code)) onChanged();
    }
  }
  return h('div', { className: 'evidence-wrap' }, h('div', { className: 'evidence' }, nodes), status);
}
