// FASE 3.5I — presentation model of the bank statement import (Cuaderno 43) and of movement suggestions.
// Pure: copy, labels, filters and file encoding. Every number shown comes from the server's analysis of the file.

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const ACCEPT = '.txt,.c43,.n43,.aeb,.q43,text/plain';

/** Row status of the preview, in the language of Gestió. */
export const ROW_STATUS = {
  NEW: { label: 'Nou', tone: 'ok' },
  DUPLICATE: { label: 'Ja importat', tone: 'neutral' },
  POSSIBLE_DUPLICATE: { label: 'Possible duplicat', tone: 'warning' }
};
export const INCIDENT_COPY = {
  DATE_OUTSIDE_PERIOD: 'La data queda fora del període de l’extracte.',
  FOREIGN_CURRENCY: 'Operació en una altra moneda.',
  POSSIBLE_DUPLICATE: 'Ja hi ha un moviment amb la mateixa data i import: es marcarà per a revisar.'
};
export const PREVIEW_FILTERS = [
  { value: 'all', label: 'Tots', test: () => true },
  { value: 'new', label: 'Nous', test: row => row.status === 'NEW' },
  { value: 'duplicates', label: 'Ja importats', test: row => row.status === 'DUPLICATE' },
  { value: 'possible', label: 'Possibles duplicats', test: row => row.status === 'POSSIBLE_DUPLICATE' },
  { value: 'incidents', label: 'Amb incidències', test: row => row.incidents.length > 0 }
];
export const filterRows = (rows, value) => rows.filter((PREVIEW_FILTERS.find(item => item.value === value) ?? PREVIEW_FILTERS[0]).test);

export const roundLabel = round => round?.status === 'ONE' ? `Ronda ${round.code}` : round?.status === 'MANY' ? 'Ronda per decidir' : 'Fora de cap ronda';

// Statement problems: what happened, said for a treasurer, with the line when the bank file has one.
const C43_ERRORS = {
  c43_empty: 'L’arxiu està buit.',
  c43_too_large: 'L’arxiu és massa gran (màxim 2 MB).',
  c43_encoding: 'No s’ha pogut llegir la codificació de l’arxiu.',
  c43_line_length: 'Hi ha una línia amb una longitud incorrecta: l’arxiu no sembla un extracte C43 o està danyat.',
  c43_control_character: 'Hi ha caràcters no vàlids dins de l’arxiu.',
  c43_unknown_record: 'Hi ha una línia que no és d’un extracte C43 (Norma 43).',
  c43_sequence: 'L’ordre dels registres no és el d’un extracte C43.',
  c43_complement_sequence: 'Els conceptes complementaris d’un moviment estan desordenats o en sobren.',
  c43_invalid_field: 'Hi ha un camp amb un valor no vàlid.',
  c43_invalid_amount: 'Hi ha un import no vàlid.',
  c43_invalid_sign: 'Hi ha un moviment sense indicar si és càrrec o abonament.',
  c43_invalid_date: 'Hi ha una data no vàlida.',
  c43_invalid_period: 'El període de l’extracte no és vàlid.',
  c43_currency: 'L’extracte no està en euros.',
  c43_account_mismatch: 'L’extracte és d’un compte diferent del triat.',
  c43_totals_mismatch: 'Els totals de l’extracte no coincideixen amb els moviments: pot estar incomplet.',
  c43_balance_mismatch: 'El saldo final no quadra amb el saldo inicial i els moviments.',
  c43_record_count: 'El nombre de registres declarat no coincideix: l’arxiu pot estar incomplet.',
  c43_truncated: 'L’arxiu està tallat: falta el tancament del compte.',
  c43_after_end: 'Hi ha contingut després del final de l’arxiu.',
  c43_no_accounts: 'L’arxiu no conté cap compte.',
  c43_multiple_accounts: 'L’arxiu conté diversos comptes. Descarrega i importa un extracte per compte.',
  c43_too_many_movements: 'L’extracte té massa moviments per a una sola importació.',
  c43_amount_too_large: 'Hi ha un import massa gran per a Gestió.',
  synthetic_bank_statement_required: 'Ara mateix Gestió només accepta extractes de prova (dades fictícies). Els extractes reals s’importaran quan s’òbriga l’entorn real.',
  c43_position_required: 'Tria a quin compte del grup correspon l’extracte.',
  c43_position_not_bank: 'Només es poden importar extractes en un compte bancari.',
  c43_file_changed: 'L’arxiu ha canviat des de la previsualització. Torna a seleccionar-lo.',
  c43_no_movements: 'L’extracte no té moviments.',
  duplicate_import: 'Este arxiu ja s’havia importat. No s’ha afegit res.',
  import_conflict: 'Mentrestant s’han importat moviments del mateix compte. Torna a previsualitzar l’arxiu.',
  position_inactive: 'El compte triat està inactiu.',
  body_too_large: 'L’arxiu és massa gran (màxim 2 MB).',
  forbidden: 'No tens permís per a importar extractes.'
};
export function importErrorCopy(error) {
  const code = typeof error === 'string' ? error : error?.code;
  const text = C43_ERRORS[code] ?? 'No s’ha pogut llegir l’extracte. Comprova que és l’arxiu C43 (Norma 43) descarregat del banc.';
  return error?.line ? `Línia ${error.line}: ${text}` : text;
}

/** Bytes → base64 in chunks (no spread of a whole file into one call). */
export function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** What the treasurer is told after confirming. */
export function resultLines(counts) {
  return [
    counts.created === 1 ? 'S’ha importat 1 moviment nou.' : `S’han importat ${counts.created} moviments nous.`,
    counts.duplicates ? `${counts.duplicates} ja estaven a Gestió i no s’han tornat a afegir.` : null,
    counts.flagged ? `${counts.flagged} queden marcats com a possibles duplicats per a revisar.` : null,
    'Els moviments queden pendents de classificar: res s’ha classificat ni conciliat automàticament.'
  ].filter(Boolean);
}

// ---------------------------------------------------------------- suggestions (movement detail)
export const NATURE_LABEL = {
  INCOME: 'Ingrés', EXPENSE: 'Despesa', FEE: 'Quota', INTERNAL_TRANSFER: 'Traspàs entre comptes propis',
  CARD_SETTLEMENT: 'Liquidació de targeta', REFUND_RECEIVED: 'Devolució rebuda', REFUND_PAID: 'Devolució pagada',
  BANK_CHARGES: 'Comissions o despeses bancàries'
};
export const MATCH_LABEL = { FEE_PAYMENT: 'Quota anual', ACTIVITY_PAYMENT: 'Activitat', EXPENSE_SETTLEMENT: 'Despesa ja registrada' };
export const STRENGTH = { STRONG: { label: 'Coincidència clara', tone: 'ok' }, WEAK: { label: 'Coincidència possible', tone: 'warning' } };
/** Allocation payload for a confirmed match: the existing reconciliation endpoint decides if it is valid. */
export function matchAllocation(match) {
  const key = { FEE_PAYMENT: 'feePaymentId', ACTIVITY_PAYMENT: 'activityAllocationId', EXPENSE_SETTLEMENT: 'expenseId' }[match.type];
  return key ? { kind: match.type, [key]: match.id, amountCents: match.amountCents } : null;
}
