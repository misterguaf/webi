# Revisió humana — calendari i pressupost anual

Candidat funcional de la branca `phase/3.5i-tasks-budget-import`. Aquesta revisió no tanca la fase 3.5I ni autoritza desplegament.

## Entorn segur

Des del checkout d'aquesta branca, amb les dependències instal·lades, executa:

```sh
node scripts/tasks-budget-demo.js
```

Obri l'adreça que mostra. Crea una D1/R2 temporal amb identitats fictícies i un justificant PDF fictici. No usa el servidor 8788 ni la base habitual. Ctrl+C tanca només aquest entorn i elimina les dades temporals. No hi introduïsques dades reals.

## Tasques

1. Entra com a **Coordinació general**. Inici ha de començar pel calendari. Crea una tasca personal només amb títol. Tria data i hora, guarda i canvia la data des del detall.
2. Crea una tasca compartida amb **Coordinació Tropa**, seleccionant-la també com a responsable. Ix de la sessió i entra com a Tropa: comprova que apareix la compartida i no la personal de l'altre usuari.
3. Completa la compartida des de Tropa. La compleció és comuna a totes les persones; un responsable pot completar/reobrir, però no editar una tasca de la qual només és destinatari.
4. Des de Tropa crea una tasca de secció. Comprova amb Esculta que no apareix. Des de Coordinació general prova una tasca de grup.
5. Completa una tasca setmanal: només ha d'aparéixer la següent ocurrència. Reobrir i tornar a completar l'anterior no genera una segona còpia. La mensual conserva el dia original i ajusta mesos curts.
6. Prova mes/setmana/dia/llista, hui, anterior/següent, filtres i creació des d'una data. En mòbil comprova dates, símbols, detall i controls sense desplaçament horitzontal. Les activitats mantenen el seu detall habitual.

## Pressupost

1. Entra com a **Tresoreria**. En **Tresoreria → Pressupostos**, prepara una ronda fictícia **2026/2027**, de l'1/10/2026 al 30/9/2027. No substituïsques un pressupost ja usat.
2. Desplega **Importa el pressupost anual Excel** i tria `gestio/templates/PRESSUPOST ANUAL 26_27 (Boceto).xlsx`. Revisa abans de confirmar: **65 partides**, ingressos **62.950 €**, despeses **65.450 €**, aplicació de reserves **2.500 €** i aportació **0 €**.
3. Revisa els desglossaments de Nadal, Pasqua i Estiu dins de **Despeses**, encara que vinguen de la zona esquerra del llibre. Comprova les seccions i Altres. Els subtotals no es poden seleccionar com a partida d'un moviment.
4. Revisa la correcció de numeració de Pasqua i els avisos de **Local** i **XXSS**. Acceptar l'avís permet importar; no inventa una correspondència amb el llibre tradicional.
5. Confirma. Crea una despesa fictícia de **10 €** en **Campament d'Estiu → Cuina**, adjunta el justificant fictici i reconeix-la. Comprova la partida, els pares i el resultat de **−10 €**.
6. Crea un ingrés fictici de **20 €** en **Finançament → Loteria**. Ha de quedar pendent de conciliar i no augmentar encara el resultat. Quan es concilia amb un moviment bancari fictici, ha d'augmentar el real de la partida i el resultat.
7. Torna a carregar el mateix llibre: no ha de duplicar cap partida. Un llibre diferent sobre aquest pressupost ha de mostrar conflicte i conservar l'historial.
8. Descarrega els dos Excel. El pressupost conserva noms, imports i fórmules del llibre anual carregat. El resultat tradicional porta la despesa de cuina a **C. Verano**, sense usar codis coincidents per canviar el concepte.
9. Una despesa reconeguda en **Local** o **XXSS** ha de bloquejar el resultat tradicional amb un avís comprensible. El pressupost propi continua disponible. Cal decidir la correspondència comptable abans d'ampliar aquest export.

## Decisions que necessiten revisió humana

- Confirmar si **Local** equival a «Reforma del Local» i on ha d'anar **XXSS** al llibre tradicional. No s'ha decidit automàticament.
- Valorar la comoditat del calendari i del desglossament en mòbil. El redisseny artístic queda per a una fase posterior.
- Aquest backup recupera D1 i les referències als fitxers. Els binaris R2 tenen una recuperació separada: conservar el llibre privat és necessari per exportar el pressupost original.
