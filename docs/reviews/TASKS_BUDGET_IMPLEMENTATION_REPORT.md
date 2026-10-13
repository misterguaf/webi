# Implementació — Phase 3.5I: tasques i importació anual

## Candidat i límits

- Base remota verificada: `phase/3.5i-integration`, `149d8a290129bec7cbd05e8a45e56c7a2ed939d2`.
- Branca candidata: `phase/3.5i-tasks-budget-import`.
- SHA final del codi validat: `41d9cf4e3e9887371a24ef6572112b8f2a8706d3`. El candidat lliurat afegeix només aquest informe, la guia i les captures; el seu SHA exacte és HEAD de `phase/3.5i-tasks-budget-import`, registrat al lliurament i a GitHub Actions (un informe versionat no pot contindre el hash del seu propi commit).
- Checkpoint A: `01b2881` (persistència, autorització i calendari), `4c9fe49` (usabilitat i regressions de scope). Checkpoint B: `fe4bf13` (importació atòmica, UI i export semàntic). Checkpoint de recuperació/validació: `41d9cf4`. Checkpoint final de documentació: HEAD de la branca candidata.
- Checkout aïllat, D1/R2 temporal, ports dinàmics. El servidor 8788, la base habitual, els canvis previs de Borja, main, phase/3.5h-admin, tags històrics i stashes queden preservats.
- Sense desplegament, integració canònica, tags de finalització ni Phase J. Aquest document és un informe d'implementació, no una auditoria independent.

## Persistència i permisos de tasques

Migració additiva **0048_tasks.sql**: `task`, `task_member`, índexs de data/propietari/destinatari, identitat immutable, versió i arxiu sense esborrar historial. ID immutable, creador, títol/descripció limitada, visibilitat, secció opcional, data/hora, recurrència, responsables, compleció i versió.

- PERSONAL: només propietari. NAMED: només propietari i destinataris explícits.
- SECTION: lectura i administració amb capacitats vigents de la secció. GROUP: lectura/administració de grup. Assignar mai substitueix el scope necessari ni dona accés a altres dominis.
- Coordinació general administra grup i seccions; coordinació de secció administra la seua. Tresoreria i Secretaria poden llegir tasques de grup. TECH_ADMIN no té bypass. Els destinataris han d'estar actius i tindre un rol vigent de Gestió; no hi ha directori públic.
- SECTION_DELEGATE té sostre d'administració per a delegació explícita, però la migració no li concedeix automàticament administració de tasques de secció. S'apliquen revocació/expiració del sistema actual.
- Propietari/administrador autoritzat edita i arxiva. Administrador o responsable completa/reobri. La compleció és una sola acció compartida, no una compleció per persona.
- CAS de versió en edició/compleció; clau i hash de petició en creació. Auditoria TASK_* sense títol/descripció. La projecció global Activitat no inclou aquestes accions privades.

## Calendari

Primer bloc d'Inici, setmana per defecte; mes, setmana, dia i llista, preferència per usuari, hui, navegació, selecció i creació des de data. Filtres amb SQL de visibilitat i paginació. Símbols i text a més de color. Avisos de hui, vençudes i pendents assignades; les dates i hores s'interpreten en Europe/Madrid. La sessió descarrega estat privat i diàlegs.

Recurrència diària/setmanal/mensual: completar crea una sola següent instància, protegida per `previous_id` únic. No es generen totes les futures. En mensual, el dia original torna després d'un mes curt. Reobrir una ocurrència no elimina la següent; recompletar no la duplica. Les activitats s'obtenen de la seua API autoritzada, sense duplicar persistència, i enllacen al detall existent.

## Excel inspeccionat i parser

Les còpies proporcionades en Downloads coincideixen amb les del repositori:

| Font | SHA-256 |
| --- | --- |
| `PRESSUPOST ANUAL 26_27 (Boceto).xlsx` | `1b190cc4442fbe3adae1f8cb9d465a8a0882abb8eb951e016a333b9ec97befce` |
| `Tesorería General 26_27.xlsx` / `Tesorería General.xlsx` | `ae553d3366c7027db849bbbc1215bc5717d0b766ad316a44664b65126b994838` |

Plantilla anual `PARPALLO_ANNUAL_V1`, full Hoja 1. Detecta ancoratges, ingressos superiors esquerres, despeses superiors dretes i desglossaments inferiors: l'esquerra inferior és de despeses de campaments. Les files/noms/imports venen del llibre. La còpia sintètica 2027/2028 canvia nom i import de Cuina i valida els totals nous sense canviar codi del parser.

Resultat: **65 categories**, ingressos ordinaris **62.950 €**, despeses ordinàries **65.450 €**, RESERVE_USE **2.500 €**, RESERVE_CONTRIBUTION **0 €**. Pares i fills diferenciats; només fulles seleccionables, identitats estables per ronda. Pasqua 2.1.x es normalitza a 2.2.x amb avís. No es creen catàlegs fixos basats en els imports anuals.

Límits: 2 MiB comprimits, 12 MiB expandits, 2 MiB per entrada, 200 entrades/categoríes, 5.000 cel·les/shared strings, 30.000 tags XML; fórmules amb longitud, tokens, referències, profunditat i rang limitats. ZIP streaming amb preflight i comptadors reals. Rebutja xifrat, paths indeguts, macros, binaris incrustats, relacions externes, DTD/ENTITY i arxius malformats. Només aritmètica i SUM local acotats; no executa Excel arbitrari, no usa resultats de fórmula en caché ni consulta recursos externs. Imports absents/no verificables i subtotals incoherents bloquegen confirmació.

## Importació, historial i recuperació

Migració additiva **0049_budget_import.sql**: metadades/procedència de preview i confirmació, hash, actor, ronda, versions, caducitat, referència R2 privada; mapping immutable per ID de partida. Cap modificació de migracions antigues.

Preview sense partides permanents; avisos amb acceptació explícita. Confirmació pel creador del preview amb `finance.budget.propose` vigent, sense ampliar permisos financers a coordinacions de secció o TECH_ADMIN. Batch D1 atòmic amb comprovacions dins de la transacció: ronda/pressupost vigents, esborrany buit, absència de dades financeres usades, una sola importació confirmada per ronda. Protecció de replay, dobles clics, imports simultanis, versions stale, ronda errònia i pressupostos aprovats/usats/tancats. Error a mitjan batch deixa zero partides. Les revisions posteriors continuen usant el mecanisme explícit existent.

Original en R2 privat, metadades auditades sense contingut del fitxer. L'inventari de backup incorpora les quatre taules, índexs i triggers. La prova de recuperació inclou recurrència, destinataris, un pressupost de 65 línies i la procedència. D1 recovery no recupera els binaris R2: un original absent bloqueja l'export del pressupost, no inventa una plantilla.

## Exportació i compatibilitat

L'export anual ompli el llibre privat original a les cel·les d'origen, preservant noms, estructura i fórmules; força recàlcul. El resultat tradicional usa correspondències semàntiques persistides per ID, no només codis. Exemples:

| Concepte anual | Resultat tradicional |
| --- | --- |
| Campaments Nadal/Pasqua/Estiu/SantJordi | Full específic, segons avantpassat i nom |
| Terreny Benicoscoll (4.3) | RESULTADO J33, no Material activitats J32 |
| Roba (4.4) | J46 |
| Wifi (5.4) | J48 |
| Convivència Scouters | J49 |
| Local / XXSS | Sense mapping fiable; avís i bloqueig si hi ha import real |

Reserves i transferències conserven les regles existents. Quotes importades s'identifiquen semànticament; un codi 1.1 desconegut no rep les quotes automàticament. El pressupost importat continua sent l'autoritat. No s'implementa sincronització bidireccional ni substitució silenciosa d'un pressupost aprovat.

## Validació

### Navegador amb dades fictícies

Calendari: creació personal, compartida/responsable, canvi de sessió i comprovació de privacitat, compleció compartida, recurrència setmanal, tasca de Tropa i selector limitat; tasca de grup des de Coordinació general, canvi de data i reobertura. Vistes d'escriptori, tauleta 820 i mòbil 390; sense overflow. Captures a `assets/`.

Pressupost: càrrega del llibre real, 65 partides i totals, avisos, confirmació, fulles d'ingressos/despeses al selector, despesa Cuina reconeguda 10 € amb justificant fictici, ingrés Loteria 20 € pendent de conciliar. Resultat −10 € abans de conciliar l'ingrés. Descàrrega real de dos XLSX: Cuina D54=11.000 €, ESTALVI K35=0 i fórmules conservades; despesa al full C. Verano del resultat (J3=10 €, concepte fictici).

### Automatitzada

- Tasques: privacitat, idempotència, edició, versions, arxiu, compleció/reobertura, recurrència, destinataris inactius, secció/grup, TECH_ADMIN, revocació/expiració, paginació i edicions simultànies.
- Calendari: dates i cablejat/lifecycle/activitats.
- Pressupost: plantilla real i modificada, imports/hierarquia/reserves, fórmula no suportada, ZIP expandit excessiu, macros/relacions externes, autorització, wrong-round, ús històric, aprovació, rollback atòmic, imports concurrents, selecció, mappings i conciliació d'un ingrés importat (0 abans / 1.000 cèntims després, sense doble còmput).
- Full gate `npm run ci`: suite completa executada, **450 tests**, 445 PASS inicials, 4 fallades i 1 cancel·lació per timeout. L'inventari nou supera 100 taules: les consultes de recompte D1 es divideixen en blocs de 50. S'ha mantingut l'ordre del catàleg d'auditoria i ampliat el temps del test local amb 49 migracions. No s'oculten les incidències: es repeteixen els fitxers afectats, no tota la demo lenta. Repeticions de recuperació 3A/3B/2B PASS, inclosa la base poblada amb les noves taules i referències (restore drill 22,2 s). Sessió local final PASS. Els quatre fitxers repetits donen **6/6 PASS**, sense cancel·lacions; totes les incidències de la suite completa estan resoltes.
- Controls finals després de correccions: **lint, typecheck, schema, Cloudflare/config, waitlist, secrets, audit i git diff --check PASS**; audit amb **0 vulnerabilitats**. Pressupost 7/7 i calendari/Activitat 8/8 PASS en repeticions dirigides.
- El test demo usa una excepció limitada a una còpia temporal `gestio-demo-test-*`; fora d'aquesta còpia manté la protecció del port 8788. ESLint omet bundles generats `.wrangler`.
- Actions remotes: workflow **CI**, jobs **verify** i **gitleaks**, sobre el SHA exacte de HEAD. L'execució final i el seu resultat s'identifiquen en el lliurament. Consulta verificable: [Actions de la branca candidata](https://github.com/misterguaf/webi/actions?query=branch%3Aphase%2F3.5i-tasks-budget-import). Es puja únicament aquesta branca, sense force push.

## Deute objectiu i decisions

Local i XXSS necessiten decisió comptable abans de definir un mapping nou. No bloquegen calendari/importació/export anual; sí el resultat tradicional amb imports reals en aquestes categories. Notificacions externes, recurrència avançada, importació revisada i redisseny artístic queden fora de fase. La revisió humana i qualsevol auditoria independent segueixen pendents; no es declara la fase tancada.

Guia: [TASKS_BUDGET_HUMAN_REVIEW.md](TASKS_BUDGET_HUMAN_REVIEW.md).

## Annex: jerarquia reconeguda del llibre real

| Tipus | Codi | Nom | Import previst | Fulla |
| --- | --- | --- | ---: | --- |
| EXPENSE | 1 | ASSEGURANÇA / QUOTA ASDE | 0.00 € | Subtotal |
| EXPENSE | 1.1 | Quota ASDE | 4500.00 € | Sí |
| EXPENSE | 2 | CAMPAMENTS | 0.00 € | Subtotal |
| EXPENSE | 2.1 | Campament de Nadal | 0.00 € | Subtotal |
| EXPENSE | 2.1.1 | Alberg | 5100.00 € | Sí |
| EXPENSE | 2.1.2 | Autobús | 1500.00 € | Sí |
| EXPENSE | 2.1.3 | Altres | 100.00 € | Sí |
| EXPENSE | 2.2 | Campament de Pasqua | 0.00 € | Subtotal |
| EXPENSE | 2.2.1 | Alberg / Terreny | 500.00 € | Sí |
| EXPENSE | 2.2.2 | Autobús | 1600.00 € | Sí |
| EXPENSE | 2.2.3 | Menjar | 1700.00 € | Sí |
| EXPENSE | 2.2.4 | Altres | 200.00 € | Sí |
| EXPENSE | 2.3 | Campament d´Estiu | 0.00 € | Subtotal |
| EXPENSE | 2.3.1 | Autobús | 6000.00 € | Sí |
| EXPENSE | 2.3.2 | Terreny | 3000.00 € | Sí |
| EXPENSE | 2.3.3 | Camió | 5000.00 € | Sí |
| EXPENSE | 2.3.4 | Furgoneta | 1500.00 € | Sí |
| EXPENSE | 2.3.5 | Cuina | 11000.00 € | Sí |
| EXPENSE | 2.3.6 | Visita | 400.00 € | Sí |
| EXPENSE | 2.3.7 | Estol | 100.00 € | Sí |
| EXPENSE | 2.3.8 | Scout | 100.00 € | Sí |
| EXPENSE | 2.3.9 | Esculta | 100.00 € | Sí |
| EXPENSE | 2.3.10 | Clan | 100.00 € | Sí |
| EXPENSE | 2.3.11 | Sopar Infraestructura | 400.00 € | Sí |
| EXPENSE | 2.3.12 | Altres | 800.00 € | Sí |
| EXPENSE | 2.4 | SantJordi | 1200.00 € | Sí |
| EXPENSE | 3 | GASTOS CORRENTS | 0.00 € | Subtotal |
| EXPENSE | 3.1 | Loteria | 5200.00 € | Sí |
| EXPENSE | 3.2 | Despeses activitats Secció | 0.00 € | Subtotal |
| EXPENSE | 3.2.1 | Estol | 750.00 € | Sí |
| EXPENSE | 3.2.2 | Scout | 1000.00 € | Sí |
| EXPENSE | 3.2.3 | Esculta | 500.00 € | Sí |
| EXPENSE | 3.2.4 | Clan | 500.00 € | Sí |
| EXPENSE | 3.3 | Suministres | 600.00 € | Sí |
| EXPENSE | 4 | MATERIAL DE GRUP | 0.00 € | Subtotal |
| EXPENSE | 4.1 | Infraestructura | 1000.00 € | Sí |
| EXPENSE | 4.2 | Local | 3660.00 € | Sí |
| EXPENSE | 4.3 | Terreny Benicoscoll | 3660.00 € | Sí |
| EXPENSE | 4.4 | Roba | 200.00 € | Sí |
| EXPENSE | 5 | ALTRES | 0.00 € | Subtotal |
| EXPENSE | 5.1 | Comunitat | 600.00 € | Sí |
| EXPENSE | 5.2 | Cursos | 640.00 € | Sí |
| EXPENSE | 5.4 | Wifi | 240.00 € | Sí |
| EXPENSE | 5.5 | Convivència Scouters | 400.00 € | Sí |
| EXPENSE | 5.6 | XXSS | 100.00 € | Sí |
| EXPENSE | 5.7 | Altres | 1500.00 € | Sí |
| INCOME | 1 | FINANÇAMENT | 0.00 € | Subtotal |
| INCOME | 1.1 | Quotes | 10000.00 € | Sí |
| INCOME | 1.2 | Loteria | 6000.00 € | Sí |
| INCOME | 1.3 | Subvencions | 3000.00 € | Sí |
| INCOME | 1.4 | Activitats | 0.00 € | Sí |
| INCOME | 2 | CAMPAMENTS | 0.00 € | Subtotal |
| INCOME | 2.1 | Campament de Nadal | 6700.00 € | Sí |
| INCOME | 2.2 | Campament de Pasqua | 4000.00 € | Sí |
| INCOME | 2.3 | Campament d´Estiu | 28500.00 € | Sí |
| INCOME | 2.4 | SantJordi | 1200.00 € | Sí |
| INCOME | 3 | ACTIVITATS SECCIONS | 0.00 € | Subtotal |
| INCOME | 3.1 | Estol | 750.00 € | Sí |
| INCOME | 3.2 | Scout | 1000.00 € | Sí |
| INCOME | 3.3 | Esculta | 500.00 € | Sí |
| INCOME | 3.4 | Clan | 500.00 € | Sí |
| INCOME | 4 | ALTRES INGRESOS | 0.00 € | Subtotal |
| INCOME | 4.1 | Roba | 800.00 € | Sí |
| RESERVE_CONTRIBUTION | 6 | ESTALVI | 0.00 € | Sí |
| RESERVE_USE | 5 | RESERVES PRÒPIES | 2500.00 € | Sí |
