import { AppError, requirePermission, requireUuid } from './common.js';

// Only the fields listed here cross the basic-status boundary. In particular,
// never SELECT * from the authoritative view, which contains monetary data.
export async function scopedFeeStatus(db,context,requestId,roundId=null) {
  const decision=await requirePermission(db,context,requestId,'finance.fee.status.read',
    {mode:'list',resourceType:'annual_fee_obligation'});
  if(roundId!==null) requireUuid(roundId);
  const rounds=(await db.prepare('SELECT id,code FROM annual_fee_round ORDER BY code DESC LIMIT 30').all()).results;
  const selected=roundId??rounds[0]?.id??null;
  if(selected && !rounds.some(round=>round.id===selected)) throw new AppError(404,'not_found');
  if(!selected) return {rounds,selectedRoundId:null,statuses:[]};
  // Current section decides scope (product decision); sections===null means group-wide holder.
  const scope=decision.sections===null?'':` AND v.current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const rows=(await db.prepare(`SELECT v.participant_id AS participantId,v.display_name AS displayName,
    s.code AS sectionCode,v.status AS status
    FROM annual_fee_obligation_status v JOIN section s ON s.id=v.current_section_id
    WHERE v.round_id=?${scope}
    ORDER BY v.display_name,v.participant_id`).bind(selected,...(decision.sections??[])).all()).results;
  return {rounds,selectedRoundId:selected,statuses:rows};
}
