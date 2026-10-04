// The explicit annual-fee family in the financial round supplies the sibling
// ordinal to a paid activity. No name, address or bank-text inference is used.
export async function activityPrice(db, { baseCents, startsAt, participantId }) {
  const day = new Date(startsAt).toISOString().slice(0, 10);
  const round = baseCents > 0 ? await db.prepare(`SELECT id,annual_fee_round_id FROM finance_round
    WHERE period_start<=? AND period_end>=? LIMIT 1`).bind(day, day).first() : null;
  const family = round?.annual_fee_round_id && participantId ? await db.prepare(`SELECT group_id,sibling_ordinal
    FROM annual_fee_family_member WHERE round_id=? AND participant_id=?`)
    .bind(round.annual_fee_round_id, participantId).first() : null;
  const siblingOrdinal = family?.sibling_ordinal ?? 1;
  const discountCents = siblingOrdinal >= 3 ? Math.floor(baseCents / 2) : 0;
  return { amountCents: baseCents - discountCents, baseCents, discountCents,
    siblingOrdinal, familyGroupId: family?.group_id ?? null, financeRoundId: round?.id ?? null };
}
