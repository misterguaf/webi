# Gestió: dades de demostració locals

Des de l'arrel del projecte, amb el servidor de Gestió aturat:

```sh
npm run demo:seed
npm run demo:reset
npm run dev:gestio
```

`demo:seed` aplica el seed canònic si la D1 està buida i després el completa amb dades de demostració. Si ja hi ha un marcador demo, comprova la integritat bàsica i no modifica els canvis locals. Si la D1 està parcialment poblada i no és el seed canònic, s'atura i demana `demo:reset`.

`demo:reset` esborra **només** `gestio/.wrangler/state`, aplica les migracions existents, el seed canònic i el dataset demo. Elimina qualsevol canvi fet en aquesta D1/R2 local; useu-lo per tornar a l'estat conegut.

El dataset té 40 participants ficticis, 16 activitats, 43 inscripcions, 40 obligacions de quota i 19 pagaments. Les dates de les activitats de demostració són relatives al moment de `demo:seed`/`demo:reset` (escenaris D1–D12 de `docs/design/screens/ACTIVITIES.md` §21): termini en menys de 48 h, activitat en curs, finalitzada pendent de tancar, esborrany amb termini passat, mixta Tropa + Escolta i transport del grup amb transport familiar a 0 €. Inclou les quatre seccions; famílies d'un, dos, tres i quatre fills; activitats en esborrany, publicades i tancades; estats de quota PENDING, PARTIAL, PAID i ISSUE; pagaments compartits, dos terminis, romanent verificat sense assignar i incidències obertes i resoltes. Els justificants de prova són PDF sintètics en R2 local. Una inscripció històrica de Tropa apunta a un participant que ara figura en Escolta. Des de la migració 0011 hi ha historial de secció (`participant_section_membership`); el dataset crea eixe participant directament en Escolta, de manera que el seu historial comença allà.

Inscripcions (3.5F, `docs/design/screens/REGISTRATIONS.md`): la demo inclou un vincle manual, un escalat automàtic a revisió global (un participant d'Escolta declarat com a Tropa a l'activitat de tot el grup), un escalat manual, una secció corregida amb el seu historial, una sol·licitud retirada (ja no es modela com a rebutjada), una retirada després d'un pagament verificat, una inscripció nova després d'una retirada, una incidència, un justificant PNG sintètic a més dels PDF, recomptes parcials en l'activitat de tot el grup, llista de confirmats amb transport i l'usuari de Tresoreria, que verifica pagaments des de la cua d'Inscripcions sense accés a Activitats. En la demo, `seed-105` (Secretaria) també fa de revisor global d'inscripcions.

Tresoreria (3.5G.1 i 3.5G.2A, `docs/design/screens/TREASURY_*.md`): ronda 2026/2027 oberta amb compte, targeta i caixa; pressupost jeràrquic aprovat; un lot d'importació sintètic amb un possible duplicat; moviments pendents, un d'entrada parcialment imputat, el cicle d'efectiu, una compra amb targeta liquidada; una despesa en dues línies pagada amb un càrrec bancari, una reconeguda encara sense pagar (lloguer de furgoneta, per a provar «Paga una despesa existent»), dues propostes (una avançada per un scouter) i tercers fictius. Ningú té `finance.bank_description.reveal` per defecte. `demo:seed` afig la part de 3.5G.2A una sola vegada també a una base local que ja tenia la de 3.5G.1.

Els scripts rebutgen arguments addicionals, configuració no local, variables de producció, enllaços simbòlics per a l'estat i servidor Gestió actiu al port 8788. Les ordres Wrangler es construeixen amb `--local`, directori de persistència fix i noms fixos de D1/R2; no accepten `--remote`. No fan servir credencials Cloudflare. Les dades procedeixen de valors explícits `Demo` i dominis `example.invalid`, mai d'exportacions o dades del projecte. El marcador visible «Entorn local · dades de demostració» només apareix quan respon el proveïdor d'identitats local de desenvolupament.

El launcher general comprova `users`, `participants`, `activities` i `rounds` i executa el seed canònic només si tots són zero (les seccions ja les crea la migració 0012). No crea automàticament aquest dataset demo ni repara una D1 parcial. Executeu `demo:reset` explícitament si la D1 local ja no té l'estat canònic.

FASE 3.5E: el dataset afig tutors sintètics, contactes, representació legal (comunicada i acreditada) i revisions administratives obertes. La família 06 té dos germans en seccions diferents (Tropa i Escolta) amb un tutor compartit, per a provar la protecció de dades compartides i la cua de revisió.
