// FASE 3.5I-Q — Quotes UI: human states and issue copy, URL filters, sibling/discount labels, overpayment copy, and
// wiring (first-class screen, Treasury tools at #/quotes/eines, links only from server data, no money in basic mode).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as model from '../gestio/public/views/quotes/model.js';

const source = file => readFileSync(join(import.meta.dirname, '..', 'gestio/public', file), 'utf8');

test('states, quick filters and issue copy are human (never backend codes)', () => {
  assert.deepEqual(['PAID', 'PARTIAL', 'PENDING', 'ISSUE'].map(code => model.statusOf(code).label), ['Pagada', 'Parcial', 'Pendent', 'Incidència']);
  assert.deepEqual(model.QUICK.map(item => item.label), ['Totes', 'Pendents', 'Parcials', 'Incidències', 'Pagades']);
  for (const code of ['BANK_NOT_FOUND', 'OVERPAYMENT', 'EVIDENCE_PROBLEM', 'UNIDENTIFIED_TRANSFER', 'ALLOCATION_UNCLEAR', 'DISCREPANCY', 'NEW_CODE'])
    assert.doesNotMatch(model.issueCopy(code), /_|[A-Z]{4,}/, code);
  assert.equal(model.issueCopy('ALLOCATION_UNCLEAR'), 'No s’ha pogut determinar encara a quina quota correspon el pagament.');
  assert.equal(model.sectionLabel('ESCOLTA'), 'Esculta');
  assert.deepEqual([1, 2, 3, 4, 5].map(model.ordinalLabel), ['1r fill', '2n fill', '3r fill', '4t fill', '5è fill']);
  assert.equal(model.chargedPercent(10000, 5000), 50);
  assert.equal(model.overpaymentCopy([{ amountCents: 2000, status: 'OPEN' }, { amountCents: 500, status: 'RESOLVED' }]).replace(/\s/g, ' '),
    'Quota coberta. Hi ha 20,00 € addicionals pendents de resoldre.');
  assert.equal(model.overpaymentCopy([{ amountCents: 500, status: 'RESOLVED' }]), null);
  for (const code of ['forbidden', 'not_found', 'unallocated_fee_balance']) assert.doesNotMatch(model.errorCopy({ code }), /_/);
});

test('URL filters: unknown values dropped; scope label', () => {
  assert.deepEqual(model.parseFilters({ estat: 'PENDING', seccio: 'TROPA', q: ' marc ', ronda: 'bad' }), { ronda: '', seccio: 'TROPA', estat: 'PENDING', q: 'marc' });
  assert.deepEqual(model.parseFilters({ estat: 'HACK', seccio: 'ESTOL' }), { ronda: '', seccio: '', estat: '', q: '' });
  assert.equal(model.apiQuery({ ronda: '', seccio: 'TROPA', estat: 'ISSUE', q: 'pau' }, 'c1'), 'section=TROPA&status=ISSUE&q=pau&cursor=c1');
  assert.equal(model.scopeLabel(['TROPA']), 'Tropa');
  assert.equal(model.scopeLabel(['MANADA', 'TROPA', 'ESCOLTA', 'CLAN']), 'Tot el grup');
});

test('wiring: first-class Quotes screen, basic mode shows status only, Treasury tools and links from server data', () => {
  const view = source('views/quotes.js'), app = source('app.js'), simple = source('views/simple-views.js'), html = source('index.html');
  assert.match(view, /available: caps => !!\(caps\.fees\.status \|\| caps\.fees\.read\)/);
  assert.ok(view.includes('`/api/quotes?${apiQuery(filters)}`') && view.includes('`/api/quotes/participants/${participantId}'));
  const basic = view.slice(view.indexOf('if (!financial) {'), view.indexOf('const reload = ()')).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(basic, /money\(|evidence|payments|family|reviewHere/, 'the basic detail renders the status only');
  assert.match(view, /evidenceId && data\.actions\.reviewPayments/, 'evidence link only with the review capability (server-decided)');
  assert.match(view, /\/api\/fees\/evidence\/\$\{evidenceId\}\?mode=view/, 'existing private, audited evidence route');
  assert.match(view, /path: \['eines'\], query: \{ pagament: paymentId \}/, 'payment review in the existing Treasury tools');
  assert.match(simple, /\$\('feePanel'\)\.hidden = !\(loaded && route\?\.path\?\.\[0\] === 'eines'\)/, 'legacy panel only at #/quotes/eines');
  assert.match(app, /createQuotesView\(\{ call, reportLoadError, routes, setPageHeader \}\)/);
  assert.doesNotMatch(app, /createFeeStatusView/, 'the basic status panel is superseded by Quotes');
  assert.ok(html.includes('id="quotesView"'));
  assert.match(source('views/participants.js'), /text: 'Veure a Quotes'/, 'participant → Quotes only where the server sent the fee status');
  assert.doesNotMatch(view, /innerHTML|localStorage/);
});
