// FASE 3.5I — Cuaderno 43 (AEB Norma 43, «Información normalizada de cuenta corriente») reader.
// Pure module: bytes in, validated statement out. Fixed-width 80-character records, never split on spaces:
//   11 account header · 22 movement · 23 concept complement (≤5 per movement) · 24 currency equivalence ·
//   33 account totals · 88 end of file (optional in practice).
// Amounts are integers in cents (14 digits: 12 integer + 2 decimal); 1 = debit (cargo), 2 = credit (abono).
// Any structural inconsistency (sequence, totals, balances, lengths, dates) rejects the whole file.

export const C43_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxMovements: 5000, maxComplements: 5, lineLength: 80 });

export class C43Error extends Error {
  /** @param {string} code @param {number|null} [line] */
  constructor(code, line = null) { super(code); this.code = code; this.line = line; }
}
const fail = (code, line = null) => { throw new C43Error(code, line); };

// ---------------------------------------------------------------- character encodings
// Spanish banks still emit ISO-8859-1/Windows-1252 or the DOS code page 850. UTF-8 is accepted when valid.
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';
const single = high => bytes => {
  let text = '';
  for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte)
    : high.length === 32 ? (byte < 0xa0 ? high[byte - 0x80] : String.fromCharCode(byte)) : high[byte - 0x80];
  return text;
};
const DECODERS = { 'windows-1252': single(CP1252_HIGH), cp850: single(CP850_HIGH) };
export const C43_ENCODINGS = Object.freeze(['auto', 'utf-8', 'windows-1252', 'cp850']);
// Letters a Valencian/Spanish statement plausibly contains; box drawing or control characters do not.
const plausible = text => (text.match(/[A-Za-z0-9 ÁÉÍÓÚÀÈÒÏÜÇÑáéíóúàèòïüçñ·ºª€.,\-/'()&:;]/g) ?? []).length - 4 * (text.match(/[\u0080-\u009f░▒▓│┤╣║╗╝┐└┴┬├─┼╚╔╩╦╠═╬┘┌█▄▀■]/g) ?? []).length;

/** @param {Uint8Array} bytes @param {string} [encoding] @returns {{text: string, encoding: string}} */
export function decodeC43(bytes, encoding = 'auto') {
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail('c43_empty');
  if (bytes.length > C43_LIMITS.maxBytes) fail('c43_too_large');
  if (!C43_ENCODINGS.includes(encoding)) fail('c43_encoding');
  const utf8 = () => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; } };
  if (encoding === 'utf-8') { const text = utf8(); if (text === null) fail('c43_encoding'); return { text: text.replace(/^﻿/, ''), encoding }; }
  if (encoding !== 'auto') return { text: DECODERS[encoding](bytes), encoding };
  if (bytes.every(byte => byte < 0x80)) return { text: DECODERS['windows-1252'](bytes), encoding: 'ascii' };
  const text = utf8();
  if (text !== null) return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' };
  const candidates = ['windows-1252', 'cp850'].map(name => ({ name, text: DECODERS[name](bytes) }))
    .map(candidate => ({ ...candidate, score: plausible(candidate.text) }));
  candidates.sort((a, b) => b.score - a.score);
  return { text: candidates[0].text, encoding: candidates[0].name };
}

// ---------------------------------------------------------------- fields
const digits = (line, from, to, lineNo, code = 'c43_invalid_field') => {
  const value = line.slice(from - 1, to);
  if (!/^\d+$/.test(value)) fail(code, lineNo);
  return value;
};
const text = (line, from, to) => line.slice(from - 1, to).trim();
const amount = (line, from, to, lineNo) => {
  const value = Number(digits(line, from, to, lineNo, 'c43_invalid_amount'));
  if (!Number.isSafeInteger(value)) fail('c43_invalid_amount', lineNo);
  return value;
};
const sign = (line, position, lineNo) => {
  const key = line[position - 1];
  if (key !== '1' && key !== '2') fail('c43_invalid_sign', lineNo);
  return key === '1' ? -1 : 1;
};
/** YYMMDD → YYYY-MM-DD (2000–2099), validated as a real calendar date. */
const date = (line, from, lineNo) => {
  const raw = digits(line, from, from + 5, lineNo, 'c43_invalid_date');
  const iso = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) fail('c43_invalid_date', lineNo);
  return iso;
};

/**
 * @param {string} content decoded file
 * @returns {{accounts: Array<any>, recordCount: number, warnings: Array<{code: string, line: number|null}>}}
 */
export function parseC43(content) {
  if (typeof content !== 'string' || !content.length) fail('c43_empty');
  const raw = content.replace(/\u001a+\s*$/, '').split(/\r\n|\n|\r/);
  while (raw.length && raw.at(-1).trim() === '') raw.pop();
  if (!raw.length) fail('c43_empty');
  const warnings = [], accounts = [];
  let current = null, movement = null, end = null, records = 0;
  raw.forEach((original, index) => {
    const lineNo = index + 1;
    if (end) fail('c43_after_end', lineNo);
    if (original.length > C43_LIMITS.lineLength) fail('c43_line_length', lineNo);
    if (original.length < 2) fail('c43_line_length', lineNo);
    // Several banks trim trailing blanks; fields are positional, so pad back to 80.
    const line = original.padEnd(C43_LIMITS.lineLength, ' ');
    if (/[\u0000-\u001f]/.test(line)) fail('c43_control_character', lineNo);
    const type = line.slice(0, 2);
    if (type !== '88') records++;
    switch (type) {
      case '11': {
        if (current) fail('c43_sequence', lineNo);
        const currency = digits(line, 48, 50, lineNo);
        if (currency !== '978') fail('c43_currency', lineNo);
        current = {
          headerLine: lineNo, bankCode: digits(line, 3, 6, lineNo), branchCode: digits(line, 7, 10, lineNo),
          account: digits(line, 11, 20, lineNo), startDate: date(line, 21, lineNo), endDate: date(line, 27, lineNo),
          openingCents: sign(line, 33, lineNo) * amount(line, 34, 47, lineNo), currency: 'EUR',
          mode: text(line, 51, 51), holder: text(line, 52, 77), movements: []
        };
        if (current.endDate < current.startDate) fail('c43_invalid_period', lineNo);
        movement = null;
        break;
      }
      case '22': {
        if (!current) fail('c43_sequence', lineNo);
        if (current.movements.length >= C43_LIMITS.maxMovements) fail('c43_too_many_movements', lineNo);
        movement = {
          line: lineNo, originBranch: text(line, 7, 10), operationDate: date(line, 11, lineNo), valueDate: date(line, 17, lineNo),
          commonConcept: digits(line, 23, 24, lineNo), ownConcept: text(line, 25, 27),
          amountCents: sign(line, 28, lineNo) * amount(line, 29, 42, lineNo),
          documentNumber: text(line, 43, 52), reference1: text(line, 53, 64), reference2: text(line, 65, 80),
          concepts: [], equivalence: null
        };
        if (movement.amountCents === 0) fail('c43_invalid_amount', lineNo);
        if (movement.operationDate < current.startDate || movement.operationDate > current.endDate)
          warnings.push({ code: 'c43_date_outside_period', line: lineNo });
        current.movements.push(movement);
        break;
      }
      case '23': {
        if (!movement) fail('c43_sequence', lineNo);
        const code = Number(digits(line, 3, 4, lineNo));
        if (code < 1 || code > C43_LIMITS.maxComplements || code !== movement.concepts.length + 1) fail('c43_complement_sequence', lineNo);
        // Two 38-character halves: a full first half continues straight into the second (a word may be split).
        const first = line.slice(4, 42), second = line.slice(42, 80);
        movement.concepts.push((/\S$/.test(first) ? first + second : `${first.trimEnd()} ${second}`).replace(/\s+/g, ' ').trim());
        break;
      }
      case '24': {
        if (!movement || movement.equivalence) fail('c43_sequence', lineNo);
        digits(line, 3, 4, lineNo);
        movement.equivalence = { currency: digits(line, 5, 7, lineNo), amountCents: amount(line, 8, 21, lineNo) };
        break;
      }
      case '33': {
        if (!current) fail('c43_sequence', lineNo);
        if (digits(line, 3, 6, lineNo) !== current.bankCode || digits(line, 7, 10, lineNo) !== current.branchCode ||
            digits(line, 11, 20, lineNo) !== current.account) fail('c43_account_mismatch', lineNo);
        if (digits(line, 74, 76, lineNo) !== '978') fail('c43_currency', lineNo);
        const totals = { debitCount: Number(digits(line, 21, 25, lineNo)), debitCents: amount(line, 26, 39, lineNo),
          creditCount: Number(digits(line, 40, 44, lineNo)), creditCents: amount(line, 45, 58, lineNo) };
        const closingCents = sign(line, 59, lineNo) * amount(line, 60, 73, lineNo);
        const debits = current.movements.filter(item => item.amountCents < 0), credits = current.movements.filter(item => item.amountCents > 0);
        const sum = list => list.reduce((total, item) => total + Math.abs(item.amountCents), 0);
        if (debits.length !== totals.debitCount || credits.length !== totals.creditCount ||
            sum(debits) !== totals.debitCents || sum(credits) !== totals.creditCents) fail('c43_totals_mismatch', lineNo);
        if (current.openingCents + totals.creditCents - totals.debitCents !== closingCents) fail('c43_balance_mismatch', lineNo);
        accounts.push({ ...current, closingCents, totals });
        current = null; movement = null;
        break;
      }
      case '88': {
        if (current) fail('c43_truncated', lineNo);
        if (!/^9{18}$/.test(line.slice(2, 20))) fail('c43_invalid_field', lineNo);
        const count = Number(digits(line, 21, 26, lineNo));
        // Banks count the records before the end record; some include the end record itself.
        if (count !== records && count !== records + 1) fail('c43_record_count', lineNo);
        end = lineNo;
        break;
      }
      default: fail('c43_unknown_record', lineNo);
    }
  });
  if (current) fail('c43_truncated', raw.length);
  if (!accounts.length) fail('c43_no_accounts');
  if (!end) warnings.push({ code: 'c43_no_end_record', line: null });
  for (const account of accounts) for (const item of account.movements)
    item.description = item.concepts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  return { accounts, recordCount: records, warnings };
}

// Common concept codes of the standard (two digits), in the language of Gestió.
export const C43_COMMON_CONCEPTS = Object.freeze({
  '01': 'Talons i reintegraments', '02': 'Ingrés', '03': 'Rebut domiciliat', '04': 'Transferència', '05': 'Préstec',
  '06': 'Remesa', '07': 'Subscripció', '08': 'Dividends', '09': 'Valors', '10': 'Xec carburant', '11': 'Caixer automàtic',
  '12': 'Targeta', '13': 'Operació amb l’estranger', '14': 'Devolució o impagat', '15': 'Nòmina o assegurances socials',
  '16': 'Timbres i corretatges', '17': 'Interessos, comissions i despeses', '98': 'Anul·lació', '99': 'Altres'
});
/** Last four digits only: never the full account number (TREASURY.md §6). */
export const accountMask = account => String(account ?? '').slice(-4);
