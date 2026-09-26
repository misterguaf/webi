# Portal privat d'inscripcions i quotes

El portal viu a `portal/` i es desplega com un Worker diferent de la web
pública. La web pública no conté cap enllaç ni redirecció cap al subdomini.

## Desenvolupament local

En macOS fes doble clic a `Abrir portal local.command`. Arranca el servidor,
obre el navegador i deixa la consola disponible per a veure els missatges;
polsa Ctrl+C en eixa finestra per a tancar-lo. També pots iniciar-lo des de la
terminal amb `npm run dev:portal -- --open`.

El portal s'obri en `http://localhost:4100` i la clau de prova és
`families-demo`. És fictícia. Les activitats usen D1 i storage emulats locals
amb notification outbox fake; la quota anual manté el webhook legacy simulat.
No introduïsques dades reals.

## Abans d'obrir la quota

Edita `data/cuotes.json` només quan tresoreria haja confirmat:

- curs scout;
- import base en cèntims;
- data límit;
- descomptes per ordre de germà;
- instruccions bilingües de transferència.

Mantín `oberta: false` fins que totes les dades estiguen revisades. El servidor
recalcula sempre els imports i ignora qualsevol total enviat pel navegador.

## Apps Script — només quota anual legacy

En les propietats del projecte configura:

- `WEBHOOK_HMAC_SECRET`;
- `DRIVE_FOLDER_CUOTES_ID` per als justificants del curs;
- `STATUS_SPREADSHEET_ID` per a la Sheet de responsables.

Executa una vegada `provaConfiguracio` i després
`installaAutomatitzacionsCuotes`. Esta última crea el disparador de canvi
d'estat i la sincronització horària de la fulla resum. La fulla resum només
rep curs, menor, secció, estat i data de confirmació.

## Desplegament de Cloudflare

Des de `portal/`:

```bash
npx wrangler secret put PORTAL_ACCESS_PASSWORD
npx wrangler secret put PORTAL_SESSION_SECRET
npx wrangler secret put SHEETS_WEBHOOK_URL
npx wrangler secret put SHEETS_SHARED_SECRET
npx wrangler deploy
```

La contrasenya i el secret de sessió no s'escriuen en cap fitxer. Associa el
Worker al domini `inscripciones.grupscoutparpallo.com`, comprova que
`PORTAL_ALLOWED_ORIGIN` coincidix exactament i canvia
`PORTAL_SESSION_VERSION` en cada curs o sempre que calga invalidar sessions.

## Comprovacions obligatòries

- Una petició directa a un HTML o a `/api/inscripcio` sense cookie torna a la
  pantalla d'accés o respon 401.
- L'antiga URL pública `inscripcions.html` respon amb la 404 general.
- Cap pàgina, sitemap o peu públic enllaça al portal.
- Els fitxers porten `noindex`, `no-store`, CSP i bloqueig d'iframes.
- Les proves d'activitats creen inscripció en D1, justificant en storage emulat
  quan cal i esdeveniment de notification outbox, sense Sheets/Drive ni correu real.
- La prova de quota legacy crea fila, fitxer privat, correu i referència al
  circuit simulat; la integració externa continua pendent d'autorització.
- `PAGADA` sincronitza tots els germans, actualitza el resum i envia un únic
  correu de confirmació.
