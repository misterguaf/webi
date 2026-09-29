// Human labels shared by legacy views. Technical codes never reach the UI unlabelled when a label exists.
const statusLabel = { DRAFT: 'Esborrany', PUBLISHED: 'Publicada', CLOSED: 'Tancada', GENERAL: 'Tot el grup',
  NEEDS_PARTICIPANT_REVIEW: 'Pendent de vincular', AWAITING_PAYMENT_REVIEW: 'Pendent de pagament',
  CONFIRMED: 'Confirmada', REJECTED: 'Rebutjada', CLEAR: 'Coincidència clara', AMBIGUOUS: 'Coincidència ambigua',
  NONE: 'Sense coincidència', RESOLVED: 'Vinculada', PENDING_REVIEW: 'Pendent de revisió', VERIFIED: 'Verificat', ISSUE: 'Incidència' };
export const label = value => statusLabel[value] ?? value;
// Candidates carry match signals; the full birth date is present only with participant-profile access.
export const candidateLabel = person => `${person.display_name} · ${person.section_code} · ${person.birth_date_matches ? 'naixement coincideix' : 'naixement no coincideix'}${person.birth_date ? ` (${person.birth_date})` : ''}`;
