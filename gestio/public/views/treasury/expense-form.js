// Tresoreria · Nova despesa (3.5G.2A): manual, or from an outgoing movement (Classifica → És una despesa).
// From a movement the server creates one recognised expense and its settlement in one step, so the
// expense counts once. The split must balance before it can be confirmed.
import { h, toast } from '../../ui.js';
import { counterpartyChooser, field, lineSplit, moneyInput, openDrawer, showErrors } from './forms.js';
import { canManageExpenses, centsInput, errorCopy, formatDay, formatEur, parseEuros, today, validateExpense } from './model.js';

export async function receiptPayload(file) {
  if (!file) return null;
  if (file.size > 4 * 1024 * 1024) throw new Error('El justificant supera el límit de 4 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { filename: file.name, mime: file.type, dataBase64: btoa(binary) };
}

/** @param {{ctx: any, movement?: any, onDone?: (created: {id: string}) => any}} options */
export async function openExpenseForm({ ctx, movement = null, onDone }) {
  const round = ctx.summary()?.round;
  if (!round) { toast('No hi ha cap ronda econòmica oberta.', { tone: 'danger' }); return; }
  if (!canManageExpenses(ctx.caps())) { toast('No tens permís per fer aquesta acció.', { tone: 'danger' }); return; }
  let lines, counterparties;
  try {
    [lines, counterparties] = await Promise.all([
      ctx.call(`/api/finance/rounds/${round.id}/assignable-lines?nature=EXPENSE`).then(data => data.lines),
      ctx.call('/api/finance/counterparties').then(data => data.counterparties)]);
  } catch (error) { toast(errorCopy(error), { tone: 'danger' }); return; }
  if (!lines.some(line => line.assignable)) { toast('El pressupost d’esta ronda no té línies de despesa assignables.', { tone: 'danger' }); return; }

  const manual = !movement;
  const available = movement ? movement.unallocatedCents : null;
  const concept = h('input', { attrs: { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Ex.: Material de campament' } });
  const date = h('input', { attrs: { type: 'date', value: movement?.operationDate ?? today() } });
  const totalMoney = moneyInput(movement ? centsInput(available) : '', { 'aria-label': 'Import total' });
  const totalInput = totalMoney.querySelector('input');
  const totalCents = () => parseEuros(totalInput.value) ?? 0;
  const split = lineSplit({ lines, total: totalCents });
  totalInput.addEventListener('input', () => split.refresh());
  const counterparty = counterpartyChooser({ call: ctx.call, counterparties, allowCreate: true, label: 'Proveïdor o tercer' });
  const method = h('select', {}, [
    h('option', { text: 'El grup · compte o targeta de dèbit', attrs: { value: 'BANK' } }),
    h('option', { text: 'Un scouter amb els seus diners', attrs: { value: 'ADVANCED' } })]);
  const advanced = counterpartyChooser({ call: ctx.call, counterparties, allowCreate: true, kind: 'PERSON', label: 'Qui ha avançat els diners', optional: false, name: 'advancedById' });
  const recognise = h('input', { attrs: { type: 'checkbox' } });
  const receipt = h('input', { attrs: { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp' } });
  const recogniseRow = h('div', { className: 'form-field', dataset: { field: 'recognise' } },
    h('label', { className: 'checkbox-row' }, recognise, h('span', { text: 'Reconeix la despesa i, si l’ha avançada un scouter, aprova el reemborsament' })),
    h('p', { className: 'field-hint', text: 'Si no la reconeixes, queda com a proposta i no compta en les xifres fins que algú la reconega.' }));
  const syncMethod = () => {
    const isAdvanced = method.value === 'ADVANCED';
    advanced.node.hidden = !isAdvanced;
  };
  method.addEventListener('change', syncMethod);
  const content = [
    movement ? h('p', { className: 'form-notice', text: `Moviment de ${formatDay(movement.operationDate)} · ${movement.positionName} · ${formatEur(movement.amountCents, { signed: true })}. Es crearà una despesa reconeguda i quedarà pagada amb aquest moviment.` }) : null,
    h('div', { className: 'form-section' },
      field('concept', 'Concepte', concept, { required: true }),
      h('div', { className: 'field-row' }, field('expenseDate', 'Data', date, { required: true }),
        field('total', 'Import total', totalMoney, { required: true, hint: movement ? `Màxim ${formatEur(available)} (pendent del moviment).` : null })),
      manual ? field('paymentMethod', 'Qui ho ha pagat?', method, { required: true,
        hint: 'La targeta del grup és de dèbit: els seus càrrecs apareixen al compte bancari.' }) : null,
      manual ? advanced.node : null,
      counterparty.node),
    h('div', { className: 'form-section' }, h('h3', { className: 'form-section-title', text: 'Repartiment entre línies del pressupost' }),
      h('div', { className: 'form-field', dataset: { field: 'lines' } }, split.node, h('p', { className: 'field-error', attrs: { hidden: true } }))),
    field('evidence', 'Justificant', receipt, { required: !!movement,
      hint: 'PDF o imatge, fins a 4 MB. És obligatori per reconéixer la despesa.' }),
    manual ? recogniseRow : null];
  if (manual) syncMethod();
  const drawer = openDrawer({ title: movement ? 'Nova despesa des del moviment' : 'Nova despesa', content, primary: movement ? 'Crea i classifica' : 'Crea la despesa', onSubmit: async () => {
    const values = { concept: concept.value, expenseDate: date.value, total: totalInput.value, lines: split.values(), counterpartyId: counterparty.value,
      paymentMethod: manual ? method.value : undefined, advancedById: manual ? advanced.value : undefined };
    const result = validateExpense(values, { roundId: round.id, manual });
    if (movement && !result.errors.total && totalCents() > available) result.errors.total = 'L’import assignat supera l’import disponible del moviment.';
    if (!showErrors(drawer.submit.form, result.errors)) { drawer.showError('Revisa els camps marcats.'); return false; }
    if ((movement || recognise.checked) && !receipt.files?.[0]) { drawer.showError('Adjunta un justificant abans de reconéixer la despesa.'); return false; }
    let evidence;
    try { evidence = await receiptPayload(receipt.files?.[0]); }
    catch (error) { drawer.showError(error.message); return false; }
    let created;
    if (movement) {
      const response = await ctx.call(`/api/finance/movements/${movement.id}/expense`, { method: 'POST',
        body: JSON.stringify({ expectedVersion: movement.allocationVersion, ...result.body, evidence }) });
      created = { id: response.expenseId };
    } else {
      created = await ctx.call('/api/finance/expenses', { method: 'POST', body: JSON.stringify({ ...result.body,
        ...(recognise.checked ? { recognise: true } : {}), ...(evidence ? { evidence } : {}) }) });
    }
    toast('Despesa creada'); await onDone?.(created); return true;
  } });
}

/** Draft edits stay ordinary; recognised edits use the same fields with a required short reason. */
export async function openExpenseEdit({ ctx, data, onDone }) {
  if (!canManageExpenses(ctx.caps())) { toast('No tens permís per fer aquesta acció.', { tone: 'danger' }); return; }
  const expense = data.expense;
  if (!['PROPOSED', 'RECOGNISED'].includes(expense.status)) return;
  let lines, counterparties;
  try {
    [lines, counterparties] = await Promise.all([
      ctx.call(`/api/finance/rounds/${expense.roundId}/assignable-lines?nature=EXPENSE`).then(result => result.lines),
      ctx.call('/api/finance/counterparties').then(result => result.counterparties)]);
  } catch (error) { toast(errorCopy(error), { tone: 'danger' }); return; }
  const concept = h('input', { attrs: { type: 'text', maxlength: 120, value: expense.concept ?? '', autocomplete: 'off' } });
  const date = h('input', { attrs: { type: 'date', value: expense.expenseDate } });
  const totalMoney = moneyInput(centsInput(expense.totalCents), { 'aria-label': 'Import total' });
  const total = totalMoney.querySelector('input');
  const split = lineSplit({ lines, total: () => parseEuros(total.value) ?? 0,
    initial: data.lines.map(line => ({ budgetLineId: line.budgetLineId, amount: centsInput(line.amountCents), label: line.budgetLine })) });
  total.addEventListener('input', () => split.refresh());
  const method = h('select', {}, [
    h('option', { text: 'El grup · compte o targeta de dèbit', attrs: { value: 'BANK', selected: expense.paymentMethod === 'BANK' } }),
    h('option', { text: 'Un scouter amb els seus diners', attrs: { value: 'ADVANCED', selected: expense.paymentMethod === 'ADVANCED' } }),
    ...(['CARD', 'CASH'].includes(expense.paymentMethod) ? [h('option', { text: 'Mitjà històric', attrs: { value: expense.paymentMethod, selected: true } })] : [])]);
  const advanced = counterpartyChooser({ call: ctx.call, counterparties, value: expense.advancedById, allowCreate: true,
    kind: 'PERSON', label: 'Qui ha avançat els diners', optional: false, name: 'advancedById' });
  const counterparty = counterpartyChooser({ call: ctx.call, counterparties, value: expense.counterpartyId,
    allowCreate: true, label: 'Proveïdor o tercer' });
  const reason = expense.status === 'RECOGNISED' ? h('textarea', { attrs: { rows: 3, maxlength: 240,
    placeholder: 'Explica breument què s’ha corregit' } }) : null;
  const syncMethod = () => { advanced.node.hidden = method.value !== 'ADVANCED'; };
  method.addEventListener('change', syncMethod); syncMethod();
  const content = [
    expense.status === 'RECOGNISED' ? h('p', { className: 'form-notice', text: 'La correcció guardarà els valors anteriors a l’historial. Si hi ha un reemborsament conciliat, corregeix primer eixa conciliació.' }) : null,
    field('concept', 'Concepte', concept, { required: true }),
    h('div', { className: 'field-row' }, field('expenseDate', 'Data', date, { required: true }),
      field('total', 'Import total', totalMoney, { required: true })),
    field('paymentMethod', 'Qui ho ha pagat?', method, { required: true }), advanced.node, counterparty.node,
    h('div', { className: 'form-field', dataset: { field: 'lines' } }, h('span', { className: 'field-label', text: 'Repartiment entre línies del pressupost' }),
      split.node, h('p', { className: 'field-error', attrs: { hidden: true } })),
    reason ? field('reason', 'Motiu de la correcció', reason, { required: true }) : null];
  const drawer = openDrawer({ title: expense.status === 'PROPOSED' ? 'Edita la proposta' : 'Corregeix la despesa', content,
    primary: 'Guarda', onSubmit: async () => {
      const values = { concept: concept.value, expenseDate: date.value, total: total.value, lines: split.values(),
        counterpartyId: counterparty.value, paymentMethod: method.value, advancedById: advanced.value };
      const result = validateExpense(values, { roundId: expense.roundId, manual: true });
      if (reason && reason.value.trim().length < 3) result.errors.reason = 'Explica breument el motiu de la correcció.';
      if (!showErrors(drawer.submit.form, result.errors)) { drawer.showError('Revisa els camps marcats.'); return false; }
      await ctx.call(`/api/finance/expenses/${expense.id}`, { method: 'PATCH', body: JSON.stringify({ ...result.body,
        expectedVersion: expense.version, counterpartyId: counterparty.value,
        advancedById: method.value === 'ADVANCED' ? advanced.value : null,
        ...(reason ? { reason: reason.value.trim() } : {}) }) });
      toast(expense.status === 'PROPOSED' ? 'Proposta actualitzada' : 'Despesa corregida');
      await onDone?.(); return true;
    } });
}
