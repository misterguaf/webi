function requireScope(decision) {
  if (!decision?.allow || !(decision.sections===null || (Array.isArray(decision.sections) && decision.sections.length))) throw new Error('PARTICIPANT_SCOPE_REQUIRED');
}
export async function getSection(db, id) {
  return db.prepare('SELECT current_section_id FROM participant WHERE id=? AND status=?').bind(id,'ACTIVE').first();
}
export async function listScoped(db, decision) {
  requireScope(decision);
  if (decision.sections===null) return (await db.prepare('SELECT id,display_name,current_section_id,status FROM participant WHERE status=? ORDER BY id LIMIT 100').bind('ACTIVE').all()).results;
  const marks=decision.sections.map(()=>'?').join(',');
  return (await db.prepare(`SELECT id,display_name,current_section_id,status FROM participant WHERE status=? AND current_section_id IN (${marks}) ORDER BY id LIMIT 100`)
    .bind('ACTIVE',...decision.sections).all()).results;
}
export async function findScoped(db, decision, id) {
  requireScope(decision);
  if (decision.sections===null) return db.prepare('SELECT id,display_name,current_section_id,status FROM participant WHERE id=? AND status=?').bind(id,'ACTIVE').first();
  const marks=decision.sections.map(()=>'?').join(',');
  return db.prepare(`SELECT id,display_name,current_section_id,status FROM participant WHERE id=? AND status=? AND current_section_id IN (${marks})`)
    .bind(id,'ACTIVE',...decision.sections).first();
}
