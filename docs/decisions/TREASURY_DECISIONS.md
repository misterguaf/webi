# Tresoreria — decisions de producte canòniques

Les decisions canòniques d'aquest document prevalen sobre les suposicions dels agents. L'estat d'implementació no implica una auditoria independent. L'auditoria independent de Claude dels canvis de Tresoreria fets per Codex continua **pendent**.

## G.2B — TANCAT

- Tresoreria registra centralment les despeses avançades i els reemborsaments; no hi ha autoservei del scouter en v1.
- El justificant és obligatori per reconéixer la despesa. No hi ha excepció per pèrdua de tiquet.
- La targeta real del grup és de dèbit: les compres corresponen a moviments BANK. CARD preparat no té flux operatiu.
- El grup no usa caixa operativa; CASH preparat roman inactiu.
- Una transferència bancària pot liquidar diverses despeses aprovades de la mateixa persona, sense duplicar la despesa econòmica.
- Una persona de Tresoreria pot aprovar el seu propi reemborsament només amb el permís estret i explícit existent.

## G.2C — TANCAT

- Una proposta de despesa s'edita com a esborrany, sense revisió financera formal per cada canvi.
- Una despesa reconeguda es pot corregir amb un motiu breu, versió anterior conservada i auditoria.
- Una despesa reconeguda errònia es pot anul·lar sense esborrar-la. No compta en l'economia actual ni apareix en les llistes ordinàries.
- Un justificant erroni se substitueix: l'anterior queda privat i supersedit; el vigent és el que mostra la vista habitual.
- La UI ordinària mostra l'estat actual i deixa l'historial de correccions en un desplegable secundari.
- Les classificacions corregides conserven els conjunts d'assignacions anteriors i exigeixen un motiu breu.

## Futura fase H — DIRECCIÓ TANCADA, IMPLEMENTACIÓ PENDENT

- Hi haurà una pantalla global d'Activitat amb una projecció segura de les accions rellevants per a tots els usuaris de Gestió.
- La projecció no exposarà contingut sensible, motius de correcció lliures, justificants, descripcions bancàries originals ni dades de salut.
- Els detalls financers i l'historial complet mantindran els permisos corresponents.

## Obert

- Política legal de retenció i recuperació dels binaris R2.
- Decisions de producte de G.3/G.4 no registrades ací com a tancades.
