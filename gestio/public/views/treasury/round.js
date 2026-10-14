import { confirmDialog, h, icon, toast } from '../../ui.js';
import { errorCopy, formatEur, parseEuros } from './model.js';
import { renderBudget } from './budget.js';
import { field, showErrors } from './forms.js';

// Phase J: the round as a result sheet (rows → subtotals), its downloads, the reserve operation and the state
// actions, all on the same endpoints. A negative result keeps its sign and takes the danger tone.
const ROUND_STATUS = { OPEN: ['Oberta', 'tone-ok'], CLOSING: ['En tancament', 'tone-warning'], CLOSED: ['Tancada', 'tone-muted'], DRAFT: ['Esborrany', 'badge-draft'] };
const statusBadge = status => { const [text, tone] = ROUND_STATUS[status] ?? [status, 'tone-neutral']; return h('span', { className: `badge ${tone}`, text }); };
const line = (label, cents, total = false) => h('div', { className: 'result-row' + (total ? ' is-total' : '') },
  h('dt', { text: label }), h('dd', { className: 'result-amount' + (cents < 0 ? ' is-negative' : ''), text: formatEur(cents) }));
const notice = () => h('div', { className: 'inline-error round-message', attrs: { role: 'alert', hidden: true } }, h('p'));
const say = (node, text) => { node.querySelector('p').textContent = text; node.hidden = !text; };
/** Busy state inside the submit button while a form's operation runs (a double submit never sends twice). */
async function submitting(form, run) {
  const submit = form.querySelector('button[type="submit"]');
  if (submit?.getAttribute('aria-busy') === 'true') return;
  submit?.setAttribute('aria-busy', 'true'); if (submit) submit.disabled = true;
  try { await run(); } finally { if (submit?.isConnected) { submit.removeAttribute('aria-busy'); submit.disabled = false; } }
}

export async function renderRound(root, ctx, selectedId=null) {
  const caps = ctx.caps().treasury ?? {};
  const rounds = (await ctx.call(caps.read ? '/api/finance/rounds' : '/api/finance/budget-rounds')).rounds;
  const newRound=()=>{
    const year=rounds.length?Number(rounds[0].code.slice(5)):new Date().getFullYear();
    const message=notice();
    const form=h('form',{className:'round-new-form',attrs:{novalidate:true},on:{submit:event=>{
      event.preventDefault();const data=new FormData(event.currentTarget);say(message,'');
      const errors={code:String(data.get('code')).trim()?null:'Indica el codi de la ronda.',
        start:data.get('start')?null:'Indica quan comença.',end:data.get('end')?null:'Indica quan acaba.'};
      if(!showErrors(form,errors))return;
      void submitting(form,async()=>{
        try{const created=await ctx.call('/api/finance/rounds',{method:'POST',body:JSON.stringify({
          code:data.get('code'),periodStart:data.get('start'),periodEnd:data.get('end')})});
          toast(`S’ha creat l’esborrany de la ronda ${data.get('code')}.`,{tone:'ok'});
          await renderRound(root,ctx,created.id);
        }catch(error){say(message,errorCopy(error));}
      });
    }}},
    h('div',{className:'round-new-grid'},
      field('code','Ronda',h('input',{attrs:{name:'code',value:year+'/'+(year+1),required:true}}),{required:true}),
      field('start','Des de',h('input',{attrs:{name:'start',type:'date',value:year+'-10-01',required:true}}),{required:true}),
      field('end','Fins a',h('input',{attrs:{name:'end',type:'date',value:(year+1)+'-09-30',required:true}}),{required:true})),
    message,h('div',{className:'form-actions'},h('button',{text:'Crea l’esborrany',className:'btn btn-secondary',attrs:{type:'submit'}})));
    return h('details',{className:'round-new'},h('summary',{className:'btn btn-secondary'},icon('plus'),h('span',{text:'Prepara una nova ronda'})),form);
  };
  const round = rounds.find(row=>row.id===selectedId)??rounds.find(row => row.status === 'CLOSING') ?? rounds.find(row => row.status === 'OPEN') ?? rounds[0];
  if (!round) { root.replaceChildren(h('div',{className:'empty-state round-empty'},h('p',{className:'empty-title',text:'Encara no hi ha cap ronda econòmica.'})),caps.manageRounds?newRound():null); return; }
  const roundChooser=h('div',{className:'round-toolbar'},
    h('div',{className:'form-field round-chooser'},h('label',{className:'field-label',text:'Ronda econòmica',attrs:{for:'roundChooser'}}),
      h('select',{attrs:{id:'roundChooser','aria-label':'Ronda econòmica'},
        on:{change:event=>void renderRound(root,ctx,event.target.value)}},...rounds.map(r=>h('option',{text:r.code,
          attrs:{value:r.id,selected:r.id===round.id}})))),
    caps.manageRounds?newRound():null);
  const detail = caps.read ? await ctx.call(`/api/finance/rounds/${round.id}`) : null;
  const result = detail?.economics;
  const message = notice();
  async function action(path, body) {
    say(message,'');
    try { await ctx.call(path, { method: 'POST', body: JSON.stringify(body) });
      await renderRound(root, ctx, round.id);
    } catch (error) { say(message, errorCopy(error)); }
  }
  async function download(kind) {
    say(message,'');
    try {
      const response=await fetch(`/api/finance/rounds/${round.id}/export/${kind}`,{credentials:'same-origin'});
      if (!response.ok) {
        let data;try {data=await response.json();} catch { /* network or non-JSON failure */ }
        say(message,errorCopy({status:response.status,code:data?.error}));return;
      }
      const match=response.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9_.-]+)"/);
      const filename=match?.[1]??`${kind}-${round.code.replace('/','-')}.xlsx`;
      const url=URL.createObjectURL(await response.blob());
      const link=h('a',{attrs:{href:url,download:filename}});
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`S’ha preparat ${kind==='budget'?'el pressupost':'el resultat'} de la ronda ${round.code}.`,{tone:'ok'});
    } catch {say(message,'No s’ha pogut descarregar el llibre. Torna-ho a provar.');}
  }
  if (!caps.read) {
    root.replaceChildren(roundChooser,h('section',{className:'activity-surface treasury-block'},
      h('div',{className:'block-head'},h('h2',{className:'block-title',text:`Pressupost · ronda ${round.code}`}),statusBadge(round.status)),
      h('div',{className:'form-actions'},h('button',{className:'btn btn-secondary',text:'Descarrega pressupost Excel',attrs:{type:'button'},
        on:{click:()=>download('budget')}})),message));
    await renderBudget(root,ctx,round,()=>renderRound(root,ctx,round.id));
    return;
  }
  const reserveForm = h('form', { className: 'round-reserve', attrs: { novalidate: true }, on: { submit: event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amountCents = parseEuros(data.get('amount'));
    if (!showErrors(reserveForm, { amount: !amountCents || amountCents <= 0 ? 'Introdueix un import positiu.' : null })) return;
    void submitting(reserveForm, () => action(`/api/finance/rounds/${round.id}/reserve-operations`,
      { kind: data.get('kind'), amountCents }));
  } } },
  h('h3', { className: 'form-section-title', text: 'Reserva general' }),
  h('div', { className: 'round-reserve-grid' },
    field('kind', 'Moviment de reserva', h('select', { attrs: { name: 'kind' } },
      h('option', { text: 'Aportació', attrs: { value: 'CONTRIBUTION' } }),
      h('option', { text: 'Aplicació', attrs: { value: 'APPLICATION' } }))),
    field('amount', 'Import en euros', h('input', { className: 'amount-input', attrs: { name: 'amount', inputmode: 'decimal', required: true, placeholder: '0,00' } }), { required: true }),
    h('button', { className: 'btn btn-secondary', text: 'Registra', attrs: { type: 'submit' } })));
  const actions = [];
  if(caps.manageRounds&&round.status==='DRAFT')actions.push(h('button',{className:'btn btn-primary',text:'Obri la ronda',attrs:{type:'button'},
    on:{click:()=>action('/api/finance/rounds/'+round.id+'/open',{expectedVersion:round.version})}}));
  if (caps.manageRounds && round.status === 'OPEN') actions.push(h('button', { className: 'btn btn-secondary',
    text: 'Inicia el tancament', attrs: { type: 'button' },
    on: { click: () => action(`/api/finance/rounds/${round.id}/closing`, { expectedVersion: round.version }) } }));
  if (caps.manageRounds && round.status === 'CLOSING') actions.push(h('button', { className: 'btn btn-secondary',
    text: 'Torna a obrir', attrs: { type: 'button' },
    on: { click: () => action(`/api/finance/rounds/${round.id}/open`, { expectedVersion: round.version }) } }));
  if (caps.closeRounds && round.status === 'CLOSING') actions.push(h('button', { className: 'btn btn-primary',
    text: 'Tanca la ronda oficialment', attrs: { type: 'button' },
    on: { click: async () => { if (await confirmDialog({ title: 'Tancar la ronda oficialment?', body: 'El resultat oficial quedarà fixat i no es podrà reescriure.', confirm: 'Tanca la ronda', tone: 'strong' }))
      await action(`/api/finance/rounds/${round.id}/close`, { expectedVersion: round.version }); } } }));
  const official = detail.officialClose;
  root.replaceChildren(
    roundChooser,
    h('section', { className: 'activity-surface treasury-block round-block' },
      h('div', { className: 'block-head' }, h('h2', { className: 'block-title', text: `Ronda ${round.code}` }), statusBadge(round.status)),
      h('dl', { className: 'result-sheet' },
        line('Ingressos reconeguts', result.incomeCents), line('Despeses reconegudes', result.expenseNetCents),
        line('Resultat abans de reserves', result.resultBeforeReservesCents, true),
        line('Aportacions a la reserva general', result.reserveContributionCents),
        line('Aplicacions de la reserva general', result.reserveApplicationCents),
        line('Resultat després de reserves', result.resultAfterReservesCents, true)),
      official ? h('div', { className: 'treasury-block-plain' },
        h('h3', { className: 'form-section-title', text: 'Tancament oficial' }),
        h('dl', { className: 'result-sheet' },
          line('Resultat oficial', official.resultCents), line('Resultat final oficial', official.resultAfterReservesCents, true),
          line('Reserva general final', official.reservesFinalCents))) : null,
      detail.postClose ? h('div', { className: 'treasury-block-plain' },
        h('h3', { className: 'form-section-title', text: 'Després del tancament' }),
        h('dl', { className: 'result-sheet' },
          line('Ajustos posteriors', detail.postClose.resultDeltaCents),
          line('Resultat actual ajustat', detail.postClose.adjustedResultAfterReservesCents, true),
          ...detail.postClose.adjustments.map(item => line(item.kind === 'LATE_INCOME' ? 'Ingrés tardà' : 'Correcció', item.amountCents)))) : null,
      h('div',{className:'form-actions round-downloads'},
        caps.read ? h('button',{className:'btn btn-secondary',text:'Descarrega resultat Excel',attrs:{type:'button'},
          on:{click:()=>download('result')}}) : null,
        caps.readBudget ? h('button',{className:'btn btn-secondary',text:'Descarrega pressupost Excel',attrs:{type:'button'},
          on:{click:()=>download('budget')}}) : null),
      caps.manageRounds && ['OPEN', 'CLOSING'].includes(round.status) ? reserveForm : null,
      actions.length ? h('div', { className: 'form-actions round-state-actions' }, actions) : null,
      message));
  if (caps.readBudget) await renderBudget(root, ctx, round, () => renderRound(root, ctx, round.id));
}
