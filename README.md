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
api/_lib/notion.js             escriptura a l'API de Notion
api/_lib/handler.js            nucli de l'endpoint, independent de la plataforma
api/alta.js                    adaptador Vercel
netlify/functions/alta.js      adaptador Netlify
worker.js                      adaptador Cloudflare Workers
scripts/dev.js                 servidor local de proves
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
| `NOTION_TOKEN` | Sí | Token de la integració interna de Notion. Es crea a <https://www.notion.so/my-integrations>. |
| `NOTION_DATABASE_ID` | Sí | ID (32 caràcters) de la base de dades on s'escriuen les sol·licituds. |
| `ALLOWED_ORIGIN` | Recomanada | Domini públic del lloc, sense barra final. Rebutja els enviaments que vinguen d'un altre origen. Buit = no es comprova. |

`.env.example` té la plantilla. Per a proves locals, copia'l a `.env`.

**El `.env` real no es puja mai al repositori** (està al `.gitignore`). En
producció els valors es configuren al panell del hosting, mai en un fitxer del
repositori. La clau de Notion no apareix en cap moment a l'HTML ni al JS que
rep el navegador: només l'usa la funció de servidor.

Dona a la integració de Notion accés **només** a la base de dades d'altes, a
cap altra pàgina del workspace.

---

## La base de dades de Notion

Ha de tindre estes propietats, amb estos noms exactes (accents inclosos). Si
en canvies algun a Notion, canvia'l també a `PROPS` dins de `api/_lib/notion.js`.

| Propietat | Tipus |
|---|---|
| `Nom` | Title |
| `Cognoms` | Text |
| `Data de naixement` | Date |
| `Secció` | Select — opcions: `Manada (8-11)`, `Tropa (11-14)`, `Escoltes (14-17)`, `Clan Ontos (17-21)` |
| `Notes` | Text |
| `Tutor/a` | Text |
| `Telèfon` | Phone |
| `Email` | Email |
| `Com ens ha conegut` | Text |
| `Estat` | Select — ha d'incloure l'opció `Nova` |

Les opcions de `Secció` són una llista tancada també al servidor: no s'hi pot
colar cap valor arbitrari.

---

## Proves en local

```bash
node scripts/dev.js --fals
```

Obri <http://localhost:4000/fersescout.html>. En mode `--fals` Notion està
simulat: pots provar tot el circuit (validació, errors, missatges, lector de
pantalla) **sense crear cap fitxa real ni tractar dades de ningú**. És el mode
recomanat per a provar.

Sense `--fals` llig el `.env` i escriu a Notion de veritat.

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
2. *Settings → Environment Variables*: afig `NOTION_TOKEN`, `NOTION_DATABASE_ID` i `ALLOWED_ORIGIN`.
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
npx wrangler secret put NOTION_TOKEN
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
6. Escriptura a Notion. Si falla, la família rep un missatge clar i **no perd
   res del que ha escrit**.

Als registres del servidor no s'escriu mai el contingut dels camps: només
quins camps han fallat la validació. Les respostes amb dades personals van amb
`Cache-Control: no-store`.

Si el JavaScript està desactivat, el formulari segueix enviant-se com un POST
normal i el servidor respon una pàgina de confirmació mínima.
