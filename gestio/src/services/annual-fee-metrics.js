import { pageRequest, pageResult } from '../pagination.js';
import { AppError, requirePermission, requireUuid } from './common.js';

async function scope(db,context,requestId) {
  return requirePermission(db,context,requestId,'finance.fee.read',{mode:'list',resourceType:'annual_fee_obligation'});
}
export async function listObligations(db,context,requestId,{roundId=null,sectionId=null,status=null,search='',params=null}={}) {
  const page=pageRequest(params,['string','string']);
  requireUuid(roundId);
  const decision=await scope(db,context,requestId);
  if (sectionId!==null) requireUuid(sectionId);
  if (status!==null && !['PENDING','PARTIAL','PAID','ISSUE'].includes(status)) throw new AppError(400,'invalid_fee_filter');
  if (typeof search!=='string' || search.length>80) throw new AppError(400,'invalid_fee_filter');
  if (sectionId && decision.sections!==null && !decision.sections.includes(sectionId)) throw new AppError(403,'forbidden');
  const clauses=['round_id=?'],values=[roundId];
  if (decision.sections!==null) {clauses.push(`current_section_id IN (${decision.sections.map(()=>'?').join(',')})`);values.push(...decision.sections);}
  if (sectionId) {clauses.push('current_section_id=?');values.push(sectionId);}
  if (status) {clauses.push('status=?');values.push(status);}
  if (search.trim()) {clauses.push("display_name LIKE ? ESCAPE '\\'");values.push('%'+search.trim().replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')+'%');}
  if (page.after) {clauses.push('(display_name>? OR (display_name=? AND id>?))');values.push(page.after[0],page.after[0],page.after[1]);}
  const rows=(await db.prepare(`SELECT * FROM annual_fee_obligation_status WHERE ${clauses.join(' AND ')}
    ORDER BY display_name,id LIMIT ?`).bind(...values,page.limit+1).all()).results;
  const result=pageResult(rows,page.limit,row=>[row.display_name,row.id]);
  return {obligations:result.items,nextCursor:result.nextCursor};
}
export async function feeMetrics(db,context,requestId,roundId) {
  requireUuid(roundId);
  const decision=await scope(db,context,requestId);
  const filter=decision.sections===null?'':` AND current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const rows=(await db.prepare(`SELECT current_section_id,status,amount_due_cents,allocated_cents,
    COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a
      JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.review_status='VERIFIED' AND
      (EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=a.payment_id AND i.status='OPEN'
        AND i.code IN ('BANK_NOT_FOUND','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER')) OR
       EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.obligation_id=o.id AND i.status='OPEN'
        AND i.code IN ('BANK_NOT_FOUND','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER')))),0) AS disputed_cents
    FROM annual_fee_obligation_status o WHERE round_id=?${filter}`)
    .bind(roundId,...(decision.sections??[])).all()).results;
  const totals={expectedCents:0,verifiedAllocatedCents:0,pendingCents:0,partialCount:0,issueCount:0,
    confirmedAllocatedCents:0,disputedAllocatedCents:0,unallocatedVerifiedCents:0,
    collectedPercent:0,statusCounts:{PENDING:0,PARTIAL:0,PAID:0,ISSUE:0},bySection:{}};
  for (const row of rows) {
    const section=totals.bySection[row.current_section_id]??={expectedCents:0,verifiedAllocatedCents:0,
      confirmedAllocatedCents:0,disputedAllocatedCents:0,statusCounts:{PENDING:0,PARTIAL:0,PAID:0,ISSUE:0}};
    totals.expectedCents+=row.amount_due_cents;totals.verifiedAllocatedCents+=row.allocated_cents;
    totals.disputedAllocatedCents+=row.disputed_cents;
    totals.confirmedAllocatedCents+=row.allocated_cents-row.disputed_cents;
    totals.pendingCents+=Math.max(0,row.amount_due_cents-row.allocated_cents);
    totals.statusCounts[row.status]++;section.statusCounts[row.status]++;
    section.expectedCents+=row.amount_due_cents;section.verifiedAllocatedCents+=row.allocated_cents;
    section.disputedAllocatedCents+=row.disputed_cents;
    section.confirmedAllocatedCents+=row.allocated_cents-row.disputed_cents;
    if (row.status==='PARTIAL') totals.partialCount++;
    if (row.status==='ISSUE') totals.issueCount++;
  }
  // Audit L3: same rule as listFeePayments — a matched person counts in their CURRENT section, an
  // unmatched one in the declared section, and every funded obligation must also be in scope.
  const marks=decision.sections===null?'':decision.sections.map(()=>'?').join(',');
  const paymentScope=decision.sections===null?'':` AND EXISTS(SELECT 1 FROM annual_fee_submission_person s
    WHERE s.payment_id=b.id) AND NOT EXISTS(SELECT 1 FROM annual_fee_submission_person s
      LEFT JOIN participant person ON person.id=s.participant_id WHERE s.payment_id=b.id AND
      (CASE WHEN s.participant_id IS NULL THEN s.section_id ELSE person.current_section_id END IS NULL OR
       CASE WHEN s.participant_id IS NULL THEN s.section_id ELSE person.current_section_id END NOT IN (${marks})))
    AND NOT EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_obligation o ON o.id=a.obligation_id
      JOIN participant person ON person.id=o.participant_id WHERE a.payment_id=b.id AND person.current_section_id NOT IN (${marks}))`;
  const balance=await db.prepare(`SELECT COALESCE(SUM(b.unallocated_cents),0) AS cents
    FROM annual_fee_payment_balance b WHERE b.round_id=? AND b.review_status='VERIFIED'
    AND b.unallocated_cents>0${paymentScope}`).bind(roundId,...(decision.sections??[]),...(decision.sections??[])).first();
  totals.unallocatedVerifiedCents=balance.cents;
  totals.collectedPercent=totals.expectedCents?Math.round(totals.confirmedAllocatedCents*10000/totals.expectedCents)/100:0;
  return totals;
}
