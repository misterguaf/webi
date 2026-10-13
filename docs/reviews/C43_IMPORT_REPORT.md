# Importació bancària C43 (Norma 43) — informe tècnic

Branca `phase/3.5i-c43-import`, creada des de `3d318b6` (punta de `phase/3.5i-tasks-budget-import`, Codex). Sense merge.

## Model reutilitzat

Cap Tresoreria nova. Un extracte és un `finance_import_batch` i cada operació un `finance_movement` immutable, igual
que la importació CSV sintètica: estat derivat (pendent · parcial · classificat · possible duplicat), descripció
original protegida a `finance_movement_description`, etiqueta minimitzada als llistats, classificació amb
`finance_allocation` (quotes `FEE_PAYMENT`, activitats `ACTIVITY_PAYMENT`, despeses `EXPENSE_SETTLEMENT`, traspassos
`INTERNAL_TRANSFER`, ingressos `INCOME` a una partida del pressupost de la ronda).

Migració `0050_bank_statement_c43.sql` (additiva en dades):
- `finance_import_batch` admet `source_format='C43'` i guarda període, saldos, últims quatre dígits i codificació.
  SQLite no pot ampliar un `CHECK`: les files es guarden a part, la taula es crea de nou amb el mateix nom i les files
  s’insereixen de nou (així les claus foranes diferides dels moviments queden resoltes abans del commit; un `RENAME`
  deixa la violació comptada i D1 desfà la migració). Provada en workerd/D1 amb lots i moviments existents.
- `finance_movement_bank_detail` (nova, immutable): concepte comú/propi, oficina, document, referències i el tipus
  d’identitat usat per a deduplicar. Protegida com la descripció; cap llistat la llig.

## Parser

`gestio/src/domains/finance/c43-parser.js`, pur. Registres 11/22/23/24/33/88 de 80 posicions; imports enters en
cèntims; 1 = càrrec, 2 = abonament; dates AAMMDD validades; fins a cinc complementaris (dues meitats de 38); codificació
UTF-8, Windows-1252 o CP850 (detecció per plausibilitat, o triada). Rebutja el fitxer sencer davant de: línies de
longitud incorrecta, caràcters de control, registres desconeguts o desordenats, comptes que no coincideixen, moneda
diferent d’euro, totals o nombre d’apunts que no quadren, saldo final que no quadra, fitxer tallat, contingut després
del final. Tolera blancs finals retallats, salts LF, Ctrl-Z final i l’absència del registre 88 (avís).

L’estructura s’ha contrastat amb un extracte real llegit només en local, sense copiar-lo, guardar-lo ni imprimir-ne
cap dada: es llig sencer i quadra. Res d’ell és al repositori, als tests ni a Gestió.

## Duplicats

Per moviment, mai per fitxer: amb referència bancària, compte + data + import + concepte comú + referència; sense,
la fila completa (dates, import, codis, oficina, document, referències i concepte normalitzat). En tots dos casos
s’hi afig l’ordinal entre identitats iguals del mateix fitxer, de manera que dos extractes que se solapen coincideixen
moviment a moviment. Mateix compte, data i import però identitat diferent → s’importa marcat `NEAR_MATCH` per a
revisió (mai s’esborra). El mateix fitxer no es pot importar dues vegades. La confirmació torna a analitzar el
fitxer, està lligada al hash previsualitzat i és un sol lot atòmic: si una altra importació s’ha avançat, falla
sencera (`import_conflict`) i es pot tornar a provar.

## Suggeriments

`GET /api/finance/movements/:id/suggestions` (permís de classificar). Només lectura i explicats: ronda per data (una,
cap o diverses), tipus probable (quota, ingrés, despesa, traspàs propi, liquidació de targeta, devolució, comissions),
partida del pressupost de la ronda (fulles actives; mai les de quotes ni d’activitats; mai una partida sota un
encapçalament diferent del que nomena el concepte; empats → alternatives sense triar), pagaments de quota o activitat
verificats amb nom i cognom de l’educand al concepte i import, despeses ja reconegudes amb el mateix import, i
traspassos entre posicions pròpies. Diverses coincidències → `ambiguous`, cap triada. Confirmar passa pels endpoints
de classificació existents, amb totes les seues regles. El text bancari no es retorna mai.

## Seguretat

`finance.movement.import` (només Tresoreria) per a previsualitzar i importar; `finance.movement.classify` per als
suggeriments; el text bancari original només amb la concessió explícita `finance.bank_description.reveal`. Coordinació
de secció, Secretaria i TECH_ADMIN: 403. Màxim 2 MB i 5.000 moviments; cap fitxer es guarda (ni R2 ni registre);
auditoria `BANK_IMPORT_PREVIEWED`, `BANK_IMPORT_CREATED`, `MOVEMENT_IMPORTED` amb només recomptes. `DATA_MODE =
SYNTHETIC_ONLY`: només s’accepten extractes amb el titular marcat com a fictici.

## Interfície

Tresoreria › Moviments › «Importar extracte» (`#/tresoreria/moviments/importar`): selecció de l’arxiu, resum (compte,
període, saldos, detectats, nous, ja importats, possibles duplicats, incidències), filtres, llista amb ronda i estat,
confirmació i resultat. Detall del moviment: bloc «Suggeriments» amb motius i «Confirmar». Escriptori i mòbil.

## Proves

`test/gestio-c43-parser.test.js` (6), `gestio-c43-import.test.js` (8), `gestio-c43-suggestions.test.js` (6),
`gestio-c43-ui.test.js` (3). Flux complet provat al navegador amb un extracte sintètic en un servidor aïllat.

## Una sola realitat econòmica (Inscripcions + Quotes + C43)

`POST /api/finance/movements/:id/fee-reconciliations` (`fee-reconciliation.js`) concilia un cobrament bancari amb
quotes en UN lot atòmic que reutilitza els serveis canònics: la revisió de Quotes (`feeReviewPlan`, extreta de
`reviewFeePayment` sense canviar-ne el comportament) i el conjunt d’assignacions de Tresoreria
(`movementAllocationPlan`, extret d’`allocateMovement`).

- Justificant de la família pendent + moviment: es verifica aquell justificant amb l’import del banc, s’assigna a les
  quotes i es vincula el moviment. El justificant es conserva.
- Sense justificant: es crea el pagament canònic de Quotes per a la transferència (`origin='BANK'`,
  `source_movement_id`, migració 0051 additiva), verificat i vinculat en el mateix lot. No s’envia cap correu.
- Quota ja pagada: el moviment es vincula a aquell pagament (`allocations/add`); Quotes no canvia; si ja estava
  conciliada amb un altre moviment, el nou queda pendent amb l’avís de possible pagament repetit.
- Mai per damunt del pendent de cada quota (tornat a comprovar dins del lot: dues confirmacions simultànies no poden
  cobrir la mateixa quota), mai per damunt del moviment; un excés queda al moviment, pendent de classificar.
- L’ingrés de Tresoreria continua sent, per pagament, el mínim entre el vinculat al banc i l’assignat a quotes.

Els conceptes bancaris els poden llegir les persones autoritzades a consultar moviments (`finance.movement.read`),
amb auditoria; el motor de suggeriments els processa al servidor i no els retorna mai.
