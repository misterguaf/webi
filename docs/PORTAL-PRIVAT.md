# Portal privat d'inscripcions i quotes

El portal viu a `portal/` i es desplega com un Worker diferent de la web
pública. La web pública no conté cap enllaç ni redirecció cap al subdomini.

## Desenvolupament local

En macOS fes doble clic a `Abrir portal local.command`. Arranca el servidor,
obre el navegador i deixa la consola disponible per a veure els missatges;
polsa Ctrl+C en eixa finestra per a tancar-lo. També pots iniciar-lo des de la
terminal amb `npm run dev:portal -- --open`.

El portal s'obri en `http://localhost:4100` i la clau de prova és
`families-demo`. És fictícia. Activitats i **quotes noves** usen D1 i storage
emulats locals amb notification outbox fake. La clau compartida no verifica
la identitat familiar. No introduïsques dades reals.

## Configuració de la quota 3B local

No edites `data/cuotes.json`: és legacy i no governa la quota nova. En Gestió,
Tesoreria o Coordinació de Grup configura la ronda D1 sintètica:

- ronda solar;
- import base en cèntims;
- data límit orientativa opcional, que no bloqueja pagaments tardans;
- titular, IBAN de prova i concepte recomanat.

La regla de descompte aprovada per a 3B és 50 % des del tercer germà, amb
agrupació familiar explícita i auditada. El servidor calcula imports i ignora
com a autoritat el que declare el navegador. La persona revisora comprova
separadament el banc, verifica l'import i assigna el pagament.

## Apps Script anterior — deprecated

`api/_lib/handler-quota.js`, `data/cuotes.json` i les branques de quota de
`scripts/google-apps-script.gs` es conserven per inventari i compatibilitat,
però `portal/worker.js` ja no envia allí quotes noves. **No configures ni
desplegues el circuit antic per a 3B.** Un endpoint remot anterior podria
continuar actiu; comprovar-lo i desactivar-lo és un bloquejant de producció i
requereix autorització separada. El seu contingut remot no s'ha verificat.

## Desplegament

**No desplegar 3B.** Només local i sintètic; no hi ha D1/R2 remots. Abans de
producció falten Access/MFA, Turnstile, R2 EU privat, backup d'objectes,
correu real, textos/retencions legals, origen HTTPS exacte i decisió HSTS.
Vegeu [informe 3B](PHASE_3B_REPORT.md).

## Comprovacions locals obligatòries

- Una petició directa a un HTML o a `/api/inscripcio` sense cookie torna a la
  pantalla d'accés o respon 401.
- L'antiga URL pública `inscripcions.html` respon amb la 404 general.
- Cap pàgina, sitemap o peu públic enllaça al portal.
- Els fitxers porten `noindex`, `no-store`, CSP i bloqueig d'iframes.
- Les proves d'activitats creen inscripció en D1, justificant en storage emulat
  quan cal i notification outbox, sense Sheets/Drive ni correu real.
- La prova de quota 3B crea transferència, metadata de justificant i avís
  fictici; **no** marca PAGADA només per pujar el fitxer.
- Una transferència pot tindre diverses assignacions independents; cada quota
  deriva `PENDING`, `PARTIAL`, `PAID` o `ISSUE` després de verificació humana.
