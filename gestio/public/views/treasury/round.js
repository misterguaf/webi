import { h } from '../../ui.js';
import { errorCopy, formatEur, parseEuros } from './model.js';
import { renderBudget } from './budget.js';

const line = (label, cents) => h('div', { className: 'mini-row' },
  h('span', { className: 'mini-main', text: label }), h('strong', { text: formatEur(cents) }));

export async function renderRound(root, ctx) {
  const caps = ctx.caps().treasury ?? {};
  const rounds = (await ctx.call(caps.read ? '/api/finance/rounds' : '/api/finance/budget-rounds')).rounds;
  const round = rounds.find(row => row.status === 'CLOSING') ?? rounds.find(row => row.status === 'OPEN') ?? rounds[0];
  if (!round) { root.replaceChildren(h('p', { className: 'empty-detail', text: 'Encara no hi ha cap ronda econòmica.' })); return; }
  const detail = caps.read ? await ctx.call(`/api/finance/rounds/${round.id}`) : null;
  const result = detail?.economics;
  const message = h('p', { attrs: { role: 'status' } });
  async function action(path, body) {
    try { await ctx.call(path, { method: 'POST', body: JSON.stringify(body) });
      await renderRound(root, ctx);
    } catch (error) { message.textContent = errorCopy(error); }
  }
  async function download(kind) {
    try {
      const response=await fetch(`/api/finance/rounds/${round.id}/export/${kind}`,{credentials:'same-origin'});
      if (!response.ok) {
        let data;try {data=await response.json();} catch { /* network or non-JSON failure */ }
        message.textContent=errorCopy({status:response.status,code:data?.error});return;
      }
      const match=response.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9_.-]+)"/);
      const filename=match?.[1]??`${kind}-${round.code.replace('/','-')}.xlsx`;
      const url=URL.createObjectURL(await response.blob());
      const link=h('a',{attrs:{href:url,download:filename}});
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      message.textContent=`S’ha preparat ${kind==='budget'?'el pressupost':'el resultat'} de la ronda ${round.code}.`;
    } catch {message.textContent='No s’ha pogut descarregar el llibre. Torna-ho a provar.';}
  }
  if (!caps.read) {
    root.replaceChildren(h('section',{className:'activity-surface treasury-block'},
      h('h2',{className:'block-title',text:`Pressupost · ronda ${round.code}`}),
      h('button',{className:'btn btn-secondary',text:'Descarrega pressupost Excel',attrs:{type:'button'},
        on:{click:()=>void download('budget')}}),message));
    await renderBudget(root,ctx,round,()=>renderRound(root,ctx));
    return;
  }
  const reserveForm = h('form', { on: { submit: event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amountCents = parseEuros(data.get('amount'));
    if (!amountCents || amountCents <= 0) { message.textContent = 'Introdueix un import positiu.'; return; }
    void action(`/api/finance/rounds/${round.id}/reserve-operations`,
      { kind: data.get('kind'), amountCents });
  } } },
  h('label', { text: 'Moviment de reserva ' }, h('select', { attrs: { name: 'kind' } },
    h('option', { text: 'Aportació', attrs: { value: 'CONTRIBUTION' } }),
    h('option', { text: 'Aplicació', attrs: { value: 'APPLICATION' } }))),
  h('label', { text: 'Import en euros ' }, h('input', { attrs: { name: 'amount', inputmode: 'decimal', required: true } })),
  h('button', { className: 'btn btn-secondary', text: 'Registra', attrs: { type: 'submit' } }));
  const actions = [];
  if (caps.manageRounds && round.status === 'OPEN') actions.push(h('button', { className: 'btn btn-secondary',
    text: 'Inicia el tancament', attrs: { type: 'button' },
    on: { click: () => void action(`/api/finance/rounds/${round.id}/closing`, { expectedVersion: round.version }) } }));
  if (caps.manageRounds && round.status === 'CLOSING') actions.push(h('button', { className: 'btn btn-secondary',
    text: 'Torna a obrir', attrs: { type: 'button' },
    on: { click: () => void action(`/api/finance/rounds/${round.id}/open`, { expectedVersion: round.version }) } }));
  if (caps.closeRounds && round.status === 'CLOSING') actions.push(h('button', { className: 'btn btn-primary',
    text: 'Tanca la ronda oficialment', attrs: { type: 'button' },
    on: { click: () => { if (window.confirm('El resultat oficial quedarà fixat i no es podrà reescriure. Vols tancar la ronda?'))
      void action(`/api/finance/rounds/${round.id}/close`, { expectedVersion: round.version }); } } }));
  const official = detail.officialClose;
  root.replaceChildren(
    h('section', { className: 'activity-surface treasury-block' },
      h('h2', { className: 'block-title', text: `Ronda ${round.code}` }),
      h('p', { text: `Estat: ${round.status === 'OPEN' ? 'Oberta' : round.status === 'CLOSING' ? 'En tancament' :
        round.status === 'CLOSED' ? 'Tancada' : 'Esborrany'}` }),
      line('Ingressos reconeguts', result.incomeCents), line('Despeses reconegudes', result.expenseNetCents),
      line('Resultat abans de reserves', result.resultBeforeReservesCents),
      line('Aportacions a la reserva general', result.reserveContributionCents),
      line('Aplicacions de la reserva general', result.reserveApplicationCents),
      line('Resultat després de reserves', result.resultAfterReservesCents),
      official ? h('div', { className: 'treasury-block-plain' },
        h('h3', { text: 'Tancament oficial' }),
        line('Resultat oficial', official.resultCents), line('Resultat final oficial', official.resultAfterReservesCents),
        line('Reserva general final', official.reservesFinalCents)) : null,
      detail.postClose ? h('div', { className: 'treasury-block-plain' },
        h('h3', { text: 'Després del tancament' }),
        line('Ajustos posteriors', detail.postClose.resultDeltaCents),
        line('Resultat actual ajustat', detail.postClose.adjustedResultAfterReservesCents),
        ...detail.postClose.adjustments.map(item => line(item.kind === 'LATE_INCOME' ? 'Ingrés tardà' : 'Correcció', item.amountCents))) : null,
      h('div',{className:'form-actions'},
        caps.read ? h('button',{className:'btn btn-secondary',text:'Descarrega resultat Excel',attrs:{type:'button'},
          on:{click:()=>void download('result')}}) : null,
        caps.readBudget ? h('button',{className:'btn btn-secondary',text:'Descarrega pressupost Excel',attrs:{type:'button'},
          on:{click:()=>void download('budget')}}) : null),
      caps.manageRounds && ['OPEN', 'CLOSING'].includes(round.status) ? reserveForm : null,
      actions.length ? h('div', { className: 'form-actions' }, actions) : null,
      message));
  if (caps.readBudget) await renderBudget(root, ctx, round, () => renderRound(root, ctx));
}
