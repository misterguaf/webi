// Read-only bridge from canonical Treasury economics to the two traditional workbooks.
// Category/cell knowledge belongs to the workbook adapters; no accounting table stores Excel cells.
import { AppError, requireUuid } from '../../services/common.js';
import { allow } from './shared.js';
import { budgetTemplateModel } from './budget-xlsx-template.js';
import { TEMPLATE_SHEETS } from './treasury-xlsx-template.js';

const failMapping = () => { throw new AppError(409, 'treasury_export_mapping_missing'); };
const small = value => String(value ?? '').trim().slice(0,100) || 'Moviment';
const INCOME_DIRECT = Object.freeze({ '1.3':'D21','3.1':'D28','3.2':'D29','3.3':'D30','3.4':'D31' });
const EXPENSE_DIRECT = Object.freeze({
  '3.2':'J27','3.2.1':'J27','3.2.2':'J27','3.2.3':'J27','3.2.4':'J27',
  '3.3':'J28','4.1':'J30','4.2':'J31','4.3':'J32','4.4':'J33',
  '5.1':'J44','5.2':'J45','5.3':'J46','5.4':'J47','5.5':'J48','5.6':'J49','5.7':'J50'
});
const DETAIL = Object.freeze({ '2.1':'C. Navidad','2.2':'C. Pascua','2.3':'C. Verano','2.4':'SanJordi' });
const category = (nature, code) => {
  if (nature === 'INCOME') {
    if (code === '1.1') return { sheet:'Cuotas' };
    if (code === '1.2') return { sheet:'Lotería' };
    if (code === '1.4' || code === '4.1') return { sheet:'Otras' };
    if (INCOME_DIRECT[code]) return { cell:INCOME_DIRECT[code] };
  } else {
    if (code === '1.1') return { sheet:'Cuotas' };
    if (code === '3.1') return { sheet:'Lotería' };
    if (EXPENSE_DIRECT[code]) return { cell:EXPENSE_DIRECT[code] };
  }
  const prefix = code?.match(/^2\.\d+/)?.[0];
  if (DETAIL[prefix]) return { sheet:DETAIL[prefix] };
  return null;
};

export function resultTemplateModel(roundCode, entries, totals, resultDate) {
  const detail = Object.fromEntries(TEMPLATE_SHEETS.slice(1).map(name => [name,{income:[],expense:[]}]));
  const direct = {};
  let income = 0, expense = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.cents) || entry.cents < 0) throw new Error('invalid_treasury_export_amount');
    if (!entry.cents) continue;
    const kind = entry.nature === 'INCOME' ? 'income' : entry.nature === 'EXPENSE' ? 'expense' : null;
    if (!kind) throw new Error('invalid_treasury_export_model');
    const target = category(entry.nature,entry.code);
    if (!target) failMapping();
    if (kind === 'income') income += entry.cents; else expense += entry.cents;
    if (target.sheet) {
      detail[target.sheet][kind].push({date:entry.date,label:small(entry.label),cents:entry.cents});
      if (target.sheet === 'Otras') direct.D33=(direct.D33??0)+entry.cents;
    }
    else direct[target.cell]=(direct[target.cell]??0)+entry.cents;
  }
  if (income !== totals.incomeCents || expense !== totals.expenseCents)
    throw new AppError(409,'treasury_export_economics_mismatch');
  return { roundCode, resultDate, detail, direct };
}

async function requiredRound(db,roundId) {
  const row=await db.prepare(`SELECT id,code,period_end AS periodEnd,annual_fee_round_id AS feeRoundId,
    status,closed_at AS closedAt FROM finance_round WHERE id=?`).bind(requireUuid(roundId)).first();
  if (!row) throw new AppError(404,'not_found');
  return row;
}

export async function budgetWorkbookModel(db,context,requestId,roundId) {
  await allow(db,context,requestId,'finance.budget.read','finance_budget',roundId);
  const round=await requiredRound(db,roundId);
  const lines=(await db.prepare(`SELECT l.code,l.nature,l.planned_cents AS plannedCents,
      a.current_cents AS currentCents,
      EXISTS(SELECT 1 FROM finance_budget_line child WHERE child.parent_id=l.id) AS hasChildren
    FROM finance_budget_line l LEFT JOIN finance_budget_line_amount a ON a.line_id=l.id
    WHERE l.round_id=? ORDER BY l.nature,l.code`).bind(roundId).all()).results;
  if (!lines.length) throw new AppError(409,'treasury_export_budget_missing');
  try { return budgetTemplateModel(round.code,lines); }
  catch (error) {
    if (String(error?.message??'').startsWith('budget_template_unmapped_line:')) failMapping();
    throw error;
  }
}

export async function resultWorkbookModel(db,context,requestId,roundId) {
  await allow(db,context,requestId,'finance.treasury.read','finance_round',roundId);
  const round=await requiredRound(db,roundId);
  const totals=await db.prepare(`SELECT income_cents AS incomeCents,
    expense_gross_cents-expense_refund_cents AS expenseCents
    FROM finance_round_economics WHERE round_id=?`).bind(roundId).first();
  const entries=[];
  const general=(await db.prepare(`SELECT l.code,m.operation_date AS date,m.display_label AS label,a.amount_cents AS cents
    FROM finance_allocation_current a JOIN finance_budget_line l ON l.id=a.budget_line_id
    JOIN finance_movement m ON m.id=a.movement_id
    WHERE a.round_id=? AND a.kind='INCOME' ORDER BY m.operation_date,a.id`).bind(roundId).all()).results;
  for (const row of general) entries.push({...row,nature:'INCOME'});

  // The cap and claim subtraction exactly mirror finance_round_economics. Export one recognised
  // amount per verified fee payment; raw bank excess remains a refundable liability.
  if (round.feeRoundId) {
    const fees=(await db.prepare(`SELECT p.id,date(p.reviewed_at/1000,'unixepoch') AS date,
      min(COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FEE_PAYMENT' AND a.fee_payment_id=p.id),0),
        COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0)
          -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
            WHERE o.fee_payment_id=p.id AND o.cause='PRICE_CORRECTION'),0)) AS cents
      FROM annual_fee_payment p WHERE p.round_id=? ORDER BY p.reviewed_at,p.id`).bind(round.feeRoundId).all()).results;
    for (const row of fees) if (row.cents>0) entries.push({nature:'INCOME',code:'1.1',date:row.date,
      label:'Quota anual',cents:row.cents});
  }

  // An activity must have exactly one active INCOME budget leaf associated with its activity id;
  // its title is never guessed into a camp or section category.
  const activities=(await db.prepare(`SELECT ar.id,ar.activity_id AS activityId,a.name AS label,
      COALESCE((SELECT min(m.operation_date) FROM finance_allocation_current f
        JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
        JOIN finance_movement m ON m.id=f.movement_id
        WHERE f.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),date(a.starts_at/1000,'unixepoch')) AS date,
      max(0,min(COALESCE((SELECT sum(f.amount_cents) FROM finance_allocation_current f
        JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
        WHERE f.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),0),ar.expected_amount_cents)
      -min(COALESCE((SELECT sum(f.amount_cents) FROM finance_allocation_current f
        JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
        WHERE f.kind='FAMILY_REFUND' AND pa.registration_id=ar.id),0),
        COALESCE((SELECT sum(f.amount_cents) FROM finance_allocation_current f
          JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
          WHERE f.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),0))) AS cents
    FROM activity_registration ar JOIN activity a ON a.id=ar.activity_id
    WHERE ar.finance_round_id=? ORDER BY ar.id`).bind(roundId).all()).results;
  const activityLines=(await db.prepare(`SELECT activity_id AS activityId,code FROM finance_budget_line
    WHERE round_id=? AND nature='INCOME' AND status='ACTIVE' AND activity_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=finance_budget_line.id)`)
    .bind(roundId).all()).results;
  const linesByActivity=new Map();
  for (const line of activityLines) {
    if (!linesByActivity.has(line.activityId)) linesByActivity.set(line.activityId,[]);
    linesByActivity.get(line.activityId).push(line.code);
  }
  for (const row of activities) if (row.cents>0) {
    const codes=linesByActivity.get(row.activityId)??[];
    if (codes.length!==1) failMapping();
    entries.push({nature:'INCOME',code:codes[0],date:row.date,label:row.label,cents:row.cents});
  }

  const lines=(await db.prepare(`SELECT e.id,e.expense_date AS date,
    COALESCE(e.concept,e.supplier_label,'Despesa') AS label,e.total_cents AS totalCents,
    l.line_no AS lineNo,l.amount_cents AS cents,b.code,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
      WHERE a.kind='EXPENSE_REFUND' AND a.expense_id=e.id),0) AS refundCents
    FROM finance_expense e JOIN finance_expense_line l ON l.expense_id=e.id AND l.lines_version=e.lines_version
    JOIN finance_budget_line b ON b.id=l.budget_line_id
    WHERE e.round_id=? AND e.status='RECOGNISED' ORDER BY e.id,l.line_no`).bind(roundId).all()).results;
  for (let i=0;i<lines.length;) {
    const id=lines[i].id,group=[];
    while (i<lines.length && lines[i].id===id) group.push(lines[i++]);
    let assigned=0;
    group.forEach((line,index)=>{
      const refund=index===group.length-1 ? line.refundCents-assigned :
        Math.floor(line.refundCents*line.cents/line.totalCents);
      assigned+=refund;
      entries.push({nature:'EXPENSE',code:line.code,date:line.date,label:line.label,cents:line.cents-refund});
    });
  }
  const resultDate=round.closedAt ? new Date(round.closedAt).toISOString().slice(0,10) : round.periodEnd;
  return resultTemplateModel(round.code,entries,totals,resultDate);
}
