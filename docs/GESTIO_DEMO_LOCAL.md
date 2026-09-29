# Gestió: dades de demostració locals

Des de l'arrel del projecte, amb el servidor de Gestió aturat:

```sh
npm run demo:seed
npm run demo:reset
npm run dev:gestio
```

`demo:seed` aplica el seed canònic si la D1 està buida i després el completa amb dades de demostració. Si ja hi ha un marcador demo, comprova la integritat bàsica i no modifica els canvis locals. Si la D1 està parcialment poblada i no és el seed canònic, s'atura i demana `demo:reset`.

`demo:reset` esborra **només** `gestio/.wrangler/state`, aplica les migracions existents, el seed canònic i el dataset demo. Elimina qualsevol canvi fet en aquesta D1/R2 local; useu-lo per tornar a l'estat conegut.

El dataset té 40 participants ficticis, 13 activitats, 16 inscripcions, 40 obligacions de quota i 19 pagaments. Inclou les quatre seccions; famílies d'un, dos, tres i quatre fills; activitats en esborrany, publicades i tancades; estats de quota PENDING, PARTIAL, PAID i ISSUE; pagaments compartits, dos terminis, romanent verificat sense assignar i incidències obertes i resoltes. Els justificants de prova són PDF sintètics en R2 local. Una inscripció històrica de Tropa apunta a un participant que ara figura en Escolta. No hi ha taula d'historial de secció en el model actual.

Els scripts rebutgen arguments addicionals, configuració no local, variables de producció, enllaços simbòlics per a l'estat i servidor Gestió actiu al port 8788. Les ordres Wrangler es construeixen amb `--local`, directori de persistència fix i noms fixos de D1/R2; no accepten `--remote`. No fan servir credencials Cloudflare. Les dades procedeixen de valors explícits `Demo` i dominis `example.invalid`, mai d'exportacions o dades del projecte. El marcador visible «Entorn local · dades de demostració» només apareix quan respon el proveïdor d'identitats local de desenvolupament.

El launcher general comprova `users`, `participants`, `sections`, `activities` i `rounds` i executa el seed canònic només si tots són zero. No crea automàticament aquest dataset demo ni repara una D1 parcial. Executeu `demo:reset` explícitament si la D1 local ja no té l'estat canònic.
