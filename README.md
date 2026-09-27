# Web del Grup Scout Parpalló

La infraestructura nova incorpora `gestio/`, prototip **només local i amb dades fictícies** per a identitat, sessions, D1 i autorització. Instruccions a [gestio/README.md](gestio/README.md). **NOT PRODUCTION READY**; no s'ha creat cap recurs Cloudflare remot ni s'ha modificat la web antiga publicada.

Lloc públic estàtic (HTML, CSS i JS sense framework) amb els endpoints de
sol·licitud de plaça i reserva de botiga. Les inscripcions i quotes viuen en
un segon Worker privat i independent, dins de `portal/`.

> **Este endpoint tracta dades de menors d'edat**, però la llista d'espera no
> demana ni admet dades de salut. Abans d'activar-lo en producció cal tindre
> publicades i enllaçades les pàgines legals, i confirmat qui és el responsable
> del tractament. Vegeu `docs/PRE-LANZAMIENTO.md`.

---

## Estructura

```
site/                          arrel pública del lloc; conserva les URL /pagina.html
site/assets/css/               estils del lloc
site/assets/js/                JavaScript del lloc
site/assets/img/               imatges i icones
site/_headers                  capçaleres de Cloudflare Pages i Netlify
site/robots.txt, sitemap.xml   fitxers públics de rastreig
api/_lib/validate.js           validació de servidor + filtre anti-spam
api/_lib/ratelimit.js          límit de peticions
api/_lib/sheets.js             adaptador legacy d'alta, reserva i quota
api/_lib/handler.js            nucli de l'endpoint, independent de la plataforma
api/_lib/quota.js              càlcul de quota legacy, deprecated per a nous enviaments
portal/                        frontend familiar canònic i Worker d'activitats 3A / quota 3B
gestio/                        serveis 3A/3B, D1 local i plataforma interna
family/                        frontend anterior deprecated, sense ruta familiar canònica
api/alta.js                    adaptador Vercel
netlify/functions/alta.js      adaptador Netlify (també reserva.js)
worker.js                      adaptador Cloudflare Workers
scripts/dev.js                 servidor local de proves
scripts/google-apps-script.gs  script per a enganxar al projecte d'Apps Script
data/activitats.json           fixture/catàleg legacy; no governa les activitats noves
data/cuotes.json               configuració de quota legacy; no governa les quotes noves
test/alta.test.js              proves automàtiques
docs/                          guies, textos i documentació del projecte
Launchers/                     accessos locals per a obrir els servidors
```

Alta i reserva conserven l'adaptador legacy d'`api/_lib/`. El codi antic de quota es
manté deprecated, sense ruta des del portal canònic. Les activitats
noves passen de `portal/worker.js` als serveis 3A de `gestio/`: catàleg
`PUBLISHED` en D1, matching, revisió de pagament, abstracció de storage per als
justificants i notification outbox. Les úniques rutes públiques de la web
general són `POST /api/alta` i `POST /api/reserva`; `/api/inscripcio` només
existix darrere de la sessió del portal privat.

La FASE 3B porta les quotes noves de `portal/` a D1 local, storage emulat i
outbox fictici. `gestio/` gestiona la ronda, obligacions, agrupacions explícites,
fraccionaments i assignacions després de comprovar el banc. Tot funciona només
amb dades sintètiques; no hi ha enviament de correu ni recursos remots. Vegeu
[informe 3B](docs/PHASE_3B_REPORT.md). Abans de dades reals, cal verificar i
desactivar qualsevol endpoint remot de quota legacy d'Apps Script.

---

## Variables d'entorn

| Variable | Obligatòria | Què és |
|---|---|---|
| `SHEETS_WEBHOOK_URL` | Per als fluxos legacy | URL d'Apps Script per a alta i reserva; mai per a activitats o quotes noves. |
| `SHEETS_SHARED_SECRET` | Per als fluxos legacy | Clau HMAC llarga i aleatòria. Ha de coincidir amb la propietat `WEBHOOK_HMAC_SECRET` de l'Apps Script. El servidor no l'envia en clar: firma cada petició amb caducitat curta i nonce. |
| `ALLOWED_ORIGIN` | Sí en producció | Origen públic HTTPS exacte per a alta i reserva. Si falta amb `APP_ENV=production`, els POST es rebutgen. La quota usa `PORTAL_ALLOWED_ORIGIN`. |
| `APP_ENV` | Sí | `development`, `staging` o `production`; els entorns no productius activen les guardes d'egress. |
| `ALLOW_REAL_EGRESS` | Només integració local | Ha de ser exactament `true` per a permetre una prova externa des de desenvolupament. |
| `DEV_EGRESS_ALLOWLIST` | Només integració local | Orígens exactes autoritzats, separats per comes i sense comodins. |

`.env.example` té la plantilla de la integració explícita. Les proves locals
ordinàries no carreguen `.env` i funcionen amb serveis simulats.

**El `.env` real no es puja mai al repositori** (està al `.gitignore`). En
producció els valors es configuren al panell del hosting, mai en un fitxer del
repositori. Ni la URL ni el secret apareixen en cap moment a l'HTML ni al JS
que rep el navegador: només els usa la funció de servidor.

---

## Fluxos d'activitats i d'Apps Script legacy

Els destins estan separats:

```
fersescout.html        → /api/alta       → pestanya "Sol·licituds"
merchandising.html     → /api/reserva    → pestanya "Reserves botiga"
portal /api/cuota      → serveis FASE 3B → D1 + storage abstraction + notification outbox
portal /api/inscripcio → serveis FASE 3A → D1 + storage abstraction + notification outbox
```

Només alta i reserva canòniques passen per `scripts/google-apps-script.gs`.
L'Apps Script rebutja explícitament els enviaments de tipus `inscripcio`.
La revisió de pagaments d'activitats i quotes es fa des de `gestio/`.
Un desplegament remot antic de l'Apps Script podria conservar codi anterior:
cal verificar i desactivar la ruta remota de quota, amb autorització, abans de
tractar dades reals. Este repositori no ha modificat cap desplegament remot.

Les instruccions d'Apps Script de més avall descriuen **només el flux legacy
d'alta/reserva**. No s'han d'usar per a connectar quotes o activitats noves.

No usem l'API oficial de Google Sheets a propòsit: exigeix un compte de
servei amb una clau JSON, cosa desproporcionada per a este cas d'ús.
Amb Apps Script tota l'autorització queda dins del compte Google que és
propietari de la fulla; nosaltres només guardem una URL i un secret.

**Arxiu històric del circuit Google; NO executes estos passos per a FASE 3B
ni desplegues recursos remots sense autorització expressa.** La llista següent
descriu també dependències de quota antiga que encara s'han d'inventariar abans
de retirar-les; no és la configuració de les quotes noves.

1. Crea la Google Sheet on vols veure les sol·licituds. No cal preparar
   capçaleres: el script les crea la primera vegada (pestanyes "Sol·licituds",
   "Reserves botiga" i "Cuotas").
2. Per a la quota legacy, crea a Drive una **carpeta privada** per als comprovants
   (compartida NOMÉS amb qui gestiona els pagaments del grup).
   Obri-la al navegador i copia l'ID de la URL
   (`https://drive.google.com/drive/folders/ESTE_ID`).
3. A la Sheet: menú **Extensions → Apps Script**.
4. Esborra l'exemple que apareix i enganxa **tot** `scripts/google-apps-script.gs`.
5. A *Configuració del projecte → Propietats de l'script*, configura:
   - `DRIVE_FOLDER_CUOTES_ID`: l'ID d'una carpeta privada específica del curs.
   - `STATUS_SPREADSHEET_ID`: l'ID d'una segona Sheet de només lectura per als responsables.
   - `WEBHOOK_HMAC_SECRET`: una cadena aleatòria de 32+ caràcters.
   Revisa també `REMITENT_NOM` i `CORREU_CONTACTE` per als correus de quota.
6. **Desplega → Nou desplegament → Tipus: Aplicació web**.
   - *Executar com*: **Jo** (el teu compte)
   - *Qui té accés*: **Qualsevol**
7. Autoritza els permisos que demane (Sheets, Drive i Gmail) i copia la
   **URL de l'aplicació web**.
8. Copia `.env.example` a `.env` (local) i, al panell del hosting, posa:
   - `SHEETS_WEBHOOK_URL` = eixa URL
   - `SHEETS_SHARED_SECRET` = el mateix valor que has posat a `WEBHOOK_HMAC_SECRET`

Per a obrir la web general en local, fes doble clic a
`Launchers/Abrir web general local.command`; arranca el servidor y abre la
portada en <http://localhost:4000/>. El launcher y `npm run dev:site` arrancan
siempre en modo seguro: datos sintéticos, Google Sheets simulado y sin egress.
`npm run dev:site:fake` se conserva como alias explícito del mismo modo.

Proves locals amb el circuit sencer simulat (sense escriure enlloc):
`node scripts/dev.js --fals`. Una integració externa exigeix el comando distinto
`npm run dev:site:integration`, `ALLOW_REAL_EGRESS=true` y el origen exacto en
`DEV_EGRESS_ALLOWLIST`. Usa solo un despliegue de pruebas con datos sintéticos.

Per al portal privat, fes doble clic a `Launchers/Abrir portal local.command`; obri el
navegador en <http://localhost:4100> i
entra amb la contrasenya fictícia `families-demo`. Les activitats i quotes noves
usen D1 i storage emulats locals, amb outbox fake; no envien res a Google.
La guia completa de configuració és `docs/PORTAL-PRIVAT.md`.

**Si edites el script més endavant:** ves a *Desplega → Gestiona desplegaments*
→ edita el desplegament existent (llapis) → *Versió: Nova* → *Desplega*. Així
la URL no canvia. Si crees un desplegament nou en compte d'editar l'existent,
la URL canvia i has d'actualitzar `SHEETS_WEBHOOK_URL` al hosting.

**Les seccions vàlides** (`Manada (8-11)`, `Tropa (11-14)`, `Escoltes (14-17)`,
`Clan Ontos (17-21)`) són una llista tancada al servidor: no s'hi pot colar
cap valor arbitrari.

---

## Proves en local

```bash
npm run dev
```

Obri <http://localhost:4000/fersescout.html>. En el modo seguro Google Sheets
està simulat: pots provar tot el circuit (validació, errors, missatges, lector
de pantalla) **sense crear cap fila real ni tractar dades de ningú**. És el
mode recomanat per a provar.

El servidor només carrega `.env` amb `--real-egress`, i encara exigix el doble
opt-in i l'allowlist. El mode ordinari no pot escriure en un servei real.

Verificació local completa (lint, `checkJs`, schemas, guardes, tests i audit):

```bash
npm run ci
```

---

## Desplegament

El lloc s'ha de servir **sempre per HTTPS**. Sense HTTPS, les dades del
formulari (nom, data de naixement i contacte del tutor) viatgen en clar per
la xarxa. Les tres plataformes de sota donen HTTPS automàtic amb certificat
gestionat; cal a més activar la redirecció de HTTP a HTTPS i deixar-la activada.

Vercel y Netlify se conservan como adaptadores existentes de la web estática,
pero no son la plataforma objetivo de la nueva infraestructura.

### Vercel

1. Importa el repositori. No cal cap comanda de build: Vercel publica `site/` (configurat a `vercel.json`).
2. *Settings → Environment Variables*: afig `SHEETS_WEBHOOK_URL`, `SHEETS_SHARED_SECRET`, `ALLOWED_ORIGIN` i `APP_ENV=production`.
3. Desplega. L'endpoint queda a `/api/alta`.

### Netlify

1. Importa el repositori; `netlify.toml` ja publica `site/` i configura les redireccions d'API.
2. *Site settings → Environment variables*: les mateixes variables.
3. Desplega.

### Cloudflare

Cloudflare es la plataforma objetivo aprobada para la primera versión:
D1/R2 con jurisdicción `eu`, Workers/Static Assets, Access y Turnstile. La
decisión completa y el gate para cambiar de proveedor están en
`docs/adr/ADR-001-cloudflare-first-eu.md`. No crees recursos remotos sin
autorización explícita.

1. El lloc estàtic, a Cloudflare Pages. En la configuració de build del projecte, posa `site` com a *Build output directory*. És necessari perquè les adreces públiques continuen sent `/index.html`, `/clan.html`, etc.; `site/` és només l'arrel interna publicada. El fitxer de capçaleres és `site/_headers`.
2. El Worker, amb `npx wrangler deploy` (configuració a `wrangler.toml`).
3. Els secrets es carreguen una sola vegada, no van al repositori:

```bash
npx wrangler secret put SHEETS_WEBHOOK_URL
npx wrangler secret put SHEETS_SHARED_SECRET
```

4. Configura el Worker amb la ruta de zona `/api/*` del domini i posa
   `ALLOWED_ORIGIN` amb el domini HTTPS definitiu. Vegeu
   `docs/CLOUDFLARE-SEGURIDAD.md` per a Turnstile, rate limiting i les
   restriccions de jurisdicció.

---

## Què fan els endpoints públics d'alta i reserva

1. Rebutja qualsevol cosa que no siga `POST`, i els cossos de més de 16 KB.
2. Comprova l'origen exacte configurat a `ALLOWED_ORIGIN`.
3. Filtre anti-spam: camp trampa ocult i temps mínim d'emplenament. Al bot se
   li respon que tot ha anat bé i no s'escriu res enlloc, per no ensenyar-li
   quin filtre l'ha aturat.
4. Límit de peticions: 5 altes o 10 reserves per hora i IP, i 60 peticions per hora en total. És una defensa
   contra l'abús ordinari, no contra un atac distribuït: per a això cal el WAF
   del hosting.
5. Validació completa al servidor. El `required` de l'HTML no compta: qualsevol
   pot enviar un POST saltant-se el navegador.
6. Escriptura a Google Sheets (via l'Apps Script). Si falla, la família rep
   un missatge clar i **no perd res del que ha escrit**.

Als registres del servidor no s'escriu mai el contingut dels camps: només
quins camps han fallat la validació. Les respostes amb dades personals van amb
`Cache-Control: no-store`.

Si el JavaScript està desactivat, el formulari segueix enviant-se com un POST
normal i el servidor respon una pàgina de confirmació mínima.

---

## Capçaleres de seguretat

Estan definides dues vegades, perquè cada plataforma llig un format:

- `site/_headers` — el llig Netlify i Cloudflare Pages.
- `vercel.json` — les mateixes capçaleres per a Vercel.

Si canvies una, canvia l'altra.

La política de contingut (CSP) està ajustada al que la web fa de veritat:

| Directiva | Per què |
|---|---|
| `script-src 'self'` | No hi ha ni un sol script inline al lloc, així que es poden prohibir del tot. Això és el que atura de veritat un XSS. |
| `style-src 'self' 'unsafe-inline' fonts.googleapis.com` | L'HTML actual fa servir atributs `style="` en 78 llocs. Llevar-los seria reescriure el maquetat. Els estils inline són molt menys perillosos que els scripts inline. |
| `font-src fonts.gstatic.com` | Les tipografies del lloc. Si algun dia s'allotgen al propi servidor, es pot llevar d'ací i de la política de cookies. |
| `frame-ancestors 'none'` | Que ningú puga posar la web dins d'un iframe per a suplantar el formulari. |
| `form-action 'self'` | El formulari només pot enviar-se al nostre servidor. |
| `img-src 'self' data:` | Els fons i les icones del CSS són SVG en `data:`. |

**Un detall conegut:** `site/index.html` té un `onerror="this.style.display='none'"` a la
imatge decorativa de la portada. Amb esta CSP eixe manejador no s'executarà. No
passa res: la imatge té `alt=""` i és decorativa, així que si algun dia fallara,
el navegador no mostraria res igualment. Si es vol que funcione, la solució és
moure eixa línia a `site/assets/js/script.js`, no debilitar la CSP.

**HSTS** ja està definida a `site/_headers` i `vercel.json` amb
`includeSubDomains`. És un **PRODUCTION_BLOCKER** fins a comprovar HTTPS i
certificats de `portal`, `gestio` i la resta de subdominis, o decidir
explícitament un altre abast. Una vegada un navegador la rep, no accepta
HTTP durant un any.

## Gestió interna

La web pública de `site/` no incorpora un panell d'administració. La plataforma
interna és `gestio/`: en local/sintètic ja disposa d'identitat, sessions i
permisos per a activitats 3A i Tresoreria 3B. No està preparada per a
producció. Les sol·licituds d'alta i les reserves continuen amb els seus
fluxos Google separats; el codi de quota antiga roman deprecat, sense ser
el destí de les quotes noves.
