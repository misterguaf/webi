import { h } from '../../ui.js';
import { formatEur } from './model.js';

const CAUSE = {
  OVERPAYMENT_REFUND: 'Excés de pagament',
  ACTIVITY_WITHDRAWAL_REFUND: 'Baixa d’activitat',
  ACTIVITY_REJECTION_REFUND: 'Inscripció rebutjada'
};

export async function renderFamilyPayments(root,ctx) {
  const roundId=ctx.summary()?.round?.id;
  const query=roundId?`?roundId=${roundId}`:'';
  const [claims,due]=await Promise.all([
    ctx.call(`/api/finance/family-overpayments${query}`),
    ctx.call(`/api/finance/family-refunds${query}`)
  ]);
  const message=h('p', { className:'form-notice', attrs:{role:'status'} });
  const claimRows=claims.overpayments.filter(row=>row.status==='OPEN');
  const refundRows=due.refunds.filter(row=>row.status!=='SETTLED');
  root.replaceChildren(
    h('header',{className:'section-heading'},h('div',{},h('h2',{text:'Pagaments familiars'}),
      h('p',{text:'Excessos i devolucions pendents. Cada moviment bancari es concilia manualment.'}))),
    h('section',{className:'activity-surface'},h('h3',{text:`Excessos oberts · ${claimRows.length}`}),
      claimRows.length?h('ul',{className:'allocation-list',attrs:{role:'list'}},claimRows.map(row=>
        h('li',{className:'allocation-item'},
          h('span',{className:'allocation-kind',text:row.cause==='PRICE_CORRECTION'?'Correcció d’import':'Pagament superior al degut'}),
          h('span',{className:'allocation-target',text:`${formatEur(row.amountCents)} · conciliat ${formatEur(row.reconciledCents)}`}),
          row.reconciledCents===row.amountCents?h('button',{className:'btn btn-secondary',text:'Preparar devolució',
            attrs:{type:'button'},on:{click:async()=>{
              try {await ctx.call(`/api/finance/family-overpayments/${row.id}/refund`,
                {method:'POST',body:'{}'});await renderFamilyPayments(root,ctx);}
              catch(error){message.textContent=error.message??'No s’ha pogut preparar la devolució.';}
            }}}):h('span',{className:'field-hint',text:'Pendent de conciliar amb el banc'}))))
        :h('p',{className:'empty-state',text:'No hi ha excessos familiars oberts.'})),
    h('section',{className:'activity-surface'},h('h3',{text:`Devolucions pendents · ${refundRows.length}`}),
      refundRows.length?h('ul',{className:'allocation-list',attrs:{role:'list'}},refundRows.map(row=>
        h('li',{className:'allocation-item'},
          h('span',{className:'allocation-kind',text:CAUSE[row.cause]??'Devolució familiar'}),
          h('span',{className:'allocation-target',text:`${row.recipientEmail} · ${formatEur(row.amountCents)} · pagat ${formatEur(row.settledCents)}`}),
          h('span',{className:'field-hint',text:row.status==='PARTIAL'?'Pagada en part':'Pendent de transferència'}))))
        :h('p',{className:'empty-state',text:'No hi ha devolucions familiars pendents.'})),
    h('p',{className:'form-notice',text:'Per conciliar o liquidar aquests imports, obri el moviment bancari a Moviments.'}),message);
}
