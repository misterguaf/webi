import { h, toast } from '../../ui.js';
import { errorCopy, formatEur } from './model.js';

const CAUSE = {
  OVERPAYMENT_REFUND: 'Excés de pagament',
  ACTIVITY_WITHDRAWAL_REFUND: 'Baixa d’activitat',
  ACTIVITY_REJECTION_REFUND: 'Inscripció rebutjada'
};
// Phase J: two work lists with their counts; the state of each item is a badge, the action stays on the row.
const block = (title, count, body) => h('section', { className: 'activity-surface treasury-block family-payments-block' },
  h('div', { className: 'block-head' }, h('h3', { className: 'block-title', text: title }), h('span', { className: 'badge tone-neutral badge-count', text: String(count) })), body);
const empty = text => h('div', { className: 'empty-state family-empty' }, h('p', { text }));

export async function renderFamilyPayments(root,ctx) {
  const roundId=ctx.summary()?.round?.id;
  const query=roundId?`?roundId=${roundId}`:'';
  const [claims,due]=await Promise.all([
    ctx.call(`/api/finance/family-overpayments${query}`),
    ctx.call(`/api/finance/family-refunds${query}`)
  ]);
  const message=h('div', { className:'inline-error', attrs:{role:'alert',hidden:true} }, h('p'));
  const claimRows=claims.overpayments.filter(row=>row.status==='OPEN');
  const refundRows=due.refunds.filter(row=>row.status!=='SETTLED');
  root.replaceChildren(
    h('header',{className:'section-heading'},h('div',{},h('h2',{text:'Pagaments familiars'}),
      h('p',{text:'Excessos i devolucions pendents. Cada moviment bancari es concilia manualment.'}))),
    block('Excessos oberts', claimRows.length,
      claimRows.length?h('ul',{className:'allocation-list family-list',attrs:{role:'list'}},claimRows.map(row=>
        h('li',{className:'allocation-item'},
          h('span',{className:'allocation-kind',text:row.cause==='PRICE_CORRECTION'?'Correcció d’import':'Pagament superior al degut'}),
          h('span',{className:'allocation-target'},h('span',{className:'amount',text:formatEur(row.amountCents)}),h('span',{className:'field-hint',text:` · conciliat ${formatEur(row.reconciledCents)}`})),
          row.refundDue?h('span',{className:'badge tone-ok',text:'Devolució preparada'}):
          row.reconciledCents===row.amountCents && ctx.caps().treasury?.classifyMovements?h('button',{className:'btn btn-secondary btn-sm',text:'Preparar devolució',
            attrs:{type:'button'},on:{click:async()=>{
              message.hidden=true;
              try {await ctx.call(`/api/finance/family-overpayments/${row.id}/refund`,
                {method:'POST',body:'{}'});toast('Devolució preparada.',{tone:'ok'});await renderFamilyPayments(root,ctx);}
              catch(error){message.querySelector('p').textContent=errorCopy(error);message.hidden=false;}
            }}}):h('span',{className:'badge tone-warning',text:'Pendent de conciliar amb el banc'}))))
        :empty('No hi ha excessos familiars oberts.')),
    block('Devolucions pendents', refundRows.length,
      refundRows.length?h('ul',{className:'allocation-list family-list',attrs:{role:'list'}},refundRows.map(row=>
        h('li',{className:'allocation-item'},
          h('span',{className:'allocation-kind',text:CAUSE[row.cause]??'Devolució familiar'}),
          h('span',{className:'allocation-target'},h('span',{text:row.recipientEmail}),h('span',{className:'field-hint',text:' · '}),
            h('span',{className:'amount',text:formatEur(row.amountCents)}),h('span',{className:'field-hint',text:` · pagat ${formatEur(row.settledCents)}`})),
          h('span',{className:`badge ${row.status==='PARTIAL'?'tone-attention':'tone-warning'}`,text:row.status==='PARTIAL'?'Pagada en part':'Pendent de transferència'}))))
        :empty('No hi ha devolucions familiars pendents.')),
    message,
    h('div',{className:'form-notice'},h('p',{text:'Per conciliar o liquidar aquests imports, obri el moviment bancari a Moviments.'})));
}
