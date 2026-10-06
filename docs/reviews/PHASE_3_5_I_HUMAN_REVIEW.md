# Fase 3.5I — Revisió humana (Borja)

Només el que cal mirar amb els teus ulls. Tot el que ja comproven els tests automàtics o el recorregut automatitzat
(desbordaments, codis tècnics visibles, errors a la consola, rutes trencades) **no** és ací.

Entorn: Gestió local amb la demo sintètica (`npm run demo:seed` amb el teu servidor aturat, o la teua base actual
després d'aplicar les migracions fins a 0047). Identitats del selector: `seed-101` Coordinació general, `seed-102`
Coordinació Tropa, `seed-103` Coordinació Esculta, `seed-104` Tresoreria, `seed-105` Secretaria, `seed-106` CRM,
`seed-107` Administració tècnica.

## DESKTOP

1. **Navegació per rol** — entra amb cada identitat i mira la barra lateral.
   Esperat: només apareixen les pàgines que eixa persona pot usar (p. ex. 107 i 106: Inici, Activitat, Incidències,
   Administració; 104: Inici, Inscripcions, Quotes, Tresoreria, Activitat, Incidències, Administració).
   Dubte: si per a Administració tècnica preferiries veure Participants/Activitats com a «no disponible» en compte
   d'amagar-les.
2. **Quotes · vista de Tresoreria** (`#/quotes` amb 101 o 104) — llig el bloc «Resum» i les llistes.
   Esperat: noms de secció (Manada, Tropa, Esculta, Clan), estats en català, imports com «1.520,00 €», cap UUID.
   Dubte: la pantalla continua sent el formulari antic de 3B (camps en cèntims, botons plans). Funciona, però és el
   candidat més clar per a J.
3. **Inici · secció** (`#/inici` amb 102) — bloc «Quotes de les teues seccions».
   Esperat: l'enllaç diu «Veure quotes →» i porta a Quotes (abans deia «Veure participants» i portava a Quotes).

## MOBILE

Fes-ho en un mòbil real o amb l'amplada de 375 px.

1. **Barra inferior** amb 101, 104 i 107.
   Esperat: les quatre primeres pàgines útils de cada persona (101: Inici, Activitats, Participants, Quotes;
   104: Inici, Inscripcions, Quotes, Tresoreria; 107: Inici, Incidències, Activitat, Administració) i «Més» amb la resta.
   Dubte: l'ordre de prioritat (Inici, Activitats, Participants, Quotes, Tresoreria, Inscripcions, Incidències,
   Activitat, Administració) és una proposta; digues si el vols diferent.
2. **Participants** (`#/participants`) — barra d'eines.
   Esperat: cerca a tota l'amplada; Secció i Estat visibles (abans s'amagaven en mòbil i no es podien veure les baixes);
   «Informació pendent», «Noves altes» i «Nou participant» en una o dues línies, sense desplaçament horitzontal.
3. **Detall d'usuari** (`#/administracio/usuaris/<id>`) — botons «Afegeix rol», «Concedeix permís», «Tanca les seues
   sessions». Esperat: s'ajusten a l'amplada (el text pot partir-se en dues línies) i no fan la pàgina més ampla.
4. **Diàleg llarg** (Incidències → Reporta, o un formulari d'Administració) amb el teclat obert.
   Esperat: el diàleg no supera la pantalla i es pot desplaçar per dins fins als botons.
   Dubte: no s'ha pogut provar amb teclat virtual real.

## NAVIGATION

1. **Enllaç directe a una pàgina no disponible** — amb 107, escriu `#/participants` a la barra d'adreces.
   Esperat: acabes a Inici, sense pantalla buida «no disponible».
2. **Tornar enrere / avançar** entre llista ↔ detall a Activitats, Participants i Noves altes.
   Esperat: es manté el filtre de la llista en tornar.
3. **Sol·licitud inexistent** — `#/participants/altes/00000000-0000-4000-8000-00000000dead`.
   Esperat: missatge clar i enllaç «← Noves altes».

## CROSS-MODULE FLOWS

1. **Inscripcions → persona / activitat** (`#/inscripcions`, vista de pagaments) amb 101 i amb 104.
   Esperat amb 101: el nom de la persona obri la seua fitxa i el nom de l'activitat obri l'activitat.
   Esperat amb 104 (sense Participants ni Activitats): els dos són text pla, sense enllaç.
2. **Noves altes → Participants** — accepta una sol·licitud amb 105 i obri «Obri la fitxa a Participants».
3. **Activitat → recurs** — amb 102 i amb 103, mira la mateixa entrada sobre un educand.
   Esperat: només qui pot veure l'educand en veu el nom i l'enllaç.

## FORMS

1. **Doble clic** en accions de llistes (Noves altes: «Comença la revisió»; Incidències: «Comença a treballar-hi»;
   Administració: «Retira»). Esperat: mentre es processa, el botó mostra l'indicador d'espera i un segon clic no fa res.
   Dubte: en botons que obrin un diàleg, el botó de darrere també mostra l'indicador mentre el diàleg és obert. Mira si
   et sembla natural.
2. **Missatges d'error** — prova una acció que el servidor rebutge (p. ex. una acció sobre una sol·licitud ja tancada).
   Esperat: frase en català, mai un codi tipus `invalid_transition · <id>`.

## PERMISSIONS / DIFFERENT USER TYPES

1. **Canvi d'accés amb Gestió oberta** — obri `#/participants` amb 105 en una pestanya; en una altra (com a 101 o a
   Administració) retira-li un permís de Participants; torna a la primera pestanya.
   Esperat: en tornar a la pestanya, Participants desapareix de la navegació, la llista es buida i vas a Inici.
2. **Sessió revocada amb un diàleg obert** — obri un diàleg i, des d'una altra sessió, tanca les sessions d'eixa persona.
   Esperat: en la següent acció o en tornar a la pestanya, el diàleg desapareix i apareix la pantalla d'accés; en tornar
   a entrar recuperes la ruta on eres.

## TREASURY

1. **Tresoreria en mòbil** (`#/tresoreria/moviments`, `/despeses`, `/ronda`) amb 104.
   Esperat: es pot llegir i actuar sense desplaçament horitzontal de la pàgina (les taules denses poden desplaçar-se
   dins del seu contenidor).
   Dubte: la densitat de Moviments en 375 px és usable però justa; valora si cal una vista més simple (J).

## ADMINISTRATION

1. **El meu compte** (`#/administracio/compte`).
   Esperat: «Coordinació general», «Coordinació de secció · Tropa», «compte activa» — mai `GROUP_COORDINATOR`,
   `TROPA` o `ACTIVE`.

## SUBJECTIVE VISUAL ISSUES FOR PHASE J

- Quotes (vista de Tresoreria) és el formulari antic de 3B: camps en cèntims, botons plans, llistes de text. Necessita
  el redisseny complet de J (no s'ha tocat la lògica).
- La barra inferior de 107/106 queda amb Inici + tres pàgines secundàries; funcional però poc expressiva.
- Botons d'acció amb text llarg en mòbil ara parteixen línia (correcte però visualment irregular).
- L'indicador d'espera dels botons amaga el text (estil existent); valora un estil més discret a J.
