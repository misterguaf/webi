// FASE 3.5I — explainable suggestions for one bank movement (imported from C43 or otherwise). Read-only:
// nothing here classifies, reconciles or marks a quota as paid. Each suggestion says why it was made, and a person
// confirms it through the existing allocation endpoints (with all their guards). Rules:
// - budget lines come from the budget of the round whose period contains the movement date (no fixed catalogue);
//   quota and activity lines are excluded (their income is recognised through FEE_PAYMENT / ACTIVITY_PAYMENT);
// - several equally good candidates are shown as ambiguous, never chosen;
// - a name match needs the participant's name and surname in the bank text; the bank text itself is never returned.
import { authorize } from '../../policy.js';
import { requireUuid, validUuid } from '../../services/common.js';
import { allow, notFound } from './shared.js';

const STOP = new Set(['de', 'del', 'la', 'el', 'els', 'les', 'los', 'las', 'i', 'y', 'a', 'en', 'per', 'por', 'pel', 'para', 'amb', 'con',
  'al', 'un', 'una', 'que', 'ref', 'num', 'sl', 'sa', 'slu', 'transferencia', 'transferencias', 'bizum', 'recibo', 'rebut', 'ingreso', 'ingres',
  'pago', 'pagament', 'cargo', 'abono', 'concepto', 'concepte', 'ficticia', 'fictici', 'ficticio', 'sintetic', 'demo', 'familia', 'familias']);
// Spanish ↔ Valencian spellings found in bank texts, folded to one form. Language only: not a list of budget lines.
const FOLD = new Map(Object.entries({ navidad: 'nadal', pascua: 'pasqua', verano: 'estiu', cuota: 'quota', cuotas: 'quota', quotes: 'quota',
  autocar: 'autobus', autocares: 'autobus', autobuses: 'autobus', suministros: 'suministres', subministraments: 'suministres',
  seguro: 'asseguranca', seguros: 'asseguranca', campamento: 'campament', campamentos: 'campament', campaments: 'campament',
  material: 'material', loteria: 'loteria', comision: 'comissio', comisiones: 'comissio', comissions: 'comissio', alquiler: 'lloguer',
  albergue: 'alberg', comida: 'menjar', curso: 'curs', cursos: 'curs', uniforme: 'roba', uniformes: 'roba', camisetas: 'roba', panoletes: 'roba' }));
export function tokens(text) {
  return [...new Set(String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word)).map(word => FOLD.get(word) ?? word))];
}
const has = (words, list) => list.some(word => words.includes(word));

/** Kind of economic fact the movement probably is, from the C43 common concept and the bank text. */
function nature(amountCents, common, words, transfer) {
  if (transfer) return { kind: 'INTERNAL_TRANSFER', reason: 'Hi ha un moviment d’una altra posició pròpia amb l’import contrari i data propera.' };
  if (has(words, ['traspaso', 'traspas', 'propia', 'propi'])) return { kind: 'INTERNAL_TRANSFER', reason: 'El concepte indica un traspàs entre comptes propis.' };
  if (common === '11') return { kind: 'INTERNAL_TRANSFER', reason: 'Retirada o ingrés en caixer: sol ser un moviment cap a la caixa en efectiu.' };
  if (amountCents < 0 && (common === '12' || (has(words, ['tarjeta', 'targeta']) && has(words, ['liquidacion', 'liquidacio']))))
    return { kind: 'CARD_SETTLEMENT', reason: 'Liquidació de targeta: les despeses ja es registren per targeta; no és una despesa nova.' };
  if (common === '14' || has(words, ['devolucion', 'devolucio', 'devol', 'reembolso', 'reemborsament']))
    return { kind: amountCents > 0 ? 'REFUND_RECEIVED' : 'REFUND_PAID', reason: 'El concepte indica una devolució: no és un ingrés o una despesa ordinària.' };
  if (common === '17') return { kind: 'BANK_CHARGES', reason: 'Interessos, comissions o despeses bancàries.' };
  if (amountCents > 0 && has(words, ['quota'])) return { kind: 'FEE', reason: 'El concepte parla d’una quota.' };
  return amountCents > 0 ? { kind: 'INCOME', reason: 'Abonament sense indicis d’un altre tipus.' } : { kind: 'EXPENSE', reason: 'Càrrec sense indicis d’un altre tipus.' };
}

/** Best budget leaf of the round for the bank text, or the tied candidates when several are equally good. */
function budgetLineSuggestion(lines, words, nature) {
  const byId = new Map(lines.map(line => [line.id, line]));
  const parents = new Set(lines.map(line => line.parentId).filter(Boolean));
  // Words that name a heading of this budget (Campament de Nadal, Campament d’Estiu…): when the text names one,
  // only lines under that heading are compatible. A Christmas bus is never suggested as a summer bus.
  const headingWords = new Set(lines.filter(line => parents.has(line.id) && line.nature === nature).flatMap(line => tokens(line.name)));
  const scored = [];
  for (const line of lines) {
    if (parents.has(line.id) || line.status !== 'ACTIVE' || line.nature !== nature || line.economicGroup === 'ANNUAL_FEES' || line.activityId) continue;
    const path = []; for (let node = line, guard = 0; node && guard < 10; guard++) { path.unshift(node); node = node.parentId ? byId.get(node.parentId) : null; }
    const own = tokens(line.name).filter(word => words.includes(word));
    if (!own.length) continue;
    const pathWords = new Set(path.flatMap(node => tokens(node.name)));
    if (words.some(word => headingWords.has(word) && !pathWords.has(word))) continue;
    const above = [...new Set(path.slice(0, -1).flatMap(node => tokens(node.name)))].filter(word => words.includes(word) && !own.includes(word));
    scored.push({ id: line.id, code: line.code, path: path.map(node => node.name), score: 2 * own.length + above.length, matched: [...own, ...above] });
  }
  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  if (!scored.length) return { line: null, alternatives: [] };
  const best = scored.filter(item => item.score === scored[0].score);
  const describe = item => ({ id: item.id, code: item.code, path: item.path, reasons: [`Paraules del concepte que coincideixen: ${item.matched.join(', ')}.`] });
  return best.length === 1 ? { line: describe(best[0]), alternatives: [] } : { line: null, alternatives: best.slice(0, 5).map(describe) };
}

/** Participants whose name and at least one surname appear in the text. */
const nameMatch = (name, words) => {
  const parts = tokens(name);
  const hits = parts.filter(part => words.includes(part));
  return parts.length >= 2 && hits.length >= 2 && words.includes(parts[0]) ? hits : null;
};

export async function movementSuggestions(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  const movement = await db.prepare(`SELECT m.id,m.position_id AS positionId,m.operation_date AS date,m.amount_cents AS amountCents,
      m.allocation_version AS allocationVersion,m.state,p.kind AS positionKind,COALESCE(b.unallocated_cents,abs(m.amount_cents)) AS unallocatedCents,
      d.original_text AS text,k.common_concept AS common
    FROM finance_movement m JOIN finance_position p ON p.id=m.position_id
    LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id
    LEFT JOIN finance_movement_description d ON d.movement_id=m.id
    LEFT JOIN finance_movement_bank_detail k ON k.movement_id=m.id WHERE m.id=?`).bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  const empty = { suggestionOnly: true, movementId: id, allocationVersion: movement.allocationVersion };
  if (movement.state !== 'ACTIVE' || movement.unallocatedCents <= 0)
    return { ...empty, round: null, nature: null, budgetLine: null, alternatives: [], matches: [], transfer: null, ambiguous: false, notes: ['El moviment ja està classificat o anul·lat.'] };
  const words = tokens(movement.text ?? '');
  const notes = [];
  if (!movement.text) notes.push('Este moviment no té concepte bancari: només es pot suggerir per import i data.');

  // The round is decided by the period that contains the date; several or none leave it to a person.
  const rounds = (await db.prepare(`SELECT id,code,status,annual_fee_round_id AS feeRoundId FROM finance_round
    WHERE period_start<=? AND period_end>=? AND status!='CLOSED' ORDER BY period_start`).bind(movement.date, movement.date).all()).results;
  const round = rounds.length === 1 ? { status: 'ONE', id: rounds[0].id, code: rounds[0].code } :
    { status: rounds.length ? 'MANY' : 'NONE', id: null, code: null, choices: rounds.map(row => ({ id: row.id, code: row.code })) };
  if (round.status !== 'ONE') notes.push(rounds.length ? 'La data cau en més d’una ronda oberta: tria-la tu.' : 'Cap ronda oberta conté esta data: cal decidir a quina ronda pertany.');

  const transfer = (await db.prepare(`SELECT m.id,m.operation_date AS date,p.name AS positionName,m.allocation_version AS allocationVersion
    FROM finance_movement m JOIN finance_position p ON p.id=m.position_id LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id
    WHERE m.position_id!=? AND m.amount_cents=? AND m.state='ACTIVE' AND COALESCE(b.allocated_cents,0)=0
      AND abs(julianday(m.operation_date)-julianday(?))<=3 ORDER BY abs(julianday(m.operation_date)-julianday(?)),m.id LIMIT 3`)
    .bind(movement.positionId, -movement.amountCents, movement.date, movement.date).all()).results;
  const pair = transfer.length === 1 ? transfer[0] : null;
  if (transfer.length > 1) notes.push('Hi ha diversos moviments d’altres posicions amb l’import contrari: revisa quin és el traspàs.');
  const kind = nature(movement.amountCents, movement.common, words, pair);

  // Budget line of the round (income or expense leaves only), when the round is clear.
  let budget = { line: null, alternatives: [] };
  if (round.status === 'ONE' && ['INCOME', 'EXPENSE', 'BANK_CHARGES'].includes(kind.kind)) {
    // Every line of the round shapes the tree (a heading with inactive children is still a heading, never assignable).
    const lines = (await db.prepare(`SELECT id,code,name,parent_id AS parentId,nature,status,economic_group AS economicGroup,activity_id AS activityId
      FROM finance_budget_line WHERE round_id=?`).bind(round.id).all()).results;
    budget = budgetLineSuggestion(lines, words, kind.kind === 'INCOME' ? 'INCOME' : 'EXPENSE');
    if (!budget.line) notes.push(budget.alternatives.length ? 'Diverses partides encaixen igual de bé: tria-la tu.' : 'Cap partida del pressupost d’esta ronda encaixa: queda pendent de classificar.');
  }

  // Family payments: verified quota payments and activity payments still to reconcile, matched by amount and name.
  const matches = [];
  const names = (await authorize(db, context, { permission: 'finance.fee.read', mode: 'all-sections' })).allow;
  const treasury = (await authorize(db, context, { permission: 'finance.treasury.read' })).allow;
  if (treasury && movement.positionKind === 'BANK' && movement.amountCents > 0 && ['FEE', 'INCOME'].includes(kind.kind)) {
    const fees = (await db.prepare(`SELECT p.id,r.code AS roundCode,
      (SELECT COALESCE(sum(a.amount_cents),0) FROM annual_fee_allocation a WHERE a.payment_id=p.id)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o WHERE o.fee_payment_id=p.id AND o.cause='PRICE_CORRECTION'),0)
        -COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='FEE_PAYMENT' AND a.fee_payment_id=p.id),0) AS outstandingCents,
      p.submitted_by_name AS payer,
      (SELECT group_concat(pt.display_name,'|') FROM annual_fee_allocation a JOIN annual_fee_obligation ob ON ob.id=a.obligation_id
        JOIN participant pt ON pt.id=ob.participant_id WHERE a.payment_id=p.id) AS participants
      FROM annual_fee_payment p JOIN annual_fee_round r ON r.id=p.round_id JOIN finance_round fr ON fr.annual_fee_round_id=p.round_id
      WHERE p.review_status='VERIFIED' AND p.verified_amount_cents IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=p.id AND i.status='OPEN') LIMIT 400`).all()).results
      .filter(row => row.outstandingCents > 0);
    for (const fee of fees) {
      const people = String(fee.participants ?? '').split('|').filter(Boolean);
      const byName = people.map(name => ({ name, hits: nameMatch(name, words) })).filter(item => item.hits);
      const payer = nameMatch(fee.payer ?? '', words);
      const exact = fee.outstandingCents === movement.unallocatedCents;
      if (!byName.length && !payer) continue;
      const reasons = [...byName.map(item => names ? `Nom de l’educand al concepte: ${item.name}.` : 'Nom d’un educand de la quota al concepte.'),
        ...(payer ? ['Nom de qui va enviar el justificant al concepte.'] : []), exact ? 'Import idèntic al pendent de la quota.' : 'Import diferent del pendent: revisa’l.'];
      matches.push({ type: 'FEE_PAYMENT', id: fee.id, roundCode: fee.roundCode, outstandingCents: fee.outstandingCents,
        amountCents: Math.min(fee.outstandingCents, movement.unallocatedCents), participants: names ? people : [],
        strength: exact && byName.length ? 'STRONG' : 'WEAK', reasons });
    }
    const activities = (await db.prepare(`SELECT pa.id,a.name AS activityName,p.display_name AS participant,
      pa.amount_cents-COALESCE((SELECT sum(x.amount_cents) FROM finance_allocation_current x
        WHERE x.kind='ACTIVITY_PAYMENT' AND x.activity_allocation_id=pa.id),0) AS outstandingCents
      FROM activity_payment_allocation pa JOIN activity_registration ar ON ar.id=pa.registration_id
      JOIN activity a ON a.id=ar.activity_id LEFT JOIN participant p ON p.id=ar.participant_id
      LEFT JOIN payment_evidence e ON e.id=pa.evidence_id
      WHERE ar.finance_round_id IS NOT NULL AND (pa.evidence_id IS NULL OR e.review_status='VERIFIED') LIMIT 400`).all()).results
      .filter(row => row.outstandingCents > 0);
    for (const activity of activities) {
      const hits = activity.participant ? nameMatch(activity.participant, words) : null;
      if (!hits) continue;
      const exact = activity.outstandingCents === movement.unallocatedCents;
      matches.push({ type: 'ACTIVITY_PAYMENT', id: activity.id, activityName: activity.activityName, participants: [activity.participant],
        outstandingCents: activity.outstandingCents, amountCents: Math.min(activity.outstandingCents, movement.unallocatedCents),
        strength: exact ? 'STRONG' : 'WEAK', reasons: [`Nom de l’educand al concepte: ${activity.participant}.`,
          exact ? 'Import idèntic al pendent de l’activitat.' : 'Import diferent del pendent: revisa’l.'] });
    }
    // Quotas by name: a family proof still to review, or no proof at all. Each proposal lists the obligations it would
    // cover; confirming runs the Quotes review and the bank link together (fee-reconciliation.js).
    const pending = (await db.prepare(`SELECT s.id,s.participant_id AS participantId,s.display_name AS name,s.family_group_id AS familyId,
        s.amount_due_cents-s.allocated_cents AS pendingCents,r.code AS roundCode,s.status
      FROM annual_fee_obligation_status s JOIN annual_fee_round r ON r.id=s.round_id
      JOIN finance_round fr ON fr.annual_fee_round_id=s.round_id WHERE fr.status!='CLOSED'`).all()).results;
    const allNamed = pending.filter(row => nameMatch(row.name, words));
    // A quota with an open issue in Quotes is resolved there first (the bank link would be refused anyway).
    for (const row of allNamed.filter(item => item.status === 'ISSUE'))
      notes.push(`${names ? `La quota de ${row.name}` : 'Una quota del concepte'} té una incidència oberta a Quotes: resol-la abans de conciliar-la.`);
    const named = allNamed.filter(row => row.status !== 'ISSUE');
    const proofs = (await db.prepare(`SELECT p.id,p.declared_amount_cents AS declaredCents,p.submitted_by_name AS payer,
        group_concat(COALESCE(s.participant_id,'?'),'|') AS people,sum(s.match_status NOT IN ('CLEAR','RESOLVED')) AS unresolved
      FROM annual_fee_payment p JOIN annual_fee_submission_person s ON s.payment_id=p.id
      WHERE p.origin='FAMILY' AND p.verified_amount_cents IS NULL AND p.review_status IN ('PENDING_REVIEW','ISSUE')
      GROUP BY p.id LIMIT 400`).all()).results;
    const covered = new Set();
    const distribute = rows => { let left = movement.unallocatedCents;
      return rows.filter(row => row.pendingCents > 0).map(row => { const amountCents = Math.min(row.pendingCents, left); left -= amountCents;
        return { obligationId: row.id, amountCents, name: row.name }; }).filter(row => row.amountCents > 0); };
    for (const proof of proofs) {
      const people = String(proof.people).split('|');
      const rows = pending.filter(row => people.includes(row.participantId));
      const byName = rows.filter(row => named.includes(row));
      const payer = nameMatch(proof.payer ?? '', words);
      if (!byName.length && !payer) continue;
      rows.forEach(row => covered.add(row.participantId));
      const allocations = distribute(rows);
      const sum = rows.reduce((total, row) => total + Math.max(row.pendingCents, 0), 0);
      const exact = sum > 0 && (movement.unallocatedCents === sum || movement.unallocatedCents === proof.declaredCents);
      matches.push({ type: 'FEE_PROOF', id: proof.id, paymentId: proof.id, roundCode: rows[0]?.roundCode ?? null, allocations: names ? allocations : allocations.map(({ name, ...rest }) => rest),
        amountCents: allocations.reduce((total, row) => total + row.amountCents, 0), outstandingCents: sum, participants: names ? rows.map(row => row.name) : [],
        needsMatchReview: proof.unresolved > 0, strength: exact && byName.length && !proof.unresolved && allocations.length ? 'STRONG' : 'WEAK',
        reasons: [...byName.map(row => names ? `Nom de l’educand al concepte: ${row.name}.` : 'Nom d’un educand al concepte.'),
          ...(payer ? ['Nom de qui va enviar el justificant al concepte.'] : []), 'Hi ha un justificant de la família pendent de revisar: es conserva.',
          exact ? 'Import idèntic al de les quotes pendents.' : 'Import diferent del pendent: revisa’l.',
          ...(proof.unresolved ? ['Primer cal resoldre a Quotes la identificació d’algun infant del justificant.'] : []),
          ...(!allocations.length ? ['Les quotes del justificant ja estan cobertes: pot ser un pagament repetit.'] : [])] });
    }
    // No proof: the named educands' pending quotas, together with their siblings when the amount is the family's.
    const families = new Map();
    for (const row of named.filter(item => !covered.has(item.participantId) && item.pendingCents > 0)) {
      const key = row.familyId ?? row.id;
      if (!families.has(key)) families.set(key, { named: [], all: row.familyId ? pending.filter(item => item.familyId === row.familyId && item.pendingCents > 0
        && item.status !== 'ISSUE' && !covered.has(item.participantId)) : [row] });
      families.get(key).named.push(row);
    }
    for (const family of families.values()) {
      const sum = list => list.reduce((total, row) => total + row.pendingCents, 0);
      const whole = family.all.length > family.named.length && sum(family.all) === movement.unallocatedCents;
      const rows = whole ? family.all : family.named;
      const allocations = distribute(rows);
      const exact = sum(rows) === movement.unallocatedCents;
      matches.push({ type: 'FEE_OBLIGATION', id: rows.map(row => row.id).join(','), roundCode: rows[0].roundCode,
        allocations: names ? allocations : allocations.map(({ name, ...rest }) => rest), amountCents: allocations.reduce((total, row) => total + row.amountCents, 0),
        outstandingCents: sum(rows), participants: names ? rows.map(row => row.name) : [], strength: exact ? 'STRONG' : 'WEAK',
        reasons: [...family.named.map(row => names ? `Nom de l’educand al concepte: ${row.name}.` : 'Nom d’un educand al concepte.'),
          ...(whole ? ['L’import és el de totes les quotes pendents de la família (germans).'] : []),
          'No hi ha justificant: es registrarà el pagament a Quotes a partir d’este moviment bancari.',
          exact ? 'Import idèntic al de les quotes pendents.' : movement.unallocatedCents > sum(rows)
            ? 'L’import és superior al pendent: la resta del moviment quedarà pendent de classificar.' : 'Pagament parcial: la quota quedarà parcialment pagada.'] });
    }
    // Quotas already recognised: never paid twice; the movement waits for a person.
    for (const row of named.filter(item => item.pendingCents <= 0 && !matches.some(match => match.type === 'FEE_PAYMENT' && match.participants.includes(item.name))))
      notes.push(`${names ? `La quota de ${row.name}` : 'La quota d’un educand del concepte'} ja està reconeguda: este moviment pot ser un pagament repetit i queda pendent de revisió.`);
    if (kind.kind === 'FEE' && !matches.length && !named.length)
      notes.push('No s’ha trobat cap quota amb el nom del concepte: queda pendent de classificar.');
  }
  // Recognised bank expenses still to settle with exactly this amount: settling one never creates a second expense.
  let expenses = [];
  if (movement.amountCents < 0 && ['EXPENSE', 'BANK_CHARGES'].includes(kind.kind)) {
    expenses = (await db.prepare(`SELECT e.id,e.expense_date AS date,COALESCE(e.concept,e.supplier_label,'Despesa') AS label,
      e.total_cents-COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='EXPENSE_SETTLEMENT' AND a.expense_id=e.id),0) AS outstandingCents
      FROM finance_expense e WHERE e.status='RECOGNISED' AND e.payment_method='BANK'
      ORDER BY abs(julianday(e.expense_date)-julianday(?)),e.id LIMIT 200`).bind(movement.date).all()).results
      .filter(row => row.outstandingCents === movement.unallocatedCents).slice(0, 5);
    for (const expense of expenses) matches.push({ type: 'EXPENSE_SETTLEMENT', id: expense.id, label: expense.label, date: expense.date,
      outstandingCents: expense.outstandingCents, amountCents: expense.outstandingCents, strength: expenses.length === 1 ? 'STRONG' : 'WEAK',
      reasons: ['Despesa ja reconeguda, pagada per banc, amb el mateix import pendent.'] });
    if (!expenses.length) notes.push('No hi ha cap despesa reconeguda amb este import: registra-la amb el seu justificant abans de conciliar-la.');
  }
  const strong = matches.filter(item => item.strength === 'STRONG');
  const ambiguous = strong.length > 1 || (!strong.length && matches.length > 1);
  if (ambiguous) notes.push('Hi ha més d’una coincidència possible: no se n’ha triat cap. Revisa-les una a una.');
  return { ...empty, round, nature: kind, budgetLine: budget.line, alternatives: budget.alternatives,
    matches: matches.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'STRONG' ? -1 : 1)).slice(0, 10),
    transfer: pair ? { id: pair.id, date: pair.date, positionName: pair.positionName, allocationVersion: pair.allocationVersion } : null,
    ambiguous, notes };
}
