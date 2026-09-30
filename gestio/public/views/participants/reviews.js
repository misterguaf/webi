// Administrative review queue (3.5E §10.3), for Secretaria (participants.review.manage). Acknowledge,
// raise an incidence, escalate (no data change), resolve, and apply/reject a shared-guardian request.
import { fetchAllPages } from '../../api.js';
import { confirmDialog, formDialog, h, toast } from '../../ui.js';
import { contactKindLabel, reviewKindLabel, reviewStatusLabel } from './model.js';

export function createReviewQueue({ call, onOpenParticipant, onCount }) {
  let token = 0;

  function payloadText(review) {
    if (!review.payload) return null;
    if (review.payload.op === 'ADD_CONTACT') return `Proposa afegir un ${contactKindLabel(review.payload.kind).toLowerCase()} al tutor.`;
    if (review.payload.op === 'END_CONTACT') return 'Proposa retirar un contacte del tutor.';
    return null;
  }
  async function render(root) {
    const mine = ++token;
    root.replaceChildren(h('div', { className: 'tab-loading', attrs: { 'aria-busy': 'true' } }, [1, 2].map(() => h('span', { className: 'skeleton-line' }))));
    let data;
    try { data = await fetchAllPages(call, '/api/participant-reviews', 'reviews'); }
    catch (error) {
      if (mine !== token || error.status === 401) return;
      root.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: 'No s’ha pogut carregar la cua de revisions.' }),
        h('button', { className: 'btn btn-secondary', text: 'Torna-ho a intentar', attrs: { type: 'button' }, on: { click: () => void render(root) } })));
      return;
    }
    if (mine !== token) return;
    onCount?.(data.reviews.length);
    if (!data.reviews.length) { root.replaceChildren(h('div', { className: 'empty-state' }, h('p', { className: 'empty-title', text: 'No hi ha res per revisar.' }))); return; }
    root.replaceChildren(h('ul', { className: 'review-list', attrs: { role: 'list' } }, data.reviews.map(r => item(r, root))));
  }
  function item(r, root) {
    const badge = h('span', { className: `badge badge-${r.status.toLowerCase()}`, text: reviewStatusLabel(r.status) });
    const meta = [r.participantName, r.guardianName].filter(Boolean).join(' · ');
    const node = h('li', { className: 'review-item' },
      h('div', { className: 'review-head' }, h('span', { className: 'review-kind', text: reviewKindLabel(r.kind) }), badge),
      meta ? h('p', { className: 'review-meta', text: meta }) : null,
      r.detail ? h('p', { className: 'review-detail', text: r.detail }) : null,
      payloadText(r) ? h('p', { className: 'review-payload', text: payloadText(r) }) : null,
      r.resolutionNote ? h('p', { className: 'review-meta', text: `Resolució: ${r.resolutionNote}` }) : null,
      actions(r, root));
    return node;
  }
  function actions(r, root) {
    const open = ['OPEN', 'INCIDENCE', 'ESCALATED'].includes(r.status);
    const box = h('div', { className: 'review-actions' });
    if (r.participantId) box.append(h('button', { className: 'link-button', text: 'Obre el participant', attrs: { type: 'button' }, on: { click: () => onOpenParticipant(r.participantId) } }));
    if (!open) return box;
    const act = (fn, label, tone = 'secondary') => { const b = h('button', { className: `btn btn-${tone} btn-small`, text: label, attrs: { type: 'button' } }); b.addEventListener('click', () => fn(r, root)); return b; };
    if (r.kind === 'GUARDIAN_DATA_REQUEST') { box.append(act(apply, 'Aplica', 'primary'), act(reject, 'Rebutja')); }
    box.append(act(acknowledge, 'Marca com a vista'), act(incidence, 'Assenyala una incidència'), act(escalate, 'Escala', 'quiet'));
    return box;
  }
  const run = async (root, request, success) => {
    try { await request(); toast(success); await render(root); }
    catch (error) { if (error.status !== 401) toast(error.code === 'invalid_transition' ? 'L’estat ha canviat.' : 'No s’ha pogut completar l’acció.'); }
  };
  const acknowledge = (r, root) => run(root, () => call(`/api/participant-reviews/${r.id}/acknowledge`, { method: 'POST', body: JSON.stringify({}) }), 'Marcada com a vista');
  const escalate = async (r, root) => { if (await confirmDialog({ title: 'Escalar el cas?', body: 'El cas passarà a coordinació general. No es canvia cap dada.', confirm: 'Escala', tone: 'strong' })) run(root, () => call(`/api/participant-reviews/${r.id}/escalate`, { method: 'POST', body: JSON.stringify({}) }), 'Cas escalat'); };
  const incidence = async (r, root) => { const v = await formDialog({ title: 'Assenyala una incidència', confirm: 'Desa', fields: [{ name: 'note', label: 'Nota (interna)', attrs: { maxlength: '280' } }] }); if (v) run(root, () => call(`/api/participant-reviews/${r.id}/incidence`, { method: 'POST', body: JSON.stringify({ note: v.note || null }) }), 'Incidència registrada'); };
  const apply = async (r, root) => { if (await confirmDialog({ title: 'Aplicar el canvi?', body: 'S’aplicarà el canvi proposat a les dades del tutor.', confirm: 'Aplica', tone: 'primary' })) run(root, () => call(`/api/participant-reviews/${r.id}/apply`, { method: 'POST', body: JSON.stringify({}) }), 'Canvi aplicat'); };
  const reject = async (r, root) => { if (await confirmDialog({ title: 'Rebutjar la sol·licitud?', body: 'La sol·licitud es tancarà sense aplicar cap canvi.', confirm: 'Rebutja', tone: 'danger' })) run(root, () => call(`/api/participant-reviews/${r.id}/reject`, { method: 'POST', body: JSON.stringify({}) }), 'Sol·licitud rebutjada'); };

  return { render, clear() { token++; } };
}
