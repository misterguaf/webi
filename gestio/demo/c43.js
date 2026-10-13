// Synthetic Cuaderno 43 statements for tests and the local demo (DATA_MODE = SYNTHETIC_ONLY).
// Every name is fictitious; the account holder carries the synthetic marker that Gestió requires.
const pad = (value, length) => String(value ?? '').slice(0, length).padEnd(length, ' ');
const num = (value, length) => {
  const text = String(value);
  if (!/^\d+$/.test(text) || text.length > length) throw new Error(`c43 fixture: ${value} does not fit ${length} digits`);
  return text.padStart(length, '0');
};
const yymmdd = iso => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const line = parts => { const result = parts.join(''); if (result.length !== 80) throw new Error(`c43 fixture: ${result.length} chars`); return result; };

export const SYNTHETIC_HOLDER = 'GRUP SCOUT FICTICI SINTETIC';

/**
 * @param {{bank?: string, branch?: string, account?: string, start: string, end: string, openingCents: number, holder?: string,
 *   movements: Array<{date: string, valueDate?: string, amountCents: number, common?: string, own?: string, branch?: string,
 *   document?: string, ref1?: string, ref2?: string, concepts?: string[]}>, endRecord?: boolean, endCountIncludesSelf?: boolean}} input
 */
export function buildC43(input) {
  const bank = input.bank ?? '2100', branch = input.branch ?? '0001', account = input.account ?? '0200012345';
  const lines = [];
  const balanceSign = cents => cents < 0 ? '1' : '2';
  lines.push(line(['11', num(bank, 4), num(branch, 4), num(account, 10), yymmdd(input.start), yymmdd(input.end),
    balanceSign(input.openingCents), num(Math.abs(input.openingCents), 14), '978', '3', pad(input.holder ?? SYNTHETIC_HOLDER, 26), '   ']));
  let debitCount = 0, debitCents = 0, creditCount = 0, creditCents = 0;
  for (const item of input.movements) {
    if (item.amountCents < 0) { debitCount++; debitCents -= item.amountCents; } else { creditCount++; creditCents += item.amountCents; }
    lines.push(line(['22', '    ', num(item.branch ?? branch, 4), yymmdd(item.date), yymmdd(item.valueDate ?? item.date), num(item.common ?? '99', 2),
      num(item.own ?? '000', 3), item.amountCents < 0 ? '1' : '2', num(Math.abs(item.amountCents), 14), num(item.document ?? '0', 10),
      pad(item.ref1 ?? '', 12), pad(item.ref2 ?? '', 16)]));
    (item.concepts ?? []).forEach((concept, index) =>
      lines.push(line(['23', num(index + 1, 2), pad(concept.slice(0, 38), 38), pad(concept.slice(38, 76), 38)])));
  }
  const closing = input.openingCents + creditCents - debitCents;
  lines.push(line(['33', num(bank, 4), num(branch, 4), num(account, 10), num(debitCount, 5), num(debitCents, 14), num(creditCount, 5),
    num(creditCents, 14), balanceSign(closing), num(Math.abs(closing), 14), '978', '    ']));
  if (input.endRecord !== false) lines.push(line(['88', '9'.repeat(18), num(lines.length + (input.endCountIncludesSelf ? 1 : 0), 6), ' '.repeat(54)]));
  return lines.join('\r\n') + '\r\n';
}

/** Latin-1 bytes, as most Spanish banks deliver the file. */
export const latin1 = text => Uint8Array.from(text, char => { const code = char.charCodeAt(0); if (code > 255) throw new Error('not latin-1'); return code; });

/** A realistic fictitious autumn statement: fees, siblings, a camp, lottery, suppliers, a transfer, a refund. */
export function demoStatement({ start = '2026-10-01', end = '2026-10-31', openingCents = 1250000 } = {}) {
  return buildC43({ start, end, openingCents, movements: [
    { date: '2026-10-02', amountCents: 10000, common: '04', own: '012', ref2: 'QUOTA2627', concepts: ['TRANSFERENCIA DE NOA PONS SABATER (FICTICIA)', 'QUOTA ANUAL 26-27 NOA PONS'] },
    { date: '2026-10-02', amountCents: 10000, common: '04', own: '012', ref2: 'QUOTA2627', concepts: ['TRANSFERENCIA DE FAMILIA FICTICIA', 'QUOTA ANUAL TROPA'] },
    { date: '2026-10-03', amountCents: 15000, common: '04', own: '012', concepts: ['BIZUM DE FAMILIA BELLVER (FICTICIA)', 'QUOTA ANUAL GERMANS BELLVER'] },
    { date: '2026-10-06', amountCents: 32000, common: '02', own: '001', concepts: ['INGRESO EFECTIVO LOTERIA NADAL'] },
    { date: '2026-10-08', amountCents: -48000, common: '03', own: '005', document: '1234', concepts: ['RECIBO AUTOCARES FICTICIOS SL', 'AUTOBUS CAMPAMENT NADAL'] },
    { date: '2026-10-10', amountCents: -6500, common: '12', own: '020', concepts: ['LIQUIDACION TARJETA CREDITO'] },
    { date: '2026-10-14', amountCents: -20000, common: '04', own: '099', concepts: ['TRASPASO A CUENTA PROPIA'] },
    { date: '2026-10-20', amountCents: 2500, common: '14', own: '030', concepts: ['DEVOLUCION RECIBO SUMINISTROS'] },
    { date: '2026-10-28', amountCents: -1500, common: '17', own: '040', concepts: ['COMISION MANTENIMIENTO'] }
  ] });
}
