# FASE 3.5 — Remediació de l'auditoria independent

Estat: **COMPLETADA EN LOCAL** · Branca: `phase/3.5-audit-remediation` · Base: checkpoint `5e59e37` (`phase/3.5-design`)
Entorn: només local i sintètic. Cap recurs remot, cap desplegament, cap dada real.

Aquest document registra, per a cada troballa de l'auditoria independent de 2026-09-29, l'evidència,
la decisió, la solució aplicada, les proves i l'estat. Les decisions de producte que no estaven
resoltes es marquen **DECISION REQUIRED** i no s'improvisen.

Llegenda d'estat: **FET** (implementat i provat localment) · **PARCIAL** · **DIFERIT** · **DECISION REQUIRED**.
"Provat" vol dir proves locals automàtiques; no equival a producció verificada.

## Decisions de producte d'entrada (no reobrir)

1. `SECTION_COORDINATOR` amb grant individual `activities.general.manage` pot crear, editar, publicar i
   tancar activitats GENERAL. És deliberat.
2. L'abast operatiu de participants i quotes es decideix per la **secció actual** del participant. Una
   relació històrica no conserva accés.
3. El portal familiar continua sent una superfície d'escriptura limitada.
4. Stack sense canvis: Workers, D1, R2, JavaScript ESM, sense framework frontend.

## Baseline

- `5e59e37 chore: checkpoint phase 3.5 before audit remediation` a `phase/3.5-design` (pujada a `origin`).
- Abans del checkpoint: `npm test` 137/137, `lint`, `typecheck` i `git diff --check` en verd.
- El checkpoint inclou també una actualització de `test/gestio-recovery.test.js` (esquema 10) que ja era
  al working tree abans d'aquesta fase; no l'ha creada aquesta remediació.

---

## Batch 1

### 3.5C.1 — Tancament de l'estat bàsic de quotes

| Comprovació | Resultat |
|---|---|
| Abast per secció del coordinador | VERIFICAT: la consulta aplica `current_section_id IN (scopes)` en D1 (`annual-fee-status.js`). |
| Estats visibles | VERIFICAT: `PAID/PARTIAL/PENDING/ISSUE` des de la vista autoritativa; la UI mostra Pagada/Parcial/Pendent/Incidència. |
| Sense detall financer | VERIFICAT: només `participantId, displayName, sectionCode, status` i id/codi de ronda; test amb regex de camps prohibits. |
| Secció actual mana | VERIFICAT: test que mou un participant de secció i el retira de l'abast anterior. |
| Frontera server-side | VERIFICAT: un `sectionId` del client no amplia l'abast; tots els endpoints financers continuen en 403. |
| Tresoreria conserva capacitats | VERIFICAT: `finance.fee.*` sense canvis per a TREASURY i GROUP_COORDINATOR. |
| Dashboard | Corregit a M2: ara usa `capabilities.fees.status` en lloc d'un 403 de `/api/fees/rounds`. |
| Migració 0010 | VERIFICAT en instal·lació nova (rols buits en migrar; el seed afegeix grants condicionals) i migrada (grant només a coordinadors vigents amb lectura de participants). 0010 és ara històrica: no es modifica. |

Canvi menor: un titular d'abast global de `finance.fee.status.read` rep ara totes les seccions en lloc d'un
403 incoherent. Cap rol del seed el té; és coherent amb el catàleg SCOPED.

Deute detectat: rols i permisos només existeixen via `seed.sql`; una instal·lació de producció no tindria
catàleg. Es resol al Batch 3 (provisió d'identitats).

### M1 — Catàleg explícit de permisos

**Evidència.** `authorize()` sense `sectionId` concedia a un titular d'abast de secció; la seguretat
depenia que cada crida filtrés `decision.sections` o usés `globalPermission`. `activities.general.manage`
en `SECTION_COORDINATOR` funcionava per aquesta via implícita.

**Decisió.** Dos tipus, sense tercer tipus CONTEXTUAL:
- `GLOBAL`: recurs de grup sense secció. S'avalua sense `sectionId`. Cal assignació de rol sense secció,
  excepte si el catàleg declara `scopedHolders: 'ALLOWED'` (només `activities.general.manage`, per decisió
  de producte).
- `SCOPED`: recurs de secció. Cada avaluació declara la forma: `{sectionId}` (un recurs), `{mode:'list'}`
  (retorna abast; `null` = totes) o `{mode:'all-sections'}` (operació de grup amb autoritat global).
  Sense forma → `SCOPE_REQUIRED` (falla tancat).

Justificació de no crear CONTEXTUAL: permisos com `finance.fee.read` són de secció per naturalesa; les seues
operacions de grup (rondes, agrupacions familiars) ja s'expressen amb `mode:'all-sections'`. Un tercer
tipus només duplicaria semàntica.

**Solució.** `gestio/src/permissions.js` (catàleg), `decideScope()` pura a `policy.js`,
`requireGroupWide()` a `common.js`. Totes les crides revisades: llistats amb `mode:'list'`, operacions de grup
amb `requireGroupWide`, inscripcions sense secció amb `mode:'all-sections'`, detall d'activitat mogut a
`activityDetail()`.

**Proves.** `test/gestio-permissions.test.js`: catàleg = esquema; formes d'avaluació que fallen tancat;
matriu de fronteres per als 7 rols; un permís GLOBAL enganxat per error a un rol de secció no dona poder de
grup; ruta completa GENERAL per a coordinador amb grant i 403 sense grant.

**Estat: FET.**

### M2 — Capacitats efectives a `/api/me`

**Evidència.** El frontend cridava tots els mòduls i interpretava 403; cada denegació escrivia `AUTHZ_DENY`.
`Nova activitat` depenia de llegir el detall d'una activitat GENERAL existent.

**Solució.** `GET /api/me` retorna `capabilities` (versió 1), calculades amb una única consulta de grants
efectius i la mateixa `decideScope()` que la política:

```text
participants.read
activities.read | manage | manageGeneral | reviewRegistrations | verifyPayments
fees.status | read | manage | reviewPayments | authorizeInstallments | configure
administration.audit | suspendUsers | manageUsers | manageRoles | managePermissions |
               provisionDelegations | ratifyDelegations | manageHealthGrants | manageIncidents
```

Un abast és `null` (no permés), `{all:true, sections:[]}` o `{all:false, sections:[{id,code}]}`. No inclou
imports, dates, contactes ni identificadors de persones. És orientatiu: cada operació continua autoritzant-se
al servidor.

Frontend: `app.js`, `dashboard.js`, `fees.js` i `shell.js` només demanen mòduls permesos. `Nova activitat`
apareix amb `activities.manage` o `activities.manageGeneral`. El Dashboard només demana inscripcions
d'activitats on l'abast del revisor coincideix.

**Proves.** Capacitats de tots els rols del seed coincideixen amb la política i generen 0 `AUTHZ_DENY`;
tests de Dashboard verifiquen que no es demanen endpoints no permesos i que un usuari sense capacitats no fa
cap petició de mòdul.

**Estat: FET.**

---

## Batch 2

### A1 — Aïllament del portal

**Evidència.** `portal/worker.js` importava serveis de `gestio/src/` i `portal/wrangler.toml` enllaçava la
mateixa D1/R2 que Gestió: un error al Worker públic (contrasenya compartida) arribava a tota la base.

**Decisió.** Service binding amb entrypoint estret. No cal una segona D1: el service binding és viable i
s'ha verificat en workerd local (mateix procés, dos processos i registre de desenvolupament aïllat).

**Solució.**
- `gestio/src/intake.js` exporta `PortalIntake`, entrypoint amb nom (objecte `fetch`, sense dependència de
  `cloudflare:workers`, per a poder provar-lo en Node). No està encaminat des del router públic de Gestió.
- Contracte v1, només `POST` + JSON: `/v1/catalog`, `/v1/registrations`, `/v1/fees`. Llista blanca de claus;
  les versions dels textos legals les fixa Gestió, mai el portal. Errors `{ok:false, code}`; cap resultat de
  matching, candidat ni identificador intern creua la frontera (mateixa resposta per a coincidència clara,
  ambigua o inexistent). `/v1/fees` retorna la referència del pagament, com abans.
- `portal/worker.js` ja no importa res de `gestio/` ni llig `env.DB`/`env.EVIDENCE_STORAGE`; parla amb
  `env.GESTIO_INTAKE`. Sense binding → 503 (falla tancat).
- `portal/wrangler.toml`: sense D1/R2 en cap entorn; `[[services]] GESTIO_INTAKE → PortalIntake` a producció
  (`parpallo-gestio`, encara inexistent; desplegament bloquejat) i a local (`parpallo-gestio-local`).
- `scripts/check-cloudflare-config.js` (CI) rebutja qualsevol binding de dades al portal i exigeix l'entrypoint.
- Launcher: l'opció "Portal" arrenca també Gestió; `portal/dev.js` ja no comparteix l'estat D1.
- Els tests d'integració 3A/3B arrenquen Gestió + portal amb un **registre de desenvolupament privat**
  (`WRANGLER_REGISTRY_PATH`) i ports d'inspector explícits.

Troballa durant la implementació: amb el registre global, el binding local pot resoldre's contra un altre
procés `wrangler dev` amb el mateix nom (verificat amb un "impostor" en un prototip). Als tests s'usa sempre
un registre privat; en el desenvolupament manual cal no tindre dues instàncies de Gestió obertes.

**Proves.** `test/portal-intake.test.js` (frontera estàtica; el portal amb un `env` que falla si toca
`DB`/`EVIDENCE_STORAGE`; només tres operacions; sense binding → 503; rutes estretes, `POST` només, tancat en
producció; resposta anti-enumeració; extrem a extrem en procés). `gestio-3a` i `gestio-3b` recorren el
binding real en workerd.

**Estat: FET** en local. Producció: DIFERIT fins que existisca el Worker `parpallo-gestio` remot.

### M4 — Minimització en el matching

**Solució.** `matchCandidates()` compartit per inscripcions i quotes: el servidor compara la data declarada i
retorna `birth_date_matches` i `name_matches`. Per defecte només llista candidats plausibles (token de nom
compartit o mateixa data; s'ignoren partícules i marcadors sintètics); la resta requereix `?search=` explícit.
Màxim 20 amb `truncated`. La data completa només apareix si el revisor té `participants.profile.read` sobre
la secció del candidat. Cap fusió ni creació automàtica: continua la revisió humana.

**Proves.** `test/gestio-matching.test.js`: revisor delegat sense perfil no rep dates; no s'enumeren membres no
relacionats; cerca explícita limitada i marcada; revisor amb perfil sí veu la data; quotes amb la mateixa regla.

**Estat: FET.**

### M7 — Política d'entorn centralitzada

**Solució.** `gestio/src/environment-policy.js` és l'únic lloc amb:
- entorns `local-synthetic` (`APP_ENV=development`), `test` (`APP_ENV=test`) i `production`;
- `assertRuntime`, `hostAllowed`, `devIdentityEnabled`, `portalIntakeEnabled` (tancat a producció);
- `DATA_MODE = 'SYNTHETIC_ONLY'` i les tanques sintètiques (domini `@example.test`, marca `synthetic` a
  justificants, referències `DEMO-`, versions de textos legals, justificació administrativa, marcadors de nom).

Obrir producció serà un canvi revisat d'aquest únic mòdul contra la checklist de posada en marxa.

**Proves.** `test/gestio-environment.test.js`, inclosa una comprovació estàtica que cap servei ni el Worker
contenen `@example.test`, `DEMO-`, `'synthetic'` ni `APP_ENV`.

**Estat: FET** per a Gestió. El portal manté només comprovacions d'origen/cookie pròpies (HTTP, no dades).

## Batch 3

### A2 — Base del domini de participants (migració 0011)

**Evidència.** `participant` només tenia id, nom, secció actual, estat i data de naixement; `participant_contact`
un únic correu. Sense tutors, contactes extensibles, historial de secció ni consentiments.

**Anàlisi de FAMILY/HOUSEHOLD.** No es crea cap entitat persistent de família. El domini actual queda cobert per:
(a) `participant_guardian` N:M, que representa qui té relació legal/de cura; (b) `annual_fee_family_group`,
l'agrupament explícit i auditable de germans per ronda que usa la regla de descompte. Compartir tutor no
s'utilitza per a inferir germans (regla 3B: mai inferir família). Si en el futur cal una llar persistent
(p. ex. comunicacions per llar), serà una decisió de producte nova.

**Solució.**
- `participant_section_membership`: participant, secció, `started_at`/`ended_at`, motiu d'inici/fi. Triggers
  la mantenen coherent amb `participant.current_section_id` (projecció ràpida que continua governant l'abast):
  alta → ENROLMENT; canvi de secció → tanca TRANSFER i obri; baixa → DEACTIVATION; reactivació → REACTIVATION.
  Historial només de tancament: no es pot reescriure ni esborrar; una fila oberta incoherent amb la projecció és
  rebutjada. Backfill d'una fila `BACKFILL` per participant existent.
- `guardian` + `participant_guardian` (N:M; relació `PARENT|LEGAL_GUARDIAN|OTHER`, representant legal, vigència).
- `contact_point`: propietari únic (participant o tutor), `EMAIL|PHONE`, finalitat `GENERAL|NOTIFICATIONS`,
  un sol principal vigent per propietari/tipus/finalitat, validació de format. `participant_contact` queda
  DEPRECATED: s'ha migrat i es manté reflectit per triggers perquè demo i fixtures continuen funcionant.
- `consent_record` append-only + vista `participant_consent_current` (última decisió per participant i codi).
- Detall de participant (`GET /api/participants/:id`) inclou `sectionHistory`; l'abast continua sent la secció actual.
- Backup/restore (`recovery.js`) inclou les taules noves, els objectes obligatoris, tanques sintètiques
  (contactes, tutors, invitacions) i invariants de coherència historial↔projecció.

**No inclòs (per disseny).** Salut; UI de Participants; endpoints d'escriptura de tutors/contactes/consentiments.

**DECISION REQUIRED.**
- Quin permís governa llegir contactes i tutors (`participants.profile.read` o un de nou `participants.contact.read`).
- Catàleg definitiu de `consent_code` i textos/versions legals associats.
- Taxonomia final de relacions de tutor (hui mínima i reversible).

**Proves.** `test/gestio-participant-domain.test.js` (instal·lació neta, backfill en BD existent, historial,
immutabilitat, abast per secció actual, N:M, contactes, consentiments). `gestio-recovery` verifica backup i
restore en D1 local real amb els nous triggers.

**Estat: FET** (base de domini). Alta individual i importació: DIFERIT a 3.5E (reutilitzaran aquest model).

### Provisió d'identitats (migració 0012)

**Evidència.** Usuaris, identitats, rols, permisos, matriu i seccions només existien via `seed.sql`: una
instal·lació neta no tenia política i donar d'alta algú requeria SQL manual.

**Solució.**
- 0012 insereix (idempotent) seccions, rols, permisos i la matriu rol→permís per defecte; el seed passa a
  `INSERT OR IGNORE`. Test: instal·lació sense seed = mateix catàleg.
- API protegida per `auth.user.manage` (GLOBAL), amb sessió recent: `GET/POST /api/users`,
  `GET /api/users/:id`, `POST /api/users/:id/invitations`, `DELETE .../invitations/:id`,
  `DELETE .../identities/:id`. Rols i grants continuen amb les rutes existents.
- Invitació per correu verificat per a l'emissor configurat (`identityIssuer`: Access a producció, IdP
  sintètic en local). El primer login d'Access amb eixe correu lliga el `sub` estable i consumeix la
  invitació en un batch atòmic; l'auditoria `IDENTITY_LINKED` només s'escriu si el lligam existeix.
- No hi ha autoregistre: sense invitació, 401. No hi ha auto-provisió: ningú es pot convidar a si mateix
  (també CHECK en BD). Una identitat revocada no es torna a lligar en silenci i en revocar-la es tanquen les
  sessions. Mentre `DATA_MODE=SYNTHETIC_ONLY`, noms i correus han de ser sintètics.

**Proves.** `test/gestio-identity.test.js`, inclòs un login Access RS256 extrem a extrem en mode producció.

**Estat: FET** en local. Producció: depén d'Access/MFA reals (PRODUCTION_BLOCKER existent).

### M6 — Paginació

**Solució.** `gestio/src/pagination.js` (cursor opac, keyset, límit 1–200, per defecte 100, validació
estricta). Llistats paginats amb `nextCursor`: participants, activitats, inscripcions, pagaments d'activitat,
obligacions, estat bàsic de quotes, pagaments de quota, incidències, agrupacions familiars, delegacions,
usuaris. Cerques limitades retornen `truncated` (participants per a quota, candidats de matching).
Frontend: `public/api.js::fetchAllPages` segueix el cursor i, si una llista supera 50 pàgines, ho diu en
lloc de mostrar-la incompleta.

Límits que queden, documentats: històrics de revisions (50/100 files), catàleg públic d'activitats (100
publicades), rondes (30). No són llistats operatius on el truncament amague feina pendent.

**Proves.** `test/gestio-pagination.test.js` amb >100 participants, obligacions, estats i inscripcions.

**Estat: FET.**

## Batch 4

### M3 — Govern de privilegis (migració 0013)

**Evidència.** `authorized_by` era una afirmació de qui provisionava (p. ex. TECH_ADMIN); no hi havia cap
comprovació que ratificador ≠ provisionador; un GROUP_COORDINATOR podia assignar qualsevol rol elevat.

**Solució (part inequívoca).**
- `delegated_permission_confirmation`: l'autoritzador nomenat confirma (`POST /api/delegations/:id/confirm`,
  amb `auth.permission.authorize` sobre la secció). Si qui provisiona és el mateix autoritzador, la
  confirmació es registra en el mateix acte.
- Ratificar exigeix confirmació prèvia i una persona diferent del provisionador i del destinatari.
- Prohibida l'autodelegació (destinatari ≠ provisionador i ≠ autoritzador). Tot això també en triggers.
- Delegacions ja ratificades abans de 0013: confirmació marcada `legacy=1` (no es tornen a demostrar).
- Rols elevats (`GROUP_COORDINATOR`, `TREASURY`, `TECH_ADMIN`): només els assigna una coordinació general
  vigent, amb auditoria `ELEVATED_ROLE`. No es pot retirar ni desactivar l'última coordinació general;
  la suspensió de seguretat continua permesa (seguretat per damunt de disponibilitat).
- Hook de reautenticació: `requireFresh` → `RECENT_AUTHENTICATION_MS` (environment-policy). Requisit de
  producció: la sessió ha de nàixer d'un login recent d'Access amb MFA (no verificable en local).
- Regressió trobada i corregida: assignar un rol ja actiu retornava 500; ara 409 `role_already_assigned`.

**DECISION REQUIRED.** Aprovació a dues persones per a rols elevats (depén de quantes coordinacions
hi haurà); caducitat obligatòria dels rols elevats; si una mateixa persona pot tindre `TECH_ADMIN` i un
rol amb accés a dades.

**Proves.** `test/gestio-governance.test.js`; 3A/3B inclouen ara el pas de confirmació.

**Estat: FET** (part inequívoca).

### M5 — Qualitat real

- `tsconfig.gestio.json`: `checkJs` no estricte sobre tot `gestio/src`, `gestio/worker.js` i el portal
  (errors de contracte i propietats; ha detectat i corregit dos errors reals de tipus). `tsconfig.check.json`
  (estricte) incorpora `permissions.js` i `environment-policy.js` anotats. `npm run typecheck` executa tots dos.
  Mode estricte a tot el codi: 969 avisos, majoritàriament `any` implícit en codi dens → DIFERIT i gradual.
- `test/gestio-smoke.test.js` (`npm run test:smoke`): Gestió + portal sobre workerd amb `wrangler dev`,
  estat i registre temporals: CSP, login, capacitats, cursor en D1 real i escriptura del portal via
  `PortalIntake`. ~7 s. Complementa els tests `node:sqlite`.

**Estat: FET** (gradual).

### M8 — Frontend modular

Convenció `gestio/public/view-registry.js` (`available/load/unload/enter`). `app.js` passa a ser arrel de
composició (sessió, login local, registre). Vistes: `views/activities.js`, `views/registrations.js`,
`views/simple-views.js` (compte, participants, quotes, estat bàsic, dashboard). Client HTTP i etiquetes
compartides en `http.js` i `labels.js`. Sense framework i sense redisseny d'Activitats. Verificat en
navegador sobre un Gestió local temporal (sessió de coordinació de Tropa: 0 respostes 403, sense errors CSP).

**Proves.** `test/gestio-views.test.js` i els tests de shell/dashboard existents.

**Estat: FET.**

### Troballes baixes

| Id | Solució | Estat |
|---|---|---|
| L1 | Lectures d'un recurs concret fora d'abast (detall d'activitat, inscripcions d'activitat, evidències, detall de pagament de quota, candidats, detall d'obligació) → 404 com un recurs inexistent; la denegació continua auditada (`OUT_OF_SCOPE`). Sense permís: 403. Escriptures sense canvis. | FET |
| L2 | CSP estricta a Gestió (sense `unsafe-inline`), `frame-ancestors 'none'`, `X-Frame-Options: DENY`; script de tema a `theme-init.js` (síncron, sense parpelleig) i estil inline del sprite a CSS. | FET |
| L3 | Mètriques de quota amb abast de secció: persona vinculada → secció actual; no vinculada → declarada; obligacions finançades també dins d'abast (igual que `listFeePayments`). Regressió. | FET |
| L4 | Patró `version=CASE…ELSE NULL` documentat i encapsulat en `gestio/src/concurrency.js` (`versionCas`), sense canviar el mecanisme. | FET |
| L5 | Vegeu anàlisi següent. | FET/DIFERIT |
| L6 | Domini canònic `inscripcions.grupscoutparpallo.com` a `portal/wrangler.toml`, `.env.example`, `PRE-LANZAMIENTO.md` i test. | FET |
| L7 | `CURRENT_STATE`, `IMPLEMENTATION_PLAN`, `DESIGN_INDEX`, `AUTHORIZATION_MODEL`, ADR-007 actualitzats; ADR-009 i ADR-010 nous. | FET |

**L5 — Legacy (demostrat, no a cegues).**
- `api/_lib/handler-quota.js`, `quota.js`, `cuotes.js`, `data/cuotes.json` (+ esquema, 3 tests i fixture):
  cap ruta en temps d'execució els importava (web pública, Worker públic, adaptadors Vercel/Netlify,
  portal, Gestió). **Retirats** (queden a l'historial Git).
- `family/`: DEPRECATED amb condició de retirada "quan el portal estiga en producció", no complida →
  **no s'esborra**; documentat que contradiu ADR-009 i que no s'ha de desplegar.
- `scripts/google-apps-script.gs`: continua servint alta i reserva (Sheets) i documenta el desplegament
  remot legacy de quota pendent de retirar → **es manté**.
- Adaptadors Netlify/Vercel: encara s'usen per a alta/reserva de la web pública mentre no es tria hosting
  → **es mantenen** (decisió de hosting pendent fora d'aquesta fase).

---

## Deute diferit

- Endpoints d'escriptura i UI per a tutors, contactes i consentiments (3.5E), alta individual i importació.
- Tipat estricte de tot `gestio/src` (969 avisos) i del frontend.
- Històrics de revisions i catàleg públic amb límits fixos documentats (no operatius).
- `family/` fins a la posada en producció del portal; retirada de l'Apps Script remot (PRODUCTION_BLOCKER).
- Reautenticació forta amb Access/MFA real, desplegament del Worker `parpallo-gestio` i del binding del portal.
- Registre de desenvolupament global: en local manual, no obrir dues instàncies de Gestió alhora.

## DECISION REQUIRED (recull)

1. Permís per a llegir contactes i tutors (`participants.profile.read` o `participants.contact.read`).
2. Catàleg de `consent_code` i textos/versions legals.
3. Taxonomia final de relació de tutor.
4. Aprovació a dues persones i caducitat de rols elevats; compatibilitat `TECH_ADMIN` + rols amb dades.
