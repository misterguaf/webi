// FASE 3.5I-Q — Quotes read model (docs/design/screens/QUOTES.md). A projection over the existing annual-fee domain:
// the status comes from the authoritative view annual_fee_obligation_status (PENDING / PARTIAL / PAID / ISSUE), never
// from client arithmetic, and no fee state is stored here. Two projections, chosen by the viewer's own capabilities:
//   - financial: finance.fee.read (its scope) — amounts, family context, payments, plans, issues, corrections;
//   - basic: finance.fee.status.read (its scope) — ACTIVE participants of the CURRENT section, name, section, status.
// A basic reader never receives amounts, payers, evidence, bank data, allocation internals or another section's
// sibling. Every action stays on its existing endpoint with its own authorisation; this module only reads.
import { authorize } from '../policy.js';
import { AppError, requirePermission, requireUuid, validUuid } from './common.js';

const STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'ISSUE'];
const SECTION_CODES = ['MANADA', 'TROPA', 'ESCOLTA', 'CLAN'];
const PAGE = 100, SCAN = 2000;
const key = value => String(value ?? '').toLocaleLowerCase('ca').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const covers = (decision, sectionId) => decision.allow && (decision.sections === null || decision.sections.includes(sectionId));
const marks = list => list.map(() => '?').join(',');

/** Which projection this viewer gets (null: no fee visibility at all). */
async function projection(db, context) {
  const full = await authorize(db, context, { permission: 'finance.fee.read', mode: 'list' });
  if (full.allow) return { mode: 'financial', decision: full };
  const basic = await authorize(db, context, { permission: 'finance.fee.status.read', mode: 'list' });
  if (basic.allow) return { mode: 'basic', decision: basic };
  return null;
}
const decodeCursor = value => {
  if (value == null) return null;
  try { const parsed = JSON.parse(atob(String(value))); if (Array.isArray(parsed) && parsed.length === 2) return parsed.map(String); } catch { /* invalid */ }
  throw new AppError(400, 'invalid_filter');
};

/** GET /api/quotes — the participant list of a round in the viewer's scope, with status counts. */
export async function quotesList(db, context, requestId, params) {
  const view = await projection(db, context);
  // No fee visibility: the ordinary audited denial.
  if (!view) { await requirePermission(db, context, requestId, 'finance.fee.status.read', { mode: 'list', resourceType: 'annual_fee_obligation' }); return null; }
  const { mode, decision } = view;
  const roundId = params.get('roundId'), section = params.get('section'), status = params.get('status'), q = params.get('q') ?? '';
  if ((roundId && !validUuid(roundId)) || (section && !SECTION_CODES.includes(section)) || (status && !STATUSES.includes(status)) || q.length > 80)
    throw new AppError(400, 'invalid_filter');
  const cursor = decodeCursor(params.get('cursor'));
  const rounds = (await db.prepare('SELECT id,code FROM annual_fee_round ORDER BY code DESC LIMIT 30').all()).results;
  const selected = roundId ?? rounds[0]?.id ?? null;
  if (selected && !rounds.some(round => round.id === selected)) throw new AppError(404, 'not_found');
  const sections = (await db.prepare('SELECT id,code FROM section ORDER BY rowid').all()).results
    .filter(row => decision.sections === null || decision.sections.includes(row.id));
  const sectionRow = section ? sections.find(row => row.code === section) : null;
  if (section && !sectionRow) throw new AppError(403, 'forbidden');
  const empty = { PENDING: 0, PARTIAL: 0, PAID: 0, ISSUE: 0 };
  const base = { mode, rounds, selectedRoundId: selected, roundCode: rounds.find(round => round.id === selected)?.code ?? null,
    sections: sections.map(row => row.code) };
  if (!selected) return { ...base, total: 0, counts: empty, rows: [], nextCursor: null };
  const scope = decision.sections === null ? '' : ` AND v.current_section_id IN (${marks(decision.sections)})`;
  // Basic readers see ACTIVE participants only; Treasury also sees former members who still owe a quota.
  const active = mode === 'basic' ? " AND p.status='ACTIVE'" : '';
  const all = (await db.prepare(`SELECT v.id AS obligation_id,v.participant_id,v.display_name,s.code AS section_code,v.status,p.status AS person_status,
      v.amount_due_cents,v.allocated_cents,v.sibling_ordinal,v.discount_cents
    FROM annual_fee_obligation_status v JOIN section s ON s.id=v.current_section_id JOIN participant p ON p.id=v.participant_id
    WHERE v.round_id=?${scope}${active}${sectionRow ? ' AND v.current_section_id=?' : ''} ORDER BY v.display_name,v.participant_id LIMIT ?`)
    .bind(selected, ...(decision.sections ?? []), ...(sectionRow ? [sectionRow.id] : []), SCAN + 1).all()).results;
  if (all.length > SCAN) throw new AppError(409, 'too_many_rows'); // fail closed until indexed paging is needed
  const counts = { ...empty };
  for (const row of all) counts[row.status]++;
  const needle = key(q);
  let rows = all.filter(row => (!status || row.status === status) && (!needle || key(row.display_name).includes(needle)));
  if (cursor) rows = rows.filter(row => row.display_name > cursor[0] || (row.display_name === cursor[0] && row.participant_id > cursor[1]));
  const page = rows.slice(0, PAGE), last = page.at(-1);
  return { ...base, total: all.length, counts,
    rows: page.map(row => mode === 'basic'
      ? { participantId: row.participant_id, displayName: row.display_name, sectionCode: row.section_code, status: row.status }
      : { participantId: row.participant_id, displayName: row.display_name, sectionCode: row.section_code, status: row.status,
        active: row.person_status === 'ACTIVE', amountDueCents: row.amount_due_cents, receivedCents: row.allocated_cents,
        pendingCents: Math.max(0, row.amount_due_cents - row.allocated_cents), siblingOrdinal: row.sibling_ordinal, discountCents: row.discount_cents }),
    nextCursor: rows.length > PAGE && last ? btoa(JSON.stringify([last.display_name, last.participant_id])) : null };
}

/** GET /api/quotes/participants/:id?roundId= — one participant's quota, in the viewer's projection. */
export async function quotesDetail(db, context, requestId, participantId, roundIdParam) {
  requireUuid(participantId);
  if (roundIdParam && !validUuid(roundIdParam)) throw new AppError(400, 'invalid_filter');
  const roundId = roundIdParam ?? (await db.prepare('SELECT id FROM annual_fee_round ORDER BY code DESC LIMIT 1').first())?.id;
  const row = roundId ? await db.prepare(`SELECT v.*,s.code AS section_code,p.status AS person_status,r.code AS round_code
    FROM annual_fee_obligation_status v JOIN section s ON s.id=v.current_section_id JOIN participant p ON p.id=v.participant_id
    JOIN annual_fee_round r ON r.id=v.round_id WHERE v.participant_id=? AND v.round_id=?`).bind(participantId, roundId).first() : null;
  const full = await authorize(db, context, { permission: 'finance.fee.read', mode: 'list' });
  const basic = await authorize(db, context, { permission: 'finance.fee.status.read', mode: 'list' });
  const financial = !!row && covers(full, row.current_section_id);
  const basicOk = !!row && !financial && covers(basic, row.current_section_id) && row.person_status === 'ACTIVE';
  if (!financial && !basicOk) {
    // Audited denial; out of scope or missing is indistinguishable (404).
    await requirePermission(db, context, requestId, full.allow ? 'finance.fee.read' : 'finance.fee.status.read',
      { sectionId: row?.current_section_id ?? '00000000-0000-4000-8000-000000000000', resourceType: 'annual_fee_obligation', conceal: true });
    throw new AppError(404, 'not_found');
  }
  const profile = await authorize(db, context, { permission: 'participants.profile.read', sectionId: row.current_section_id });
  const summary = { displayName: row.display_name, sectionCode: row.section_code, roundCode: row.round_code, roundId, status: row.status,
    links: { participant: profile.allow } };
  if (!financial) return { mode: 'basic', quota: summary };

  const id = row.id;
  const family = row.family_group_id ? await db.prepare('SELECT reference FROM annual_fee_family_group WHERE id=?').bind(row.family_group_id).first() : null;
  // Siblings only where the viewer's own fee scope reaches (never another section's finances for a scoped reader).
  const siblings = row.family_group_id ? (await db.prepare(`SELECT v.participant_id,v.display_name,s.code AS section_code,v.current_section_id,
      v.sibling_ordinal,v.discount_cents,v.base_cents,v.amount_due_cents,v.status
    FROM annual_fee_obligation_status v JOIN section s ON s.id=v.current_section_id
    WHERE v.family_group_id=? AND v.round_id=? ORDER BY v.sibling_ordinal,v.display_name`).bind(row.family_group_id, roundId).all()).results
    .filter(sibling => covers(full, sibling.current_section_id)) : [];
  const payments = (await db.prepare(`SELECT p.id AS payment_id,p.created_at,p.review_status,p.verified_amount_cents,a.amount_cents,
      (SELECT e.id FROM annual_fee_evidence e WHERE e.payment_id=p.id) AS evidence_id,
      EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=p.id AND i.status='OPEN') AS open_issue
    FROM annual_fee_allocation a JOIN annual_fee_payment p ON p.id=a.payment_id WHERE a.obligation_id=? ORDER BY p.created_at,a.id`).bind(id).all()).results;
  // Proofs that name this person but are not allocated yet: received, not money in the account.
  const proofs = (await db.prepare(`SELECT p.id AS payment_id,p.created_at,p.review_status,p.declared_amount_cents,
      (SELECT e.id FROM annual_fee_evidence e WHERE e.payment_id=p.id) AS evidence_id
    FROM annual_fee_submission_person sp JOIN annual_fee_payment p ON p.id=sp.payment_id
    WHERE sp.participant_id=? AND p.round_id=? AND NOT EXISTS(SELECT 1 FROM annual_fee_allocation a WHERE a.payment_id=p.id AND a.obligation_id=?)
    ORDER BY p.created_at`).bind(participantId, roundId, id).all()).results;
  const plan = await db.prepare("SELECT id,authorized_at FROM annual_fee_installment_plan WHERE obligation_id=? AND status='ACTIVE'").bind(id).first();
  const parts = plan ? (await db.prepare('SELECT ordinal,planned_cents,target_at FROM annual_fee_installment_part WHERE plan_id=? ORDER BY ordinal').bind(plan.id).all()).results : [];
  const issues = (await db.prepare(`SELECT i.id,i.code,i.status,i.created_at,i.resolved_at,i.payment_id IS NOT NULL AS payment_level FROM annual_fee_issue i
    WHERE i.obligation_id=? OR (i.obligation_id IS NULL AND i.payment_id IN (SELECT payment_id FROM annual_fee_allocation WHERE obligation_id=?))
    ORDER BY i.status='OPEN' DESC,i.created_at DESC`).bind(id, id).all()).results;
  const overpayments = (await db.prepare(`SELECT amount_cents,status,created_at FROM finance_overpayment WHERE fee_obligation_id=? ORDER BY created_at`).bind(id).all()).results;
  const corrections = (await db.prepare(`SELECT previous_amount_cents,new_amount_cents,changed_at FROM annual_fee_amount_revision
    WHERE obligation_id=? ORDER BY changed_at DESC,id DESC LIMIT 20`).bind(id).all()).results;
  const can = async permission => covers(await authorize(db, context, { permission, mode: 'list' }), row.current_section_id);
  const treasury = (await authorize(db, context, { permission: 'finance.treasury.read' })).allow;
  return { mode: 'financial', quota: { ...summary, obligationId: id, active: row.person_status === 'ACTIVE',
    amountDueCents: row.amount_due_cents, baseCents: row.base_cents, discountCents: row.discount_cents, receivedCents: row.allocated_cents,
    pendingCents: Math.max(0, row.amount_due_cents - row.allocated_cents), siblingOrdinal: row.sibling_ordinal,
    family: family ? { reference: family.reference, members: siblings.map(sibling => ({ participantId: sibling.participant_id, displayName: sibling.display_name,
      sectionCode: sibling.section_code, ordinal: sibling.sibling_ordinal, discountCents: sibling.discount_cents, baseCents: sibling.base_cents,
      amountDueCents: sibling.amount_due_cents, status: sibling.status, current: sibling.participant_id === participantId })) } : null,
    payments: payments.map(payment => ({ paymentId: payment.payment_id, receivedAt: payment.created_at, reviewStatus: payment.review_status,
      allocatedCents: payment.amount_cents, evidenceId: payment.evidence_id, openIssue: !!payment.open_issue })),
    proofs: proofs.map(proof => ({ paymentId: proof.payment_id, receivedAt: proof.created_at, reviewStatus: proof.review_status,
      declaredCents: proof.declared_amount_cents, evidenceId: proof.evidence_id })),
    plan: plan ? { authorizedAt: plan.authorized_at, parts: parts.map(part => ({ ordinal: part.ordinal, plannedCents: part.planned_cents, targetAt: part.target_at })) } : null,
    issues: issues.map(issue => ({ id: issue.id, code: issue.code, status: issue.status, createdAt: issue.created_at, resolvedAt: issue.resolved_at, paymentLevel: !!issue.payment_level })),
    overpayments: overpayments.map(claim => ({ amountCents: claim.amount_cents, status: claim.status, createdAt: claim.created_at })),
    corrections: corrections.map(change => ({ previousCents: change.previous_amount_cents, newCents: change.new_amount_cents, changedAt: change.changed_at })) },
  actions: { reviewPayments: await can('finance.fee.payment.review'), manage: await can('finance.fee.manage'), treasury,
    links: { participant: profile.allow, treasury } } };
}
