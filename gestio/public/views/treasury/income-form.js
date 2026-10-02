// Tresoreria · Nou ingrés (3.5G.2A extension): manual (pending reconciliation, no movement invented) or from
// an incoming movement (Classifica → Crea un ingrés: created and reconciled in one step, counted once).
import { h, toast } from '../../ui.js';
import { budgetLineButton, counterpartyChooser, field, moneyInput, openDrawer, showErrors } from './forms.js';
import { canManageIncomes, centsInput, errorCopy, formatDay, formatEur, today, validateIncome } from './model.js';

/** @param {{ctx: any, movement?: any, onDone?: (created: {id: string}) => any}} options */
export async function openIncomeForm({ ctx, movement = null, onDone }) {
  const round = ctx.summary()?.round;
  if (!round) { toast('No hi ha cap ronda econòmica oberta.', { tone: 'danger' }); return; }
  if (!canManageIncomes(ctx.caps())) { toast('No tens permís per fer aquesta acció.', { tone: 'danger' }); return; }
  let lines, counterparties;
  try {
    [lines, counterparties] = await Promise.all([
      ctx.call(`/api/finance/rounds/${round.id}/assignable-lines?nature=INCOME`).then(data => data.lines),
      ctx.call('/api/finance/counterparties').then(data => data.counterparties)]);
  } catch (error) { toast(errorCopy(error), { tone: 'danger' }); return; }
  if (!lines.some(line => line.assignable)) { toast('El pressupost d’esta ronda no té partides d’ingressos assignables.', { tone: 'danger' }); return; }
  const available = movement ? movement.unallocatedCents : null;
  const concept = h('input', { attrs: { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Ex.: Subvenció Ajuntament, Venda loteria' } });
  const date = h('input', { attrs: { type: 'date', value: movement?.operationDate ?? today() } });
  const money = moneyInput(movement ? centsInput(available) : '', { 'aria-label': 'Import' });
  const line = budgetLineButton({ lines, emptyText: 'Tria una partida d’ingressos' });
  const counterparty = counterpartyChooser({ call: ctx.call, counterparties, allowCreate: true, label: 'Qui aporta els diners (opcional)' });
  const content = [
    movement ? h('p', { className: 'form-notice', text: `Moviment de ${formatDay(movement.operationDate)} · ${movement.positionName} · ${formatEur(movement.amountCents, { signed: true })}. L’ingrés quedarà conciliat amb aquest moviment.` })
      : h('p', { className: 'form-notice', text: 'L’ingrés quedarà pendent de conciliar fins que el vincules amb el moviment bancari.' }),
    h('div', { className: 'form-section' },
      field('concept', 'Concepte', concept, { required: true }),
      h('div', { className: 'field-row' }, field('incomeDate', 'Data', date, { required: true }),
        field('total', 'Import', money, { required: true, hint: movement ? `Màxim ${formatEur(available)} (pendent del moviment).` : null })),
      field('budgetLineId', 'Partida d’ingressos', line.node, { required: true }),
      counterparty.node)];
  const drawer = openDrawer({ title: movement ? 'Nou ingrés des del moviment' : 'Nou ingrés', content, primary: movement ? 'Crea i concilia' : 'Crea l’ingrés', onSubmit: async () => {
    const result = validateIncome({ concept: concept.value, incomeDate: date.value, total: money.querySelector('input').value, budgetLineId: line.value,
      counterpartyId: counterparty.value }, { roundId: round.id, maxCents: available });
    if (!showErrors(drawer.submit.form, result.errors)) { drawer.showError('Revisa els camps marcats.'); return false; }
    let created;
    if (movement) {
      const response = await ctx.call(`/api/finance/movements/${movement.id}/income`, { method: 'POST',
        body: JSON.stringify({ expectedVersion: movement.allocationVersion, ...result.body }) });
      created = { id: response.incomeId };
    } else created = await ctx.call('/api/finance/incomes', { method: 'POST', body: JSON.stringify(result.body) });
    toast(movement ? 'Ingrés creat i conciliat' : 'Ingrés creat'); await onDone?.(created); return true;
  } });
}
