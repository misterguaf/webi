// FASE 3.5I — Tresoreria › Moviments › Importar extracte (Cuaderno 43). Select the file downloaded from the bank,
// read the server's preview (nothing is written), review new / already imported / possible duplicates, then
// confirm. Gestió recomputes everything on confirmation; the screen never decides what is new or duplicated.
import { confirmDialog, h, icon, toast } from '../../ui.js';
import { formatDay, formatEur, formatShortDay } from './model.js';
import { ACCEPT, INCIDENT_COPY, MAX_FILE_BYTES, PREVIEW_FILTERS, ROW_STATUS, filterRows, importErrorCopy, resultLines, roundLabel, toBase64 } from './bank-import-model.js';
import { amountNode, statusBadge } from './movements.js';

const PAGE = 200;
const back = ctx => h('a', { className: 'back-link', attrs: { href: '#/tresoreria/moviments' }, on: { click: event => { event.preventDefault(); ctx.back('moviments'); } } }, icon('arrow-left'), 'Moviments');
const fact = (label, value) => h('div', { className: 'fact' }, h('span', { className: 'fact-label', text: label }), h('span', { className: 'fact-value fact-value-small', text: value }));

export function renderBankImport(root, ctx) {
  if (!ctx.caps().treasury?.importMovements) {
    root.replaceChildren(back(ctx), h('div', { className: 'activity-surface' }, h('p', { className: 'empty-detail', text: 'No tens permís per a importar extractes.' })));
    return;
  }
  let file = null, bytes = null, preview = null, positionId = null, filter = 'all', shown = PAGE, busy = false;
  const input = h('input', { attrs: { type: 'file', accept: ACCEPT, id: 'bankStatementFile', 'aria-describedby': 'bankStatementHelp' } });
  const status = h('div', { className: 'import-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const body = h('div', { className: 'import-body' });
  root.replaceChildren(back(ctx),
    h('header', { className: 'detail-header treasury-detail-header' }, h('h2', { className: 'detail-title', text: 'Importar extracte bancari', attrs: { tabindex: '-1' } }),
      h('p', { className: 'detail-context', text: 'Puja l’arxiu C43 (Norma 43) que descarregues de la banca en línia. Primer veuràs què s’importaria; no es guarda res fins que ho confirmes.' })),
    h('div', { className: 'activity-surface import-drop' },
      h('label', { className: 'import-file', attrs: { for: 'bankStatementFile' } }, icon('bank'), h('span', { text: 'Tria l’arxiu de l’extracte' })),
      input,
      h('p', { className: 'field-hint', attrs: { id: 'bankStatementHelp' }, text: 'Arxiu de text C43 (.txt, .c43, .n43), un compte per arxiu, màxim 2 MB. Si el període se solapa amb un altre extracte, els moviments repetits no es tornen a afegir.' }),
      status),
    body);
  root.querySelector('.detail-title')?.focus({ preventScroll: true });

  input.addEventListener('change', async () => {
    file = input.files?.[0] ?? null; preview = null; positionId = null; filter = 'all'; shown = PAGE; body.replaceChildren();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { status.textContent = importErrorCopy('c43_too_large'); return; }
    bytes = new Uint8Array(await file.arrayBuffer());
    await analyse();
  });

  const payload = () => ({ filename: file.name.replace(/[/\\]/g, '_').slice(0, 120) || 'extracte.txt', contentBase64: toBase64(bytes), ...(positionId ? { positionId } : {}) });
  async function analyse() {
    status.textContent = 'Llegint l’extracte…'; body.setAttribute('aria-busy', 'true');
    try {
      preview = await ctx.call('/api/finance/bank-statements/preview', { method: 'POST', body: JSON.stringify(payload()) });
      status.textContent = preview.ok ? `Extracte llegit: ${preview.counts.detected} moviments.` : '';
      paint();
    } catch (error) {
      status.textContent = '';
      body.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: importErrorCopy(error) })));
    } finally { body.removeAttribute('aria-busy'); }
  }

  function paint() {
    if (!preview.ok) {
      body.replaceChildren(h('div', { className: 'inline-error', attrs: { role: 'alert' } }, h('p', { text: importErrorCopy(preview.error) }),
        h('p', { className: 'tx-sub', text: 'No s’ha importat res. Revisa que siga l’extracte complet descarregat del banc.' })));
      return;
    }
    const { counts, statement } = preview;
    const parts = [];
    if (!preview.position) {
      const select = h('select', { attrs: { 'aria-label': 'Compte del grup' } }, h('option', { text: 'Tria el compte…', attrs: { value: '' } }),
        ...preview.positionChoices.map(choice => h('option', { text: `${choice.name}${choice.mask ? ` · ····${choice.mask}` : ''}`, attrs: { value: choice.id } })));
      parts.push(h('div', { className: 'activity-surface form-notice' },
        h('p', { text: `No s’ha reconegut automàticament el compte ····${statement.accountMask}. Tria a quin compte del grup correspon.` }),
        h('label', { className: 'select-field' }, select),
        h('button', { className: 'btn btn-secondary', text: 'Continua', attrs: { type: 'button' }, on: { click: () => { if (select.value) { positionId = select.value; void analyse(); } } } })));
    }
    parts.push(h('div', { className: 'summary-strip import-summary' },
      fact('Arxiu', preview.file.name), fact('Compte', `····${statement.accountMask}${preview.position ? ` · ${preview.position.name}` : ''}`),
      fact('Període', `${formatDay(statement.startDate)} – ${formatDay(statement.endDate)}`),
      fact('Saldo inicial', formatEur(statement.openingCents, { signed: true })), fact('Saldo final', formatEur(statement.closingCents, { signed: true }))));
    parts.push(h('div', { className: 'summary-strip import-counts' },
      fact('Moviments detectats', String(counts.detected)), fact('Nous', String(counts.new)), fact('Ja importats', String(counts.duplicates)),
      fact('Possibles duplicats', String(counts.possibleDuplicates)), fact('Amb incidències', String(counts.incidents))));
    if (preview.alreadyImported) parts.push(h('p', { className: 'form-notice', attrs: { role: 'note' }, text: 'Este arxiu ja s’havia importat. No hi ha res nou per afegir.' }));
    if (preview.position && !preview.conceptsVisible)
      parts.push(h('p', { className: 'tx-sub', text: 'Els conceptes bancaris originals no es mostren: cal el permís explícit per a veure’ls. Es veu el tipus d’operació.' }));
    const rows = filterRows(preview.rows, filter);
    if (preview.position) {
      parts.push(h('div', { className: 'filter-chips', attrs: { role: 'group', 'aria-label': 'Filtra els moviments' } }, PREVIEW_FILTERS.map(item =>
        h('button', { className: 'filter-chip', text: `${item.label} (${filterRows(preview.rows, item.value).length})`, attrs: { type: 'button', 'aria-pressed': String(item.value === filter) },
          on: { click: () => { filter = item.value; shown = PAGE; paint(); } } }))));
      parts.push(rows.length ? h('ul', { className: 'tx-list import-list', attrs: { role: 'list', 'aria-label': 'Moviments de l’extracte' } }, rows.slice(0, shown).map(rowNode))
        : h('p', { className: 'empty-detail', text: 'Cap moviment en este filtre.' }));
      if (rows.length > shown) parts.push(h('button', { className: 'btn btn-secondary list-more', text: 'Mostra’n més', attrs: { type: 'button' }, on: { click: () => { shown += PAGE; paint(); } } }));
      const confirm = h('button', { className: 'btn btn-primary', text: counts.new + counts.possibleDuplicates ? `Confirmar importació (${counts.new + counts.possibleDuplicates})` : 'No hi ha res nou per importar',
        attrs: { type: 'button', disabled: preview.alreadyImported || !(counts.new + counts.possibleDuplicates) }, on: { click: () => void confirmImport() } });
      parts.push(h('div', { className: 'detail-actions import-actions' }, confirm));
    }
    body.replaceChildren(...parts);
  }

  const rowNode = row => h('li', { className: 'tx-row import-row' },
    h('span', { className: 'tx-date', text: formatShortDay(row.operationDate) }),
    h('span', { className: 'tx-label' }, h('span', { className: 'tx-label-text', text: row.concept ?? row.category ?? row.label }),
      h('span', { className: 'tx-sub', text: [roundLabel(row.round), ...row.incidents.map(code => INCIDENT_COPY[code] ?? code)].join(' · ') })),
    amountNode(row.amountCents),
    h('span', { className: 'tx-status' }, statusBadge(ROW_STATUS[row.status] ?? { label: row.status, tone: 'neutral' })));

  async function confirmImport() {
    if (busy) return;
    const { counts } = preview;
    if (!await confirmDialog({ title: 'Importar l’extracte?', confirm: 'Importa',
      body: `S’afegiran ${counts.new + counts.possibleDuplicates} moviments al compte ${preview.position.name}. ${counts.duplicates ? `${counts.duplicates} ja estan a Gestió i no s’afegiran. ` : ''}${counts.possibleDuplicates ? `${counts.possibleDuplicates} quedaran marcats per a revisar. ` : ''}Res no es classifica automàticament.` })) return;
    busy = true;
    try {
      const result = await ctx.call('/api/finance/bank-statements', { method: 'POST', body: JSON.stringify({ ...payload(), positionId: preview.position.id, expectedFileHash: preview.file.hash }) });
      void ctx.refreshSummary();
      toast('Extracte importat.', { tone: 'ok' });
      body.replaceChildren(h('div', { className: 'activity-surface import-result', attrs: { role: 'status' } },
        h('h3', { className: 'info-title', text: 'Importació feta' }), ...resultLines(result.counts).map(text => h('p', { text })),
        h('div', { className: 'detail-actions' },
          h('button', { className: 'btn btn-primary', text: 'Revisa els moviments pendents', attrs: { type: 'button' }, on: { click: () => ctx.go({ path: ['moviments'], query: { estat: 'pendents' } }) } }),
          result.counts.flagged ? h('button', { className: 'btn btn-secondary', text: 'Revisa els possibles duplicats', attrs: { type: 'button' }, on: { click: () => ctx.go({ path: ['moviments'], query: { estat: 'duplicats' } }) } }) : null)));
      status.textContent = 'Importació feta.';
      input.value = '';
    } catch (error) {
      toast(importErrorCopy(error), { tone: 'danger' });
      if (['import_conflict', 'c43_file_changed'].includes(error.code)) await analyse();
    } finally { busy = false; }
  }
}
