# Web del Grup Scout Parpalló

Lloc estàtic (HTML, CSS i JS sense cap framework) més un únic endpoint
serverless per al formulari de sol·licitud de plaça de `fersescout.html`.

> **Este endpoint tracta dades de menors d'edat**, incloses possibles dades de
> salut (al·lèrgies i necessitats). Abans d'activar-lo en producció cal tindre
> publicades i enllaçades les pàgines legals, i confirmat qui és el responsable
> del tractament. Vegeu `PRE-LANZAMIENTO.md` quan estiga creat.

---

## Estructura

```
index.html, manada.html, ...   pàgines del lloc (no les toca l'endpoint)
styles.css, script.js          estils i JS compartits de tot el lloc
form.css, form.js              NOMÉS el formulari d'alta (afegits, no substituïxen res)
api/_lib/validate.js           validació de servidor + filtre anti-spam
api/_lib/ratelimit.js          límit de peticions
api/_lib/sheets.js             escriptura a Google Sheets via Apps Script
api/_lib/handler.js            nucli de l'endpoint, independent de la plataforma
api/alta.js                    adaptador Vercel
netlify/functions/alta.js      adaptador Netlify
worker.js                      adaptador Cloudflare Workers
scripts/dev.js                 servidor local de proves
scripts/google-apps-script.gs  script per a enganxar al projecte d'Apps Script
test/alta.test.js              proves automàtiques
```

La lògica viu tota a `api/_lib/`. Els tres adaptadors només tradueixen el
format de petició i resposta de cada plataforma, així que **es pot canviar de
hosting sense tocar cap regla de validació ni de seguretat**. En les tres
opcions la ruta pública és la mateixa: `POST /api/alta`.

---

## Variables d'entorn

| Variable | Obligatòria | Què és |
|---|---|---|
| `SHEETS_WEBHOOK_URL` | Sí | URL del desplegament d'Apps Script que escriu a la Google Sheet. Es genera un sol cop en desplegar el script (vegeu la secció de sota). |
| `SHEETS_SHARED_SECRET` | Sí | Cadena llarga i aleatòria. Ha de coincidir amb la propietat `SHARED_SECRET` guardada dins del projecte d'Apps Script. Sense secret ningú extern pot escriure a la fulla, encara que descobrisca la URL. |
| `ALLOWED_ORIGIN` | Recomanada | Domini públic del lloc, sense barra final. Rebutja els enviaments que vinguen d'un altre origen. Buit = no es comprova. |

`.env.example` té la plantilla. Per a proves locals, copia'l a `.env`.

**El `.env` real no es puja mai al repositori** (està al `.gitignore`). En
producció els valors es configuren al panell del hosting, mai en un fitxer del
repositori. Ni la URL ni el secret apareixen en cap moment a l'HTML ni al JS
que rep el navegador: només els usa la funció de servidor.

---

## La Google Sheet i el seu Apps Script

Tot el flux és:

```
Formulari (fersescout.html) → /api/alta (funció serverless)
    → Apps Script (dins del compte de Google propietari de la fulla)
    → una fila nova a la fulla "Sol·licituds"
```

No usem l'API oficial de Google Sheets a propòsit: exigeix un compte de
servei amb una clau JSON, cosa desproporcionada per a este cas d'ús.
Amb Apps Script tota l'autorització queda dins del compte Google que és
propietari de la fulla; nosaltres només guardem una URL i un secret.

**Passos per a preparar-ho (una sola vegada):**

1. Crea la Google Sheet on vols veure les sol·licituds. No cal preparar
   capçaleres: el script les crea la primera vegada.
2. A la Sheet: menú **Extensions → Apps Script**.
3. Esborra l'exemple que apareix i enganxa **tot** `scripts/google-apps-script.gs`.
4. Menú de l'engranatge (**Configuració del projecte**) → **Propietats de l'script**
   → afig una propietat amb nom `SHARED_SECRET` i valor una cadena llarga i
   aleatòria (32+ caràcters).
5. **Desplega → Nou desplegament → Tipus: Aplicació web**.
   - *Executar com*: **Jo** (el teu compte)
   - *Qui té accés*: **Qualsevol**
6. Autoritza els permisos que demane i copia la **URL de l'aplicació web**.
7. Al panell del hosting posa:
   - `SHEETS_WEBHOOK_URL` = eixa URL
   - `SHEETS_SHARED_SECRET` = el mateix valor que has posat a `SHARED_SECRET`

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
node scripts/dev.js --fals
```

Obri <http://localhost:4000/fersescout.html>. En mode `--fals` Google Sheets
està simulat: pots provar tot el circuit (validació, errors, missatges, lector
de pantalla) **sense crear cap fila real ni tractar dades de ningú**. És el
mode recomanat per a provar.

Sense `--fals` llig el `.env` i escriu a la Google Sheet de veritat.

Proves automàtiques:

```bash
npm test
```

---

## Desplegament

El lloc s'ha de servir **sempre per HTTPS**. Sense HTTPS, les dades del
formulari (nom, data de naixement i al·lèrgies d'un menor) viatgen en clar per
la xarxa. Les tres plataformes de sota donen HTTPS automàtic amb certificat
gestionat; cal a més activar la redirecció de HTTP a HTTPS i deixar-la activada.

### Vercel

1. Importa el repositori. No cal cap comanda de build: el lloc és estàtic.
2. *Settings → Environment Variables*: afig `SHEETS_WEBHOOK_URL`, `SHEETS_SHARED_SECRET` i `ALLOWED_ORIGIN`.
3. Desplega. L'endpoint queda a `/api/alta`.

### Netlify

1. Importa el repositori; `netlify.toml` ja té la configuració i la redirecció de `/api/alta`.
2. *Site settings → Environment variables*: les mateixes tres variables.
3. Desplega.

### Cloudflare

1. El lloc estàtic, a Cloudflare Pages.
2. El Worker, amb `npx wrangler deploy` (configuració a `wrangler.toml`).
3. Els secrets es carreguen una sola vegada, no van al repositori:

```bash
npx wrangler secret put SHEETS_WEBHOOK_URL
npx wrangler secret put SHEETS_SHARED_SECRET
```

4. `ALLOWED_ORIGIN` es pot deixar a `[vars]` del `wrangler.toml` (no és secret).

---

## Què fa l'endpoint amb cada enviament

1. Rebutja qualsevol cosa que no siga `POST`, i els cossos de més de 16 KB.
2. Comprova l'origen, si `ALLOWED_ORIGIN` està configurada.
3. Filtre anti-spam: camp trampa ocult i temps mínim d'emplenament. Al bot se
   li respon que tot ha anat bé i no s'escriu res enlloc, per no ensenyar-li
   quin filtre l'ha aturat.
4. Límit de peticions: 5 per hora i IP, i 60 per hora en total. És una defensa
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

- `_headers` — el llig Netlify i Cloudflare Pages.
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

**Un detall conegut:** `index.html` té un `onerror="this.style.display='none'"` a la
imatge decorativa de la portada. Amb esta CSP eixe manejador no s'executarà. No
passa res: la imatge té `alt=""` i és decorativa, així que si algun dia fallara,
el navegador no mostraria res igualment. Si es vol que funcione, la solució és
moure eixa línia a `script.js`, no debilitar la CSP.

**HSTS** està comentada al `_headers` a propòsit. Activa-la només quan el domini
definitiu ja funcione bé per HTTPS: una vegada un navegador la rep, no accepta
HTTP en eixe domini durant un any.

## Si algun dia es vol un panell d'administració

Ara mateix no n'hi ha cap, i és una bona notícia: no hi ha res que autenticar.

Si algun dia es vol veure o gestionar les sol·licituds des de la mateixa web,
**cal parlar-ho abans de programar res**. Un panell que ensenya dades de menors
necessita autenticació de veritat (usuaris, contrasenyes ben guardades, sessions,
tancament de sessió), no una URL secreta ni un formulari amb una contrasenya
única al codi. Mentre no hi haja eixa conversa, la manera segura de consultar les
fitxes és obrir la Google Sheet amb el compte de Google de cadascú.
