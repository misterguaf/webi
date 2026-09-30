function requireScope(decision) {
  if (!decision?.allow || !(decision.sections===null || (Array.isArray(decision.sections) && decision.sections.length))) throw new Error('PARTICIPANT_SCOPE_REQUIRED');
}
export async function getSection(db, id) {
  return db.prepare('SELECT current_section_id FROM participant WHERE id=? AND status=?').bind(id,'ACTIVE').first();
}
// Completeness flags, computed in SQL so the service can derive `complete` with the age rule (§8.2).
// "current" = ended_at IS NULL. A minor's contact may be their own or a guardian's; an adult needs
// their own. No personal data leaves this query: only existence booleans and the birth date.
const FLAGS=`p.birth_date AS birth_date,
  EXISTS(SELECT 1 FROM participant_guardian g WHERE g.participant_id=p.id AND g.ended_at IS NULL) AS has_guardian,
  EXISTS(SELECT 1 FROM contact_point c WHERE c.participant_id=p.id AND c.ended_at IS NULL) AS has_own_contact,
  EXISTS(SELECT 1 FROM contact_point c JOIN participant_guardian g ON g.guardian_id=c.guardian_id
    WHERE g.participant_id=p.id AND g.ended_at IS NULL AND c.ended_at IS NULL) AS has_guardian_contact`;

// Returns up to limit+1 rows ordered by (display_name,id) so the caller can emit a cursor.
// `estat` selects ACTIVE (default) or INACTIVE membership; completeness is filtered client-side.
export async function listScoped(db, decision, { limit=100, after=null, status='ACTIVE' }={}) {
  requireScope(decision);
  const scope=decision.sections===null?'':` AND p.current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const next=after?' AND (p.display_name>? OR (p.display_name=? AND p.id>?))':'';
  return (await db.prepare(`SELECT p.id,p.display_name,p.current_section_id,p.status,${FLAGS} FROM participant p
    WHERE p.status=?${scope}${next} ORDER BY p.display_name,p.id LIMIT ?`)
    .bind(status,...(decision.sections??[]),...(after?[after[0],after[0],after[1]]:[]),limit+1).all()).results;
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
// Detail read (either membership status), scoped to the current section, with the completeness flags
// and the administrative metadata of the record.
export async function findDetail(db, decision, id) {
  requireScope(decision);
  const scope=decision.sections===null?'':` AND p.current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  return db.prepare(`SELECT p.id,p.display_name,p.current_section_id,p.status,p.version,p.created_at,p.updated_at,
    p.created_by,p.provenance,p.provenance_note,${FLAGS} FROM participant p WHERE p.id=?${scope}`)
    .bind(id,...(decision.sections??[])).first();
}
// Compare-and-set row used for optimistic concurrency; NULL is written when the version no longer
// matches, aborting the whole batch through the NOT NULL constraint (src/concurrency.js).
export async function currentForManage(db, id) {
  return db.prepare('SELECT id,current_section_id,status,version FROM participant WHERE id=?').bind(id).first();
}
// Server-side count of incomplete ACTIVE records within the caller's scope (Dashboard follow-up).
// The full completeness rule is applied in SQL, including the 18-year age boundary.
export async function incompleteCount(db, decision) {
  requireScope(decision);
  const scope=decision.sections===null?'':` AND p.current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const adult=`CAST(strftime('%Y','now')-strftime('%Y',p.birth_date) -
    (strftime('%m-%d','now')<strftime('%m-%d',p.birth_date)) AS INTEGER)>=18`;
  const hasGuardian=`EXISTS(SELECT 1 FROM participant_guardian g WHERE g.participant_id=p.id AND g.ended_at IS NULL)`;
  const hasOwnContact=`EXISTS(SELECT 1 FROM contact_point c WHERE c.participant_id=p.id AND c.ended_at IS NULL)`;
  const hasGuardianContact=`EXISTS(SELECT 1 FROM contact_point c JOIN participant_guardian g ON g.guardian_id=c.guardian_id
    WHERE g.participant_id=p.id AND g.ended_at IS NULL AND c.ended_at IS NULL)`;
  const complete=`p.birth_date IS NOT NULL AND (
    (${adult} AND ${hasOwnContact}) OR
    (NOT ${adult} AND ${hasGuardian} AND (${hasOwnContact} OR ${hasGuardianContact})))`;
  return (await db.prepare(`SELECT count(*) AS n FROM participant p
    WHERE p.status='ACTIVE'${scope} AND NOT (${complete})`).bind(...(decision.sections??[])).first()).n;
}
