// Inscripcions: registration review (opened per activity) and activity payment evidence review.
import { fetchAllPages } from '../api.js';
import { candidateLabel, label } from '../labels.js';

const $ = id => document.getElementById(id);

export function createRegistrationsView({ call, message, reportLoadError, navigateTo }) {
  async function openRegistrations(activityId, pendingOnly = false, activityName = '') {
    try {
      const data = await fetchAllPages(call, `/api/activities/${activityId}/registrations`, 'registrations'); $('registrationPanel').hidden = false; navigateTo('inscripcions');
      $('registrationPanel').querySelector('p').textContent = activityName
        ? `${pendingOnly ? 'Pendents de revisar' : 'Inscripcions'} · ${activityName}`
        : 'Inscripcions de l’activitat seleccionada.';
      const visible = pendingOnly ? data.registrations.filter(row => row.status === 'NEEDS_PARTICIPANT_REVIEW') : data.registrations;
      $('registrationList').replaceChildren(...visible.map(registration => {
        const li = document.createElement('li'); li.textContent = `${registration.submitted_name} · ${label(registration.status)} · ${label(registration.match_status)} · ${(registration.expected_amount_cents / 100).toFixed(2)} €${registration.submitted_birth_date ? ` · Naixement declarat: ${registration.submitted_birth_date}` : ''} `;
        if (registration.status === 'NEEDS_PARTICIPANT_REVIEW') {
          const candidates = document.createElement('select'); const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Tria educand'; candidates.append(empty);
          call(`/api/registrations/${registration.id}/candidates`).then(data => {
            if (data.truncated) message('Hi ha més candidats plausibles dels que es mostren.');
            candidates.append(...data.candidates.map(person => { const option = document.createElement('option'); option.value = person.id; option.textContent = candidateLabel(person); return option; }));
          }).catch(() => {});
          const match = document.createElement('button'); match.textContent = 'Vincula'; match.addEventListener('click', async () => {
            if (!candidates.value) return; try { await call(`/api/registrations/${registration.id}/review`,
              { method: 'POST', body: JSON.stringify({ decision: 'MATCH', participantId: candidates.value }) }); await openRegistrations(activityId, pendingOnly, activityName); }
            catch (error) { message(error.message); }
          });
          const reject = document.createElement('button'); reject.textContent = 'Rebutja'; reject.addEventListener('click', async () => {
            try { await call(`/api/registrations/${registration.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'REJECT' }) }); await openRegistrations(activityId, pendingOnly, activityName); }
            catch (error) { message(error.message); }
          }); li.append(candidates, match, reject);
        }
        return li;
      }));
    } catch (error) { message(error.message); }
  }
  async function loadPayments() {
    try {
      const data = await fetchAllPages(call, '/api/payments', 'payments'); $('paymentPanel').hidden = false;
      $('paymentList').replaceChildren(...data.payments.map(payment => {
        const li = document.createElement('li'); li.textContent = `${payment.activity_name} · ${payment.submitted_name} · ${label(payment.review_status)} · ${(payment.expected_amount_cents / 100).toFixed(2)} € `;
        const download = document.createElement('a'); download.href = `/api/payments/${payment.id}/evidence`; download.textContent = 'Baixa justificant'; download.download = 'justificant.bin';
        li.append(download);
        for (const [decision, text] of [['VERIFIED', 'Verifica'], ['ISSUE', 'Incidència']]) {
          if (decision === 'VERIFIED' && !['PENDING_REVIEW', 'ISSUE'].includes(payment.review_status)) continue;
          if (decision === 'ISSUE' && payment.review_status !== 'PENDING_REVIEW') continue;
          const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', async () => {
            try { await call(`/api/payments/${payment.id}/review`, { method: 'POST', body: JSON.stringify({ decision }) }); await loadPayments(); }
            catch (error) { message(error.message); }
          }); li.append(button);
        }
        return li;
      }));
    } catch (error) { $('paymentPanel').hidden = true; reportLoadError(error); }
  }
  $('reloadPayments').addEventListener('click', loadPayments);

  return { id: 'payments', page: 'inscripcions', available: caps => !!caps.activities.verifyPayments,
    load: loadPayments, unload: () => { $('registrationPanel').hidden = true; $('paymentPanel').hidden = true; },
    openRegistrations, loadPayments };
}
