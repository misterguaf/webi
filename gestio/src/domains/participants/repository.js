function requireScope(decision) {
  if (!decision?.allow || !(decision.sections===null || (Array.isArray(decision.sections) && decision.sections.length))) throw new Error('PARTICIPANT_SCOPE_REQUIRED');
}
export async function getSection(db, id) {
  return db.prepare('SELECT current_section_id FROM participant WHERE id=? AND status=?').bind(id,'ACTIVE').first();
}
// Returns up to limit+1 rows ordered by (display_name,id) so the caller can emit a cursor.
export async function listScoped(db, decision, { limit=100, after=null }={}) {
  requireScope(decision);
  const scope=decision.sections===null?'':` AND current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const next=after?' AND (display_name>? OR (display_name=? AND id>?))':'';
  return (await db.prepare(`SELECT id,display_name,current_section_id,status FROM participant
    WHERE status=?${scope}${next} ORDER BY display_name,id LIMIT ?`)
    .bind('ACTIVE',...(decision.sections??[]),...(after?[after[0],after[0],after[1]]:[]),limit+1).all()).results;
}
// Section membership history of an in-scope participant (scope = current section).
export async function sectionHistory(db, id) {
  return (await db.prepare(`SELECT s.code AS section_code,m.started_at,m.ended_at,m.start_reason,m.end_reason
    FROM participant_section_membership m JOIN section s ON s.id=m.section_id WHERE m.participant_id=?
    ORDER BY m.started_at,m.rowid`).bind(id).all()).results;
}
export async function findScoped(db, decision, id) {
  requireScope(decision);
  if (decision.sections===null) return db.prepare('SELECT id,display_name,current_section_id,status FROM participant WHERE id=? AND status=?').bind(id,'ACTIVE').first();
  const marks=decision.sections.map(()=>'?').join(',');
  return db.prepare(`SELECT id,display_name,current_section_id,status FROM participant WHERE id=? AND status=? AND current_section_id IN (${marks})`)
    .bind(id,'ACTIVE',...decision.sections).first();
}
