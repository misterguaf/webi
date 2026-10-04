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

## G.3 — TANCAT: famílies, obligacions i conciliació

- Tresoreria gestiona quotes i pagaments d'activitats com a dominis propis. `finance_income` registra només ingressos generals; un moviment bancari i les seues imputacions semàntiques no creen una segona obligació ni un segon ingrés.
- Import degut, diners rebuts i diners imputats són magnituds distintes. Cap obligació creix pel fet de rebre diners de més; cada euro físic afecta el resultat una sola vegada.
- La quota base és de 100 € per defecte i configurable. Dins de la família explícita de la ronda, el primer i segon infant paguen el 100 %, i el tercer i següents el 50 %. Mai s'infereix la família pel cognom, l'adreça, el tutor o el concepte bancari. La mateixa ordinalitat de ronda determina el descompte d'activitat, encara que els germans no participen en la mateixa activitat.
- S'evoluciona l'agrupació familiar existent, sense una segona font de veritat. SECRETARY, GROUP COORDINATION i TREASURY poden gestionar-la amb permís, abast i auditoria; SECTION COORDINATOR no. Un canvi anterior a les obligacions és ordinari; després exigeix correcció econòmica explícita, motiu i historial, sense recalcular el passat silenciosament. Un excés resultant queda separat com a sobrepagament.
- La inscripció d'activitat de pagament crea i fixa l'obligació en enviar-se, amb preu capturat en aquell moment, encara que la identitat del participant es resolga després. La vinculació posterior no duplica l'obligació. Un canvi del preu general no altera inscripcions ja enviades; corregir una obligació emesa exigeix motiu i historial.
- Sense pla aprovat, la família paga l'import complet i aporta justificant en enviar la inscripció. El justificant és una declaració/prova de la família, no una confirmació bancària. Amb pla excepcional autoritzat, pot enviar-la després del primer termini pagat i justificat; l'estat és parcial fins a cobrir el total. La família no crea plans unilateralment.
- Els plans de quotes i activitats admeten N terminis, imports i dates, amb suma igual a l'obligació, estat, autorització de TREASURY o GROUP COORDINATION mitjançant permís explícit, i historial de correccions. Un pla amb pagaments no es reescriu silenciosament. Una obligació pot rebre diversos moviments i un moviment pot cobrir diverses obligacions.
- Una transferència familiar mixta és un sol `FinancialMovement` amb diverses imputacions tipades/versionades. La conciliació de quotes, activitats, sobrepagaments i devolucions exigeix referència compatible, direcció, límit, ronda, estat vigent i permís. Gestió pot suggerir candidats per senyals prudents; només la confirmació humana de Tresoreria assigna pagador i obligació. No hi ha coincidència automàtica per import, data o descripció.
- L'excés rebut és `FAMILY_OVERPAYMENT` obert i separat, no ingrés. L'obligació coberta continua `PAID`. En v1 només es resol amb devolució; crèdits o reassignacions futures no tenen UI operativa.
- Una `FAMILY_REFUND` és eixida bancària que liquida una causa familiar, mai una despesa ni reemborsament de scouter. Distingeix sobrepagament, baixa voluntària, rebuig del grup i correcció explícita. En una baixa voluntària, TREASURY o GROUP COORDINATION tria devolució completa, parcial o cap; en un rebuig després del cobrament, es deu la devolució completa. Deure i liquidació bancària són estats diferents. Un moviment de sortida pot liquidar diverses devolucions del mateix destinatari amb confirmació humana.
- Els cobraments vàlids de quotes i activitats compten una sola vegada en el resultat. Tornar un sobrepagament mai reconegut no redueix l'ingrés; tornar diners d'activitat ja reconeguts el reverteix una sola vegada. La ronda econòmica és la de l'obligació, també si el banc cobra després del tancament.
- SECTION COORDINATOR veu únicament l'estat bàsic de quota dels infants de la secció actual, sense imports o detalls familiars/bancaris. TECH_ADMIN no rep accés financer rutinari. El contacte requereix permís específic i auditoria.
- La UI ordinària distribueix obligacions/famílies/quotes a Quotes, inscripcions/preus/terminis a Activitats i moviments/conciliació a Tresoreria. Tresoreria disposa de cues de conciliació, excessos, devolucions i incidències. Quotes s'adapta al shell Gestió sense redisseny artístic de fase J; els IDs i les versions internes no dominen la UI. Les correccions, autoritzacions, verificacions i liquidacions generen auditoria minimitzada.

## G.4 — TANCAT: pressupost, resultat, reserves, tancament i Excel

- Gestió és la font de veritat. Excel és una còpia d'eixida compatible amb la plantilla tradicional; no hi ha sincronització bidireccional ni importació del resultat editat.
- El pressupost conserva una jerarquia d'almenys tres nivells on el disseny ho exigeix. Tresoreria proposa i Coordinació de Grup aprova. L'inicial aprovat queda congelat; el vigent és inicial més revisions aprovades. Un excés pressupostari avisa però no bloqueja una despesa real. La UI mostra pressupostat, real i desviació, amb l'historial secundari. No es pressuposa aprovació legal d'Assemblea.
- El resultat mostra ingressos ordinaris reconeguts menys despeses reconegudes, resultat abans de reserves i l'efecte separat d'aplicacions/aportacions de la reserva general. Ni ingressos esperats, excessos familiars, liquidacions de reemborsaments o transferències internes són nous ingressos/despeses.
- Hi ha com a màxim una ronda gestionada `OPEN`, sense períodes superposats; `CLOSING` és admissible. La primera ronda completament gestionada és 2026/27, sense convertir l'Excel 2025/26 en obligacions actives.
- TREASURY pot tancar la ronda sense confirmació de Coordinació de Grup, amb permís explícit del servidor i auditoria. El tancament crea una instantània oficial immutable reproduïble. Els efectes posteriors de la ronda tancada es registren com a ajustos posteriors separats; la vista actual és oficial més ajustos, sense reescriure l'oficial ni atribuir-los automàticament a una altra ronda.
- L'exportador usa model de dades → adaptador de plantilla Parpalló → nova còpia `.xlsx`; la plantilla mestra és immutable. Conserva fulls, ordre, capçaleres, fórmules, format i estructura sempre que siga possible i ompli les dades de pressupost, resultat, quotes, ingressos, despeses, activitats i reserves segons la plantilla real. La prova ha d'obrir el fitxer generat i comparar estructura i imports importants amb la plantilla.

## G.5 — TANCAT: criteri de validació final

- G.5 valida de punta a punta G.0–G.4, integritat econòmica, permisos/privacitat, auditoria, recuperació, UI i compatibilitat Excel; només corregeix defectes o buits del contracte tancat. Les idees noves van al backlog.
- Les proves inclouen quotes i activitats amb pagaments parcials/N terminis, transferències mixtes, sobrepagaments, devolucions, correccions, pressupost, reserves, tancament i ajustos posteriors. La recuperació D1 inclou el nou estat estructurat; la còpia D1 per si sola no restaura els binaris privats R2.
- L'auditoria independent de Claude dels canvis de Tresoreria fets per Codex continua **PENDENT**. Les proves de Codex i la CI no s'hi presenten com a auditoria independent.

## Futura fase H — DIRECCIÓ TANCADA, IMPLEMENTACIÓ PENDENT

- Hi haurà una pantalla global d'Activitat amb una projecció segura de les accions rellevants per a tots els usuaris de Gestió.
- La projecció no exposarà contingut sensible, motius de correcció lliures, justificants, descripcions bancàries originals ni dades de salut.
- Els detalls financers i l'historial complet mantindran els permisos corresponents.

## Obert

- Política legal de retenció i recuperació dels binaris R2.
- Competència formal externa d'aprovació del pressupost, si l'associació la documenta. La preparació/aprovació operativa de Gestió és la indicada a G.4.
