# FASE 3.5 — Remediació de l'auditoria independent

Estat: **EN CURS** · Branca: `phase/3.5-audit-remediation` · Base: checkpoint `5e59e37` (`phase/3.5-design`)
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

## Batch 3 · Batch 4

Pendents.
