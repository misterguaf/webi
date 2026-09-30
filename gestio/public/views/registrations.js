// Inscripcions page: activity payment evidence review. Registration review lives in each activity
// (Activitats → detail → Inscripcions, 3.5D).
import { fetchAllPages } from '../api.js';
import { label } from '../labels.js';

const $ = id => document.getElementById(id);

export function createRegistrationsView({ call, message, reportLoadError }) {
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
    load: loadPayments, unload: () => { $('paymentPanel').hidden = true; }, loadPayments };
}
