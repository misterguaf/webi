# Textos de la web — Grup Scout Parpalló

Documento generado automáticamente por `scripts/extract-text.js`. Sirve para reescribir
todo el contenido del sitio fuera del código y volver a insertarlo después con
`scripts/apply-text.js`, sin tocar HTML a mano.

**Reglas para editar este documento (imprescindibles para poder reinsertarlo):**

1. No borres ni cambies las líneas `<!-- id:… -->` ni las líneas que empiezan por `>>>`.
2. Reescribe solo el texto que hay *entre* `>>> VA` / `>>> ES` y la siguiente marca `>>>`.
3. Si dentro de un texto ves una etiqueta HTML —como `<span class="pend">…</span>`, `<a href="...">…</a>`
   o `<strong>…</strong>`—, no la borres ni la muevas: puedes reescribir las palabras de dentro y de
   fuera, pero la etiqueta debe quedar igual. Los bloques que la llevan tienen una nota que lo recuerda.
4. No uses comillas dobles rectas (") dentro del texto de la sección **Sistema**; usa comillas
   tipográficas ("como estas") si hace falta, porque esas cadenas viven dentro de código JavaScript.
5. Los bloques marcados **⚠️ PENDIENTE DE REDACTAR** son placeholders explícitos del sitio;
   son la prioridad para escribir contenido real.
6. Los bloques de la sección **Legal — pendiente de datos jurídicos** no son de redacción libre:
   son datos legales concretos (NIF, domicilio, plazos...). Ver `PRE-LANZAMIENTO.md`, apartado A.

**Fuera de este documento a propósito:** `fuentes.html` (herramienta interna de pruebas), los
datos estructurados JSON-LD de `index.html`, comentarios de código, y el campo trampa anti-bots
del formulario (`fersescout.html`, campo `malnom`, invisible para personas reales).

---

## Compartido (aparece igual en varias páginas — 17 bloques)

Cabecera, pie de página y enlace de salto son casi idénticos en todas las páginas. Edítalos
aquí una sola vez: `apply-text.js` los replica en todos los archivos donde aparecen.

#### [SHR-001] Enlace de salto — Salta al contingut
<!-- id:SHR-001 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Salta al contingut
>>> ES
Saltar al contenido
>>> END

#### [SHR-002] Cabecera — Grup Scout Parpalló, inici
<!-- id:SHR-002 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Grup Scout Parpalló, inici
>>> END

#### [SHR-003] Cabecera — Principal
<!-- id:SHR-003 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Principal
>>> END

#### [SHR-004] Cabecera — Seccions
<!-- id:SHR-004 -->
_Nota: Aparece igual en: index.html (×2), cova.html (×2), estol.html (×2), tropa.html (×2), esculta.html (×2), clan.html (×2), fersescout.html (×2), merchandising.html (×2), avis-legal.html (×2), privacitat.html (×2), cookies.html (×2)._
>>> VA
Seccions
>>> ES
Secciones
>>> END

#### [SHR-005] Cabecera — La Cova
<!-- id:SHR-005 -->
_Nota: Aparece igual en: index.html (×2), cova.html (×2), estol.html (×2), tropa.html (×2), esculta.html (×2), clan.html (×2), fersescout.html (×2), merchandising.html (×2), avis-legal.html (×2), privacitat.html (×2), cookies.html (×2)._
>>> VA
La Cova
>>> ES
La Cueva
>>> END

#### [SHR-006] Cabecera — Botiga
<!-- id:SHR-006 -->
_Nota: Aparece igual en: index.html (×2), cova.html (×2), estol.html (×2), tropa.html (×2), esculta.html (×2), clan.html (×2), fersescout.html (×2), merchandising.html (×2), avis-legal.html (×2), privacitat.html (×2), cookies.html (×2)._
>>> VA
Botiga
>>> ES
Tienda
>>> END

#### [SHR-007] Cabecera — Història
<!-- id:SHR-007 -->
_Nota: Aparece igual en: index.html (×2), cova.html (×2), estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Història
>>> ES
Historia
>>> END

#### [SHR-008] Cabecera — Canvia a castellà
<!-- id:SHR-008 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Canvia a castellà
>>> END

#### [SHR-009] Cabecera — Fer-se scout
<!-- id:SHR-009 -->
_Nota: Aparece igual en: index.html (×2), cova.html (×2), estol.html (×2), tropa.html (×2), esculta.html (×2), clan.html (×2), fersescout.html (×2), merchandising.html (×2), avis-legal.html (×2), privacitat.html (×2), cookies.html (×2)._
>>> VA
Fer-se scout
>>> ES
Hacerse scout
>>> END

#### [SHR-010] Pie de página — Grup Scout Parpalló
<!-- id:SHR-010 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Grup Scout Parpalló
>>> END

#### [SHR-011] Pie de página — Escoltisme a Gandia des de 1974. Federats en Scouts Valencians.
<!-- id:SHR-011 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Escoltisme a Gandia des de 1974. Federats en Scouts Valencians.
>>> ES
Escultismo en Gandia desde 1974. Federados en Scouts Valencians.
>>> END

#### [SHR-012] Pie de página — Fet a mà a Gandia.
<!-- id:SHR-012 -->
_Nota: Aparece igual en: index.html, cova.html._
>>> VA
Fet a mà a Gandia.
>>> ES
Hecho a mano en Gandia.
>>> END

#### [SHR-013] Pie de página — Contacte
<!-- id:SHR-013 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Contacte
>>> ES
Contacto
>>> END

#### [SHR-014] Pie de página — Anar a…
<!-- id:SHR-014 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Anar a…
>>> ES
Ir a…
>>> END

#### [SHR-015] Pie de página — Avís legal
<!-- id:SHR-015 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Avís legal
>>> ES
Aviso legal
>>> END

#### [SHR-016] Pie de página — Privacitat
<!-- id:SHR-016 -->
_Nota: Aparece igual en: index.html, cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Privacitat
>>> ES
Privacidad
>>> END

#### [SHR-017] Cabecera — Not&#237;cies
<!-- id:SHR-017 -->
_Nota: Aparece igual en: cova.html, estol.html, tropa.html, esculta.html, clan.html, fersescout.html, merchandising.html, avis-legal.html, privacitat.html, cookies.html._
>>> VA
Not&#237;cies
>>> ES
Noticias
>>> END

---

## Inici — index.html

#### [IDX-001] Título de pestaña — Grup Scout Parpalló · Gandia
<!-- id:IDX-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Grup Scout Parpalló · Gandia
>>> END

#### [IDX-002] Meta description — Escoltisme a Gandia des de 1974. Xiquets i xiquetes de 6 a 21 anys. E…
<!-- id:IDX-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Escoltisme a Gandia des de 1974. Xiquets i xiquetes de 6 a 21 anys. Els dissabtes de vesprada, a la Safor.
>>> END

#### [IDX-003] Encabezado — Grup Scout<br>Parpalló
<!-- id:IDX-003 -->
_Nota: Encabezado sin variante en castellano en el código actual (probablemente un nombre propio). Confirma si hay que tocarlo._
>>> VA
Grup Scout<br>Parpalló
>>> END

#### [IDX-004] Contenido — Escoltisme a Gandia · des de 1974
<!-- id:IDX-004 -->
>>> VA
Escoltisme a Gandia · des de 1974
>>> ES
Escultismo en Gandia · desde 1974
>>> END

#### [IDX-005] Contenido — ↓ baixa i mira-ho
<!-- id:IDX-005 -->
>>> VA
↓ baixa i mira-ho
>>> ES
↓ baja y míralo
>>> END

#### [IDX-006] Contenido — Qui som
<!-- id:IDX-006 -->
>>> VA
Qui som
>>> ES
Quiénes somos
>>> END

#### [IDX-007] Contenido — Un grup scout de Gandia, des de 1974.
<!-- id:IDX-007 -->
>>> VA
Un grup scout de Gandia, des de 1974.
>>> ES
Un grupo scout de Gandia, desde 1974.
>>> END

#### [IDX-008] Contenido — Un grup scout és molt més que una activitat de dissabte: és un lloc o…
<!-- id:IDX-008 -->
>>> VA
Un grup scout és molt més que una activitat de dissabte: és un lloc on el teu fill o filla aprendrà a decidir, a cuidar dels altres i a estimar la muntanya, sempre acompanyat per un equip de monitors voluntaris.
>>> ES
Un grupo scout es mucho más que una actividad de sábado: es un lugar donde tu hijo o hija aprenderá a decidir, a cuidar de los demás y a querer la montaña, siempre acompañado por un equipo de monitores voluntarios.
>>> END

#### [IDX-009] Contenido — Som un grup d'escoltisme de Gandia, a la Safor. L'escoltisme és un mo…
<!-- id:IDX-009 -->
>>> VA
Som un grup d'escoltisme de Gandia, a la Safor. L'escoltisme és un moviment educatiu juvenil, voluntari i sense ànim de lucre, que va nàixer fa més de cent anys i que hui està present en tot el món. Ací el fem a la nostra manera: eixint a la muntanya, jugant i aprenent a decidir entre tots.
>>> ES
Somos un grupo de escultismo de Gandia, en La Safor. El escultismo es un movimiento educativo juvenil, voluntario y sin ánimo de lucro, que nació hace más de cien años y que hoy está presente en todo el mundo. Aquí lo hacemos a nuestra manera: saliendo al monte, jugando y aprendiendo a decidir entre todos.
>>> END

#### [IDX-010] Contenido — Ens reunim els dissabtes de vesprada al nostre local i cada estiu pug…
<!-- id:IDX-010 -->
_Nota: Contiene un fragmento <span class="pend">…</span> dentro de la frase: no borres esa etiqueta, solo puedes reescribir el texto que hay dentro y fuera de ella._
>>> VA
Ens reunim els dissabtes de vesprada al nostre local i cada estiu pugem de campament. Els monitors som voluntaris i la majoria hem crescut ací dins. Venim de <span class="pend">l'any 1974</span>, quan un grapat de famílies de Gandia va muntar el grup per als seus fills, i encara seguim.
>>> ES
Nos reunimos los sábados por la tarde en nuestro local y cada verano subimos de campamento. Los monitores somos voluntarios y la mayoría hemos crecido aquí dentro. Venimos de <span class="pend">el año 1974</span>, cuando un puñado de familias de Gandia montó el grupo para sus hijos, y todavía seguimos.
>>> END

#### [IDX-011] Contenido — Federats en
<!-- id:IDX-011 -->
>>> VA
Federats en
>>> ES
Federados en
>>> END

#### [IDX-012] Texto alternativo de imagen — ASDE — Scouts Valencians
<!-- id:IDX-012 -->
_Nota: Texto alternativo de una imagen — en el código actual solo existe en valenciano._
>>> VA
ASDE — Scouts Valencians
>>> END

#### [IDX-013] Contenido — Les seccions
<!-- id:IDX-013 -->
>>> VA
Les seccions
>>> ES
Las secciones
>>> END

#### [IDX-014] Contenido — Cada edat té la seua secció, el seu color i el seu animal. Entra en l…
<!-- id:IDX-014 -->
>>> VA
Cada edat té la seua secció, el seu color i el seu animal. Entra en la que li toque al teu fill.
>>> ES
Cada edad tiene su sección, su color y su animal. Entra en la que le toque a tu hijo.
>>> END

#### [IDX-015] Contenido — anys
<!-- id:IDX-015 -->
>>> VA
anys
>>> ES
años
>>> END

#### [IDX-016] Contenido — Estol
<!-- id:IDX-016 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [IDX-017] Contenido — La selva d'en Kipling. Viuen en manada i comencen a fer coses sols.
<!-- id:IDX-017 -->
>>> VA
La selva d'en Kipling. Viuen en manada i comencen a fer coses sols.
>>> ES
La selva de Kipling. Viven en manada y empiezan a hacer cosas solos.
>>> END

#### [IDX-018] Contenido — Entra a l'Estol
<!-- id:IDX-018 -->
>>> VA
Entra a l'Estol
>>> ES
Entra en la Manada
>>> END

#### [IDX-019] Contenido — anys
<!-- id:IDX-019 -->
>>> VA
anys
>>> ES
años
>>> END

#### [IDX-020] Encabezado — Tropa
<!-- id:IDX-020 -->
_Nota: Encabezado sin variante en castellano en el código actual (probablemente un nombre propio). Confirma si hay que tocarlo._
>>> VA
Tropa
>>> END

#### [IDX-021] Contenido — Patrulles, aventura i les primeres responsabilitats de veritat.
<!-- id:IDX-021 -->
>>> VA
Patrulles, aventura i les primeres responsabilitats de veritat.
>>> ES
Patrullas, aventura y las primeras responsabilidades de verdad.
>>> END

#### [IDX-022] Contenido — Entra a la Tropa
<!-- id:IDX-022 -->
>>> VA
Entra a la Tropa
>>> ES
Entra en la Tropa
>>> END

#### [IDX-023] Contenido — anys
<!-- id:IDX-023 -->
>>> VA
anys
>>> ES
años
>>> END

#### [IDX-024] Contenido — Escoltes
<!-- id:IDX-024 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [IDX-025] Contenido — Projectes propis i eixides més serioses. Comencen a decidir ells.
<!-- id:IDX-025 -->
>>> VA
Projectes propis i eixides més serioses. Comencen a decidir ells.
>>> ES
Proyectos propios y salidas más serias. Empiezan a decidir ellos.
>>> END

#### [IDX-026] Contenido — Entra als Escoltes
<!-- id:IDX-026 -->
>>> VA
Entra als Escoltes
>>> ES
Entra en los Escultas
>>> END

#### [IDX-027] Contenido — anys
<!-- id:IDX-027 -->
>>> VA
anys
>>> ES
años
>>> END

#### [IDX-028] Encabezado — Clan
<!-- id:IDX-028 -->
_Nota: Encabezado sin variante en castellano en el código actual (probablemente un nombre propio). Confirma si hay que tocarlo._
>>> VA
Clan
>>> END

#### [IDX-029] Contenido — El servici i el compromís. Fan la seua ruta i decidixen com ajudar.
<!-- id:IDX-029 -->
>>> VA
El servici i el compromís. Fan la seua ruta i decidixen com ajudar.
>>> ES
El servicio y el compromiso. Hacen su ruta y deciden cómo ayudar.
>>> END

#### [IDX-030] Contenido — Entra al Clan
<!-- id:IDX-030 -->
>>> VA
Entra al Clan
>>> ES
Entra en el Clan
>>> END

#### [IDX-031] Contenido — D'on ix el nostre nom
<!-- id:IDX-031 -->
>>> VA
D'on ix el nostre nom
>>> ES
De dónde sale nuestro nombre
>>> END

#### [IDX-032] Contenido — La Cova del Parpalló
<!-- id:IDX-032 -->
>>> VA
La Cova del Parpalló
>>> ES
La Cueva del Parpalló
>>> END

#### [IDX-033] Contenido — A 3 km de Barx hi ha una cova amb milers de gravats de fa 20.000 anys…
<!-- id:IDX-033 -->
>>> VA
A 3 km de Barx hi ha una cova amb milers de gravats de fa 20.000 anys. Una cérvola, entre ells, ens va donar el nom.
>>> ES
A 3 km de Barx hay una cueva con miles de grabados de hace 20.000 años. Una cierva, entre ellos, nos dio el nombre.
>>> END

#### [IDX-034] Contenido — Entra a la Cova →
<!-- id:IDX-034 -->
>>> VA
Entra a la Cova →
>>> ES
Entra en la Cueva →
>>> END

#### [IDX-035] Contenido — 50 anys fent muntanya
<!-- id:IDX-035 -->
>>> VA
50 anys fent muntanya
>>> ES
50 años haciendo monte
>>> END

#### [IDX-036] Contenido — El quadern del grup
<!-- id:IDX-036 -->
>>> VA
El quadern del grup
>>> ES
El cuaderno del grupo
>>> END

#### [IDX-037] Contenido — La nostra història des de 1974. Passa les pàgines.
<!-- id:IDX-037 -->
>>> VA
La nostra història des de 1974. Passa les pàgines.
>>> ES
Nuestra historia desde 1974. Pasa las páginas.
>>> END

#### [IDX-038] aria-label — Història del grup
<!-- id:IDX-038 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Història del grup
>>> END

#### [IDX-039] Contenido — Ronda solar 1974-75
<!-- id:IDX-039 -->
>>> VA
Ronda solar 1974-75
>>> ES
Ronda solar 1974-75
>>> END

#### [IDX-040] Contenido — El principi
<!-- id:IDX-040 -->
>>> VA
El principi
>>> ES
El principio
>>> END

#### [IDX-041] Contenido — Tot va començar el 1974. Un grapat de famílies de Gandia va muntar un…
<!-- id:IDX-041 -->
>>> VA
Tot va començar el 1974. Un grapat de famílies de Gandia va muntar un grup scout per als seus fills. I encara dura.
>>> ES
Todo empezó en 1974. Un puñado de familias de Gandia montó un grupo scout para sus hijos. Y todavía dura.
>>> END

#### [IDX-042] Contenido — La primera ronda solar.
<!-- id:IDX-042 -->
>>> VA
La primera ronda solar.
>>> ES
La primera ronda solar.
>>> END

#### [IDX-043] Contenido — Els anys 80
<!-- id:IDX-043 -->
>>> VA
Els anys 80
>>> ES
Los años 80
>>> END

#### [IDX-044] Contenido — La veu de qui hi era
<!-- id:IDX-044 -->
>>> VA
La veu de qui hi era
>>> ES
La voz de quien estuvo
>>> END

#### [IDX-045] Contenido — «Ací anirà un tros de l'entrevista a Paco Ferrer Luján, en les seues …
<!-- id:IDX-045 -->
>>> VA
«Ací anirà un tros de l'entrevista a Paco Ferrer Luján, en les seues pròpies paraules.»
>>> END

#### [IDX-046] Contenido — text per confirmar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-046 -->
>>> VA
text per confirmar
>>> ES
texto por confirmar
>>> END

#### [IDX-047] Contenido — ⬇ Memòries del grup (PDF) — per confirmar
<!-- id:IDX-047 -->
>>> VA
⬇ Memòries del grup (PDF) — per confirmar
>>> ES
⬇ Memorias del grupo (PDF) — por confirmar
>>> END

#### [IDX-048] Contenido — 50 anys contats per algú que hi va estar.
<!-- id:IDX-048 -->
>>> VA
50 anys contats per algú que hi va estar.
>>> ES
50 años contados por alguien que estuvo.
>>> END

#### [IDX-049] Contenido — Cada estiu
<!-- id:IDX-049 -->
>>> VA
Cada estiu
>>> ES
Cada verano
>>> END

#### [IDX-050] Contenido — Els campaments
<!-- id:IDX-050 -->
>>> VA
Els campaments
>>> ES
Los campamentos
>>> END

#### [IDX-051] Contenido — Cada estiu, la motxilla al coll i cap a la muntanya. El fang, el foc …
<!-- id:IDX-051 -->
>>> VA
Cada estiu, la motxilla al coll i cap a la muntanya. El fang, el foc de nit i els amics de per vida.
>>> ES
Cada verano, la mochila al hombro y hacia el monte. El barro, el fuego de noche y los amigos de por vida.
>>> END

#### [IDX-052] Contenido — Açò no s'oblida.
<!-- id:IDX-052 -->
>>> VA
Açò no s'oblida.
>>> ES
Esto no se olvida.
>>> END

#### [IDX-053] Contenido — Excursions
<!-- id:IDX-053 -->
>>> VA
Excursions
>>> ES
Excursiones
>>> END

#### [IDX-054] Contenido — Cims i muntanya
<!-- id:IDX-054 -->
>>> VA
Cims i muntanya
>>> ES
Cimas y monte
>>> END

#### [IDX-055] Contenido — text per redactar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-055 -->
>>> VA
text per redactar
>>> ES
texto por redactar
>>> END

#### [IDX-056] Contenido — Cada eixida, un cim.
<!-- id:IDX-056 -->
>>> VA
Cada eixida, un cim.
>>> ES
Cada salida, una cima.
>>> END

#### [IDX-057] Contenido — Trobades
<!-- id:IDX-057 -->
>>> VA
Trobades
>>> ES
Encuentros
>>> END

#### [IDX-058] Contenido — Amb altres grups
<!-- id:IDX-058 -->
>>> VA
Amb altres grups
>>> ES
Con otros grupos
>>> END

#### [IDX-059] Contenido — text per redactar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-059 -->
>>> VA
text per redactar
>>> ES
texto por redactar
>>> END

#### [IDX-060] Contenido — L'escoltisme també és trobar-se.
<!-- id:IDX-060 -->
>>> VA
L'escoltisme també és trobar-se.
>>> ES
El escultismo también es encontrarse.
>>> END

#### [IDX-061] Contenido — Qui ho fa possible
<!-- id:IDX-061 -->
>>> VA
Qui ho fa possible
>>> ES
Quién lo hace posible
>>> END

#### [IDX-062] Contenido — Els monitors
<!-- id:IDX-062 -->
>>> VA
Els monitors
>>> ES
Los monitores
>>> END

#### [IDX-063] Contenido — text per redactar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-063 -->
>>> VA
text per redactar
>>> ES
texto por redactar
>>> END

#### [IDX-064] Contenido — Tots voluntaris, tots ací per elecció.
<!-- id:IDX-064 -->
>>> VA
Tots voluntaris, tots ací per elecció.
>>> ES
Todos voluntarios, todos aquí por elección.
>>> END

#### [IDX-065] Contenido — Primer dia
<!-- id:IDX-065 -->
>>> VA
Primer dia
>>> ES
Primer día
>>> END

#### [IDX-066] Contenido — Arribada al campament
<!-- id:IDX-066 -->
>>> VA
Arribada al campament
>>> ES
Llegada al campamento
>>> END

#### [IDX-067] Contenido — text per redactar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-067 -->
>>> VA
text per redactar
>>> ES
texto por redactar
>>> END

#### [IDX-068] Contenido — Motxilla al coll i cap allà.
<!-- id:IDX-068 -->
>>> VA
Motxilla al coll i cap allà.
>>> ES
Mochila al hombro y para allá.
>>> END

#### [IDX-069] Contenido — Hui
<!-- id:IDX-069 -->
>>> VA
Hui
>>> ES
Hoy
>>> END

#### [IDX-070] Contenido — I seguim
<!-- id:IDX-070 -->
>>> VA
I seguim
>>> ES
Y seguimos
>>> END

#### [IDX-071] Contenido — Més de cinquanta rondes solars després, molts dels xavals d'abans ara…
<!-- id:IDX-071 -->
>>> VA
Més de cinquanta rondes solars després, molts dels xavals d'abans ara ja porten els seus.
>>> ES
Más de cincuenta rondas solares después, muchos de los chavales de antes ahora ya traen a los suyos.
>>> END

#### [IDX-072] Contenido — Cada ratlla, un curs des de 1974.
<!-- id:IDX-072 -->
>>> VA
Cada ratlla, un curs des de 1974.
>>> ES
Cada raya, un curso desde 1974.
>>> END

#### [IDX-073] Contenido — anterior
<!-- id:IDX-073 -->
>>> VA
anterior
>>> ES
anterior
>>> END

#### [IDX-074] aria-label — Pàgines del quadern
<!-- id:IDX-074 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Pàgines del quadern
>>> END

#### [IDX-075] Contenido — següent
<!-- id:IDX-075 -->
>>> VA
següent
>>> ES
siguiente
>>> END

#### [IDX-076] Contenido — Què fem
<!-- id:IDX-076 -->
>>> VA
Què fem
>>> ES
Qué hacemos
>>> END

#### [IDX-077] Contenido — Notícies del grup
<!-- id:IDX-077 -->
>>> VA
Notícies del grup
>>> ES
Noticias del grupo
>>> END

#### [IDX-078] Contenido — Cròniques d'eixides, campaments i avisos per a les famílies.
<!-- id:IDX-078 -->
>>> VA
Cròniques d'eixides, campaments i avisos per a les famílies.
>>> ES
Crónicas de salidas, campamentos y avisos para las familias.
>>> END

#### [IDX-079] Contenido — data per confirmar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-079 -->
>>> VA
data per confirmar
>>> ES
fecha por confirmar
>>> END

#### [IDX-080] Contenido — Campament d'estiu
<!-- id:IDX-080 -->
>>> VA
Campament d'estiu
>>> ES
Campamento de verano
>>> END

#### [IDX-081] Contenido — Ací anirà la crònica del campament: on hem anat, què hem fet i alguna…
<!-- id:IDX-081 -->
>>> VA
Ací anirà la crònica del campament: on hem anat, què hem fet i alguna anècdota de fogata.
>>> ES
Aquí irá la crónica del campamento: dónde hemos ido, qué hemos hecho y alguna anécdota de fogata.
>>> END

#### [IDX-082] Contenido — data per confirmar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-082 -->
>>> VA
data per confirmar
>>> ES
fecha por confirmar
>>> END

#### [IDX-083] Contenido — Eixida a la Serra
<!-- id:IDX-083 -->
>>> VA
Eixida a la Serra
>>> ES
Salida a la Sierra
>>> END

#### [IDX-084] Contenido — Una eixida d'un dia: la ruta, els xics i les xiques i el bon esmorzar…
<!-- id:IDX-084 -->
>>> VA
Una eixida d'un dia: la ruta, els xics i les xiques i el bon esmorzar de mig matí.
>>> ES
Una salida de un día: la ruta, los chicos y las chicas y el buen almuerzo de media mañana.
>>> END

#### [IDX-085] Contenido — * Notícies d'exemple. Quan en publiquem de reals, apareixeran ací.
<!-- id:IDX-085 -->
>>> VA
* Notícies d'exemple. Quan en publiquem de reals, apareixeran ací.
>>> ES
* Noticias de ejemplo. Cuando publiquemos reales, aparecerán aquí.
>>> END

#### [IDX-086] Contenido — Al dia a dia
<!-- id:IDX-086 -->
>>> VA
Al dia a dia
>>> ES
El día a día
>>> END

#### [IDX-087] Contenido — Al nostre Instagram
<!-- id:IDX-087 -->
>>> VA
Al nostre Instagram
>>> ES
En nuestro Instagram
>>> END

#### [IDX-088] Contenido — Segueix-nos a
<!-- id:IDX-088 -->
>>> VA
Segueix-nos a 
>>> ES
Síguenos en 
>>> END

#### [IDX-089] Contenido — per a veure-ho tot.
<!-- id:IDX-089 -->
>>> VA
 per a veure-ho tot.
>>> ES
 para verlo todo.
>>> END

#### [IDX-090] Contenido — La part important
<!-- id:IDX-090 -->
>>> VA
La part important
>>> ES
La parte importante
>>> END

#### [IDX-091] Contenido — Fer-se scout
<!-- id:IDX-091 -->
>>> VA
Fer-se scout
>>> ES
Hacerse scout
>>> END

#### [IDX-092] Contenido — Ens alegra un muntó que t'ho estigues plantejant. Deixa'ns les dades …
<!-- id:IDX-092 -->
>>> VA
Ens alegra un muntó que t'ho estigues plantejant. Deixa'ns les dades i et cridem per a parlar-ho amb calma.
>>> ES
Nos alegra un montón que te lo estés planteando. Déjanos los datos y te llamamos para hablarlo con calma.
>>> END

#### [IDX-093] Contenido — Vull apuntar el meu fill/a →
<!-- id:IDX-093 -->
>>> VA
Vull apuntar el meu fill/a →
>>> ES
Quiero apuntar a mi hijo/a →
>>> END

#### [IDX-094] Pie de página — adreça del local — per confirmar — ⚠️ PENDIENTE DE REDACTAR
<!-- id:IDX-094 -->
>>> VA
adreça del local — per confirmar
>>> ES
dirección del local — por confirmar
>>> END

---

## La Cova del Parpalló — cova.html

#### [COV-001] Título de pestaña — La Cova del Parpalló · Grup Scout Parpalló
<!-- id:COV-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
La Cova del Parpalló · Grup Scout Parpalló
>>> END

#### [COV-002] Meta description — La Cova del Parpalló, a 3 km de Barx: milers de gravats de fa 20.000 …
<!-- id:COV-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
La Cova del Parpalló, a 3 km de Barx: milers de gravats de fa 20.000 anys. D'ací ix el nostre nom.
>>> END

#### [COV-003] Contenido — Inici
<!-- id:COV-003 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [COV-004] Contenido — La Cova
<!-- id:COV-004 -->
>>> VA
La Cova
>>> ES
La Cueva
>>> END

#### [COV-005] Contenido — La Cova del Parpalló
<!-- id:COV-005 -->
>>> VA
La Cova del Parpalló
>>> ES
La Cueva del Parpalló
>>> END

#### [COV-006] Contenido — Fa 20.000 anys, algú va entrar en esta cova.
<!-- id:COV-006 -->
>>> VA
Fa 20.000 anys, algú va entrar en esta cova.
>>> ES
Hace 20.000 años, alguien entró en esta cueva.
>>> END

#### [COV-007] Contenido — ↓ baixa a poc a poc
<!-- id:COV-007 -->
>>> VA
↓ baixa a poc a poc
>>> ES
↓ baja despacio
>>> END

#### [COV-008] Contenido — I es va posar a gravar la pedra.
<!-- id:COV-008 -->
>>> VA
I es va posar a gravar la pedra.
>>> ES
Y se puso a grabar la piedra.
>>> END

#### [COV-009] Contenido — Milers de plaquetes. Ocre i negre.
<!-- id:COV-009 -->
>>> VA
Milers de plaquetes. Ocre i negre.
>>> ES
Miles de plaquetas. Ocre y negro.
>>> END

#### [COV-010] Contenido — Fetes a mà, una a una.
<!-- id:COV-010 -->
>>> VA
Fetes a mà, una a una.
>>> ES
Hechas a mano, una a una.
>>> END

#### [COV-011] Contenido — Entre elles, una cérvola.
<!-- id:COV-011 -->
>>> VA
Entre elles, una cérvola.
>>> ES
Entre ellas, una cierva.
>>> END

#### [COV-012] Contenido — La mateixa que hui portem al pit.
<!-- id:COV-012 -->
>>> VA
La mateixa que hui portem al pit.
>>> ES
La misma que hoy llevamos en el pecho.
>>> END

#### [COV-013] Contenido — Per això ens diem Parpalló.
<!-- id:COV-013 -->
>>> VA
Per això ens diem Parpalló.
>>> ES
Por eso nos llamamos Parpalló.
>>> END

#### [COV-014] Contenido — Paratge Natural Parpalló-Borrell · a 3 km de Barx.
<!-- id:COV-014 -->
>>> VA
Paratge Natural Parpalló-Borrell · a 3 km de Barx.
>>> ES
Paraje Natural Parpalló-Borrell · a 3 km de Barx.
>>> END

#### [COV-015] Contenido — Fer-se scout
<!-- id:COV-015 -->
>>> VA
Fer-se scout
>>> ES
Hacerse scout
>>> END

#### [COV-016] Contenido — ← Torna a l'inici
<!-- id:COV-016 -->
>>> VA
← Torna a l'inici
>>> ES
← Vuelve al inicio
>>> END

---

## Estol — estol.html

#### [EST-001] Título de pestaña — Estol · Grup Scout Parpalló
<!-- id:EST-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Estol · Grup Scout Parpalló
>>> END

#### [EST-002] Meta description — L'Estol del Grup Scout Parpalló: xiquets i xiquetes de 8 a 11 anys.
<!-- id:EST-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
L'Estol del Grup Scout Parpalló: xiquets i xiquetes de 8 a 11 anys.
>>> END

#### [EST-003] aria-label — Molla de pa
<!-- id:EST-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [EST-004] Contenido — Inici
<!-- id:EST-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [EST-005] Contenido — Seccions
<!-- id:EST-005 -->
>>> VA
Seccions
>>> ES
Secciones
>>> END

#### [EST-006] Contenido — Estol
<!-- id:EST-006 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [EST-007] Contenido — anys
<!-- id:EST-007 -->
>>> VA
anys
>>> ES
años
>>> END

#### [EST-008] Contenido — Estol
<!-- id:EST-008 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [EST-009] Contenido — Als 8 anys, el teu fill o filla entra a l'Estol i comença l'aventura …
<!-- id:EST-009 -->
>>> VA
Als 8 anys, el teu fill o filla entra a l'Estol i comença l'aventura d'El llibre de la selva: jocs, treball en equip i els primers passos per a fer coses per si mateix.
>>> ES
A los 8 años, tu hijo o hija entra en la Manada y empieza la aventura de El libro de la selva: juegos, trabajo en equipo y los primeros pasos para hacer cosas por sí mismo.
>>> END

#### [EST-010] Contenido — Apunta el teu xiquet/a
<!-- id:EST-010 -->
>>> VA
Apunta el teu xiquet/a
>>> ES
Apunta a tu hijo/a
>>> END

#### [EST-011] Contenido — Estol
<!-- id:EST-011 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [EST-012] Contenido — [ foto real de l'Estol ]
<!-- id:EST-012 -->
>>> VA
[ foto real de l'Estol ]
>>> ES
[ foto real de la Manada ]
>>> END

#### [EST-013] Contenido — L'Estol viu l'aventura d'El llibre de la selva. Cada xiquet i xiqueta…
<!-- id:EST-013 -->
>>> VA
L'Estol viu l'aventura d'El llibre de la selva. Cada xiquet i xiqueta té el seu lloc dins del grup, tots cuiden dels altres i, jugant, aprenen a espavilar-se per si mateixos. És l'edat de descobrir la muntanya i de fer els primers amics de veritat.
>>> ES
La Manada vive la aventura de El libro de la selva. Cada niño y niña tiene su sitio dentro del grupo, todos cuidan de los demás y, jugando, aprenden a espabilarse por sí mismos. Es la edad de descubrir el monte y de hacer los primeros amigos de verdad.
>>> END

#### [EST-014] Contenido — Un dissabte
<!-- id:EST-014 -->
>>> VA
Un dissabte
>>> ES
Un sábado
>>> END

#### [EST-015] Contenido — Un joc gran, un taller o una gimcana i, de tant en tant, una eixida a…
<!-- id:EST-015 -->
>>> VA
Un joc gran, un taller o una gimcana i, de tant en tant, una eixida a la muntanya.
>>> ES
Un juego grande, un taller o una gincana y, de vez en cuando, una salida al monte.
>>> END

#### [EST-016] Contenido — Com s'organitzen
<!-- id:EST-016 -->
>>> VA
Com s'organitzen
>>> ES
Cómo se organizan
>>> END

#### [EST-017] Contenido — En seisenes: xicotets grups de sis, cada un amb un responsable que ix…
<!-- id:EST-017 -->
>>> VA
En seisenes: xicotets grups de sis, cada un amb un responsable que ix d'ells mateixos.
>>> ES
En seisenas: pequeños grupos de seis, cada uno con un responsable que sale de ellos mismos.
>>> END

#### [EST-018] Contenido — Qui la porta
<!-- id:EST-018 -->
>>> VA
Qui la porta
>>> ES
Quién la lleva
>>> END

#### [EST-019] Contenido — per confirmar
<!-- id:EST-019 -->
>>> VA
per confirmar
>>> ES
por confirmar
>>> END

#### [EST-020] Contenido — Edat
<!-- id:EST-020 -->
>>> VA
Edat
>>> ES
Edad
>>> END

#### [EST-021] Contenido — anys
<!-- id:EST-021 -->
>>> VA
anys
>>> ES
años
>>> END

#### [EST-022] Contenido — [Ací contarem una xicoteta anècdota real de l'Estol — un dia de campa… — ⚠️ PENDIENTE DE REDACTAR
<!-- id:EST-022 -->
>>> VA
[Ací contarem una xicoteta anècdota real de l'Estol — un dia de campament, un joc que va eixir bé, alguna cosa que ens va fer riure — per redactar amb un fet real del grup]
>>> ES
[Aquí contaremos una pequeña anécdota real de la Manada — un día de campamento, un juego que salió bien, algo que nos hizo reír — por redactar con un hecho real del grupo]
>>> END

#### [EST-023] aria-label — Altres seccions
<!-- id:EST-023 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Altres seccions
>>> END

#### [EST-024] Contenido — Les altres seccions
<!-- id:EST-024 -->
>>> VA
Les altres seccions
>>> ES
Las otras secciones
>>> END

#### [EST-025] Contenido — Escoltes
<!-- id:EST-025 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [EST-026] Contenido — Vols provar l'Estol?
<!-- id:EST-026 -->
>>> VA
Vols provar l'Estol?
>>> ES
¿Quieres probar la Manada?
>>> END

#### [EST-027] Contenido — Si té entre 8 i 11 anys, este és el seu lloc. Vine un dissabte i que …
<!-- id:EST-027 -->
>>> VA
Si té entre 8 i 11 anys, este és el seu lloc. Vine un dissabte i que ho prove, sense compromís.
>>> ES
Si tiene entre 8 y 11 años, este es su sitio. Ven un sábado y que lo pruebe, sin compromiso.
>>> END

#### [EST-028] Contenido — Apunta el teu xiquet/a
<!-- id:EST-028 -->
>>> VA
Apunta el teu xiquet/a
>>> ES
Apunta a tu hijo/a
>>> END

---

## Tropa — tropa.html

#### [TRO-001] Título de pestaña — Tropa · Grup Scout Parpalló
<!-- id:TRO-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Tropa · Grup Scout Parpalló
>>> END

#### [TRO-002] Meta description — La Tropa del Grup Scout Parpalló: xiquets i xiquetes de 11 a 14 anys.
<!-- id:TRO-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
La Tropa del Grup Scout Parpalló: xiquets i xiquetes de 11 a 14 anys.
>>> END

#### [TRO-003] aria-label — Molla de pa
<!-- id:TRO-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [TRO-004] Contenido — Inici
<!-- id:TRO-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [TRO-005] Contenido — Seccions
<!-- id:TRO-005 -->
>>> VA
Seccions
>>> ES
Secciones
>>> END

#### [TRO-006] Contenido — anys
<!-- id:TRO-006 -->
>>> VA
anys
>>> ES
años
>>> END

#### [TRO-007] Encabezado — Tropa
<!-- id:TRO-007 -->
_Nota: Encabezado sin variante en castellano en el código actual (probablemente un nombre propio). Confirma si hay que tocarlo._
>>> VA
Tropa
>>> END

#### [TRO-008] Contenido — Patrulles, aventura i les primeres responsabilitats de veritat.
<!-- id:TRO-008 -->
>>> VA
Patrulles, aventura i les primeres responsabilitats de veritat.
>>> ES
Patrullas, aventura y las primeras responsabilidades de verdad.
>>> END

#### [TRO-009] Contenido — Apunta el teu xiquet/a
<!-- id:TRO-009 -->
>>> VA
Apunta el teu xiquet/a
>>> ES
Apunta a tu hijo/a
>>> END

#### [TRO-010] Contenido — [ foto real de la Tropa ]
<!-- id:TRO-010 -->
>>> VA
[ foto real de la Tropa ]
>>> ES
[ foto real de la Tropa ]
>>> END

#### [TRO-011] Contenido — L'edat de l'aventura. A la Tropa es comença a decidir de veritat i a …
<!-- id:TRO-011 -->
>>> VA
L'edat de l'aventura. A la Tropa es comença a decidir de veritat i a assumir responsabilitats: munten i desmunten el campament ells, s'organitzen en patrulles i tiren avant els seus reptes.
>>> ES
La edad de la aventura. En la Tropa se empieza a decidir de verdad y a asumir responsabilidades: montan y desmontan el campamento ellos, se organizan en patrullas y sacan adelante sus retos.
>>> END

#### [TRO-012] Contenido — Un dissabte
<!-- id:TRO-012 -->
>>> VA
Un dissabte
>>> ES
Un sábado
>>> END

#### [TRO-013] Contenido — Preparar la pròxima acampada, tècniques i molt de joc.
<!-- id:TRO-013 -->
>>> VA
Preparar la pròxima acampada, tècniques i molt de joc.
>>> ES
Preparar la próxima acampada, técnicas y mucho juego.
>>> END

#### [TRO-014] Contenido — Com s'organitzen
<!-- id:TRO-014 -->
>>> VA
Com s'organitzen
>>> ES
Cómo se organizan
>>> END

#### [TRO-015] Contenido — Per patrulles, que s'organitzen soles amb un cap de patrulla.
<!-- id:TRO-015 -->
>>> VA
Per patrulles, que s'organitzen soles amb un cap de patrulla.
>>> ES
Por patrullas, que se organizan solas con un jefe de patrulla.
>>> END

#### [TRO-016] Contenido — Qui la porta
<!-- id:TRO-016 -->
>>> VA
Qui la porta
>>> ES
Quién la lleva
>>> END

#### [TRO-017] Contenido — per confirmar
<!-- id:TRO-017 -->
>>> VA
per confirmar
>>> ES
por confirmar
>>> END

#### [TRO-018] Contenido — Edat
<!-- id:TRO-018 -->
>>> VA
Edat
>>> ES
Edad
>>> END

#### [TRO-019] Contenido — anys
<!-- id:TRO-019 -->
>>> VA
anys
>>> ES
años
>>> END

#### [TRO-020] aria-label — Altres seccions
<!-- id:TRO-020 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Altres seccions
>>> END

#### [TRO-021] Contenido — Les altres seccions
<!-- id:TRO-021 -->
>>> VA
Les altres seccions
>>> ES
Las otras secciones
>>> END

#### [TRO-022] Contenido — Estol
<!-- id:TRO-022 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [TRO-023] Contenido — Escoltes
<!-- id:TRO-023 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [TRO-024] Contenido — Vols provar la Tropa?
<!-- id:TRO-024 -->
>>> VA
Vols provar la Tropa?
>>> ES
¿Quieres probar la Tropa?
>>> END

#### [TRO-025] Contenido — Si té entre 11 i 14 anys, ací trobarà aventura i colla. Vine un dissa…
<!-- id:TRO-025 -->
>>> VA
Si té entre 11 i 14 anys, ací trobarà aventura i colla. Vine un dissabte i que ho prove, sense compromís.
>>> ES
Si tiene entre 11 y 14 años, aquí encontrará aventura y pandilla. Ven un sábado y que lo pruebe, sin compromiso.
>>> END

#### [TRO-026] Contenido — Apunta el teu xiquet/a
<!-- id:TRO-026 -->
>>> VA
Apunta el teu xiquet/a
>>> ES
Apunta a tu hijo/a
>>> END

---

## Escoltes — esculta.html

#### [ESC-001] Título de pestaña — Escoltes · Grup Scout Parpalló
<!-- id:ESC-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Escoltes · Grup Scout Parpalló
>>> END

#### [ESC-002] Meta description — Els Escoltes del Grup Scout Parpalló: xics i xiques de 14 a 17 anys.
<!-- id:ESC-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Els Escoltes del Grup Scout Parpalló: xics i xiques de 14 a 17 anys.
>>> END

#### [ESC-003] aria-label — Molla de pa
<!-- id:ESC-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [ESC-004] Contenido — Inici
<!-- id:ESC-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [ESC-005] Contenido — Seccions
<!-- id:ESC-005 -->
>>> VA
Seccions
>>> ES
Secciones
>>> END

#### [ESC-006] Contenido — Escoltes
<!-- id:ESC-006 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [ESC-007] Contenido — anys
<!-- id:ESC-007 -->
>>> VA
anys
>>> ES
años
>>> END

#### [ESC-008] Contenido — Escoltes
<!-- id:ESC-008 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [ESC-009] Contenido — Projectes propis i eixides més serioses. Comencen a decidir ells.
<!-- id:ESC-009 -->
>>> VA
Projectes propis i eixides més serioses. Comencen a decidir ells.
>>> ES
Proyectos propios y salidas más serias. Empiezan a decidir ellos.
>>> END

#### [ESC-010] Contenido — Apunta el teu fill/a
<!-- id:ESC-010 -->
>>> VA
Apunta el teu fill/a
>>> ES
Apunta a tu hijo/a
>>> END

#### [ESC-011] Contenido — Escoltes
<!-- id:ESC-011 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [ESC-012] Contenido — [ foto real dels Escoltes ]
<!-- id:ESC-012 -->
>>> VA
[ foto real dels Escoltes ]
>>> ES
[ foto real de los Escultas ]
>>> END

#### [ESC-013] Contenido — Els Escoltes trien els seus propis projectes i els tiren avant. Les m…
<!-- id:ESC-013 -->
>>> VA
Els Escoltes trien els seus propis projectes i els tiren avant. Les monitores acompanyen més que manen. És l'edat de fer-se preguntes grans i d'aprendre a comprometre's amb el que un tria.
>>> ES
Los Escultas eligen sus propios proyectos y los sacan adelante. Las monitoras acompañan más que mandan. Es la edad de hacerse preguntas grandes y de aprender a comprometerse con lo que uno elige.
>>> END

#### [ESC-014] Contenido — Un dissabte
<!-- id:ESC-014 -->
>>> VA
Un dissabte
>>> ES
Un sábado
>>> END

#### [ESC-015] Contenido — Reunió per a decidir i preparar el que han triat fer.
<!-- id:ESC-015 -->
>>> VA
Reunió per a decidir i preparar el que han triat fer.
>>> ES
Reunión para decidir y preparar lo que han elegido hacer.
>>> END

#### [ESC-016] Contenido — Com s'organitzen
<!-- id:ESC-016 -->
>>> VA
Com s'organitzen
>>> ES
Cómo se organizan
>>> END

#### [ESC-017] Contenido — En unitat, decidint junts en assemblea el que volen fer.
<!-- id:ESC-017 -->
>>> VA
En unitat, decidint junts en assemblea el que volen fer.
>>> ES
En unidad, decidiendo juntos en asamblea lo que quieren hacer.
>>> END

#### [ESC-018] Contenido — Qui la porta
<!-- id:ESC-018 -->
>>> VA
Qui la porta
>>> ES
Quién la lleva
>>> END

#### [ESC-019] Contenido — per confirmar
<!-- id:ESC-019 -->
>>> VA
per confirmar
>>> ES
por confirmar
>>> END

#### [ESC-020] Contenido — Edat
<!-- id:ESC-020 -->
>>> VA
Edat
>>> ES
Edad
>>> END

#### [ESC-021] Contenido — anys
<!-- id:ESC-021 -->
>>> VA
anys
>>> ES
años
>>> END

#### [ESC-022] aria-label — Altres seccions
<!-- id:ESC-022 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Altres seccions
>>> END

#### [ESC-023] Contenido — Les altres seccions
<!-- id:ESC-023 -->
>>> VA
Les altres seccions
>>> ES
Las otras secciones
>>> END

#### [ESC-024] Contenido — Estol
<!-- id:ESC-024 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [ESC-025] Contenido — Vols provar els Escoltes?
<!-- id:ESC-025 -->
>>> VA
Vols provar els Escoltes?
>>> ES
¿Quieres probar los Escultas?
>>> END

#### [ESC-026] Contenido — Si té entre 14 i 17 anys, ací decidirà i creixerà. Vine un dissabte i…
<!-- id:ESC-026 -->
>>> VA
Si té entre 14 i 17 anys, ací decidirà i creixerà. Vine un dissabte i que ho prove, sense compromís.
>>> ES
Si tiene entre 14 y 17 años, aquí decidirá y crecerá. Ven un sábado y que lo pruebe, sin compromiso.
>>> END

#### [ESC-027] Contenido — Apunta el teu fill/a
<!-- id:ESC-027 -->
>>> VA
Apunta el teu fill/a
>>> ES
Apunta a tu hijo/a
>>> END

---

## Clan — clan.html

#### [CLA-001] Título de pestaña — Clan · Grup Scout Parpalló
<!-- id:CLA-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Clan · Grup Scout Parpalló
>>> END

#### [CLA-002] Meta description — El Clan del Grup Scout Parpalló: jóvens de 17 a 21 anys.
<!-- id:CLA-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
El Clan del Grup Scout Parpalló: jóvens de 17 a 21 anys.
>>> END

#### [CLA-003] aria-label — Molla de pa
<!-- id:CLA-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [CLA-004] Contenido — Inici
<!-- id:CLA-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [CLA-005] Contenido — Seccions
<!-- id:CLA-005 -->
>>> VA
Seccions
>>> ES
Secciones
>>> END

#### [CLA-006] Contenido — anys
<!-- id:CLA-006 -->
>>> VA
anys
>>> ES
años
>>> END

#### [CLA-007] Encabezado — Clan
<!-- id:CLA-007 -->
_Nota: Encabezado sin variante en castellano en el código actual (probablemente un nombre propio). Confirma si hay que tocarlo._
>>> VA
Clan
>>> END

#### [CLA-008] Contenido — El servici i el compromís. Fan la seua ruta i decidixen com ajudar.
<!-- id:CLA-008 -->
>>> VA
El servici i el compromís. Fan la seua ruta i decidixen com ajudar.
>>> ES
El servicio y el compromiso. Hacen su ruta y deciden cómo ayudar.
>>> END

#### [CLA-009] Contenido — Anima't a entrar
<!-- id:CLA-009 -->
>>> VA
Anima't a entrar
>>> ES
Anímate a entrar
>>> END

#### [CLA-010] Contenido — [ foto real del Clan ]
<!-- id:CLA-010 -->
>>> VA
[ foto real del Clan ]
>>> ES
[ foto real del Clan ]
>>> END

#### [CLA-011] Contenido — El Clan és el pas final. Fan la seua ruta —dies caminant i convivint—…
<!-- id:CLA-011 -->
>>> VA
El Clan és el pas final. Fan la seua ruta —dies caminant i convivint— i decidixen com volen servir als altres. Molts acaben sent monitores del grup: ací l'escoltisme es torna una manera de mirar el món.
>>> ES
El Clan es el paso final. Hacen su ruta —días caminando y conviviendo— y deciden cómo quieren servir a los demás. Muchos acaban siendo monitoras del grupo: aquí el escultismo se vuelve una manera de mirar el mundo.
>>> END

#### [CLA-012] Contenido — Un dissabte
<!-- id:CLA-012 -->
>>> VA
Un dissabte
>>> ES
Un sábado
>>> END

#### [CLA-013] Contenido — Trobades per a preparar la ruta i els projectes de servici.
<!-- id:CLA-013 -->
>>> VA
Trobades per a preparar la ruta i els projectes de servici.
>>> ES
Encuentros para preparar la ruta y los proyectos de servicio.
>>> END

#### [CLA-014] Contenido — Com s'organitzen
<!-- id:CLA-014 -->
>>> VA
Com s'organitzen
>>> ES
Cómo se organizan
>>> END

#### [CLA-015] Contenido — Com a clan, decidint entre tots i amb molta autonomia.
<!-- id:CLA-015 -->
>>> VA
Com a clan, decidint entre tots i amb molta autonomia.
>>> ES
Como clan, decidiendo entre todos y con mucha autonomía.
>>> END

#### [CLA-016] Contenido — Qui el porta
<!-- id:CLA-016 -->
>>> VA
Qui el porta
>>> ES
Quién lo lleva
>>> END

#### [CLA-017] Contenido — per confirmar
<!-- id:CLA-017 -->
>>> VA
per confirmar
>>> ES
por confirmar
>>> END

#### [CLA-018] Contenido — Edat
<!-- id:CLA-018 -->
>>> VA
Edat
>>> ES
Edad
>>> END

#### [CLA-019] Contenido — anys
<!-- id:CLA-019 -->
>>> VA
anys
>>> ES
años
>>> END

#### [CLA-020] aria-label — Altres seccions
<!-- id:CLA-020 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Altres seccions
>>> END

#### [CLA-021] Contenido — Les altres seccions
<!-- id:CLA-021 -->
>>> VA
Les altres seccions
>>> ES
Las otras secciones
>>> END

#### [CLA-022] Contenido — Estol
<!-- id:CLA-022 -->
>>> VA
Estol
>>> ES
Manada
>>> END

#### [CLA-023] Contenido — Escoltes
<!-- id:CLA-023 -->
>>> VA
Escoltes
>>> ES
Escultas
>>> END

#### [CLA-024] Contenido — T'animes al Clan?
<!-- id:CLA-024 -->
>>> VA
T'animes al Clan?
>>> ES
¿Te animas al Clan?
>>> END

#### [CLA-025] Contenido — Si tens entre 17 i 21 anys, este és el teu moment. Vine i coneix el C…
<!-- id:CLA-025 -->
>>> VA
Si tens entre 17 i 21 anys, este és el teu moment. Vine i coneix el Clan, sense compromís.
>>> ES
Si tienes entre 17 y 21 años, este es tu momento. Ven y conoce el Clan, sin compromiso.
>>> END

#### [CLA-026] Contenido — Anima't a entrar
<!-- id:CLA-026 -->
>>> VA
Anima't a entrar
>>> ES
Anímate a entrar
>>> END

---

## Fer-se scout — fersescout.html

#### [FER-001] Título de pestaña — Fer-se scout · Grup Scout Parpalló
<!-- id:FER-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Fer-se scout · Grup Scout Parpalló
>>> END

#### [FER-002] Meta description — Apunta el teu fill o filla al Grup Scout Parpalló de Gandia.
<!-- id:FER-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Apunta el teu fill o filla al Grup Scout Parpalló de Gandia.
>>> END

#### [FER-003] aria-label — Molla de pa
<!-- id:FER-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [FER-004] Contenido — Inici
<!-- id:FER-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [FER-005] Contenido — Fer-se scout
<!-- id:FER-005 -->
>>> VA
Fer-se scout
>>> ES
Hacerse scout
>>> END

#### [FER-006] Contenido — La part important
<!-- id:FER-006 -->
>>> VA
La part important
>>> ES
La parte importante
>>> END

#### [FER-007] Contenido — Fer-se scout
<!-- id:FER-007 -->
>>> VA
Fer-se scout
>>> ES
Hacerse scout
>>> END

#### [FER-008] Contenido — Ens alegra un munt&#243; que t'ho estigues plantejant. Deixa'ns les d…
<!-- id:FER-008 -->
>>> VA
Ens alegra un munt&#243; que t'ho estigues plantejant. Deixa'ns les dades i et cridem per a parlar-ho amb calma.
>>> ES
Nos alegra un mont&#243;n que te lo est&#233;s planteando. D&#233;janos los datos y te llamamos para hablarlo con calma.
>>> END

#### [FER-009] Contenido — Deixes les dades del xiquet/a en esta fitxa.
<!-- id:FER-009 -->
>>> VA
Deixes les dades del xiquet/a en esta fitxa.
>>> ES
Dejas los datos del ni&#241;o/a en esta ficha.
>>> END

#### [FER-010] Contenido — Et cridem per a con&#233;ixer-vos i resoldre dubtes.
<!-- id:FER-010 -->
>>> VA
Et cridem per a con&#233;ixer-vos i resoldre dubtes.
>>> ES
Te llamamos para conoceros y resolver dudas.
>>> END

#### [FER-011] Contenido — Primer dissabte de prova, sense cap comprom&#237;s.
<!-- id:FER-011 -->
>>> VA
Primer dissabte de prova, sense cap comprom&#237;s.
>>> ES
Primer s&#225;bado de prueba, sin ning&#250;n compromiso.
>>> END

#### [FER-012] Contenido — Segons l'edat pot haver-hi llista d'espera. Deixa'ns el contacte igua…
<!-- id:FER-012 -->
>>> VA
Segons l'edat pot haver-hi llista d'espera. Deixa'ns el contacte igualment i t'avisem.
>>> ES
Seg&#250;n la edad puede haber lista de espera. D&#233;janos el contacto igualmente y te avisamos.
>>> END

#### [FER-013] aria-label — Sol·licitud de plaça
<!-- id:FER-013 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Sol·licitud de plaça
>>> END

#### [FER-014] Contenido — El xiquet o xiqueta
<!-- id:FER-014 -->
>>> VA
El xiquet o xiqueta
>>> ES
El niño o niña
>>> END

#### [FER-015] Contenido — Nom
<!-- id:FER-015 -->
>>> VA
Nom
>>> ES
Nombre
>>> END

#### [FER-016] Contenido — Cognoms
<!-- id:FER-016 -->
>>> VA
Cognoms
>>> ES
Apellidos
>>> END

#### [FER-017] Contenido — Data de naixement
<!-- id:FER-017 -->
>>> VA
Data de naixement
>>> ES
Fecha de nacimiento
>>> END

#### [FER-018] Contenido — Secció
<!-- id:FER-018 -->
>>> VA
Secció
>>> ES
Sección
>>> END

#### [FER-019] Contenido — t'ajudem per l'edat
<!-- id:FER-019 -->
>>> VA
t'ajudem per l'edat
>>> ES
te ayudamos por la edad
>>> END

#### [FER-020] Contenido — Al·lèrgies, necessitats o coses que hem de saber
<!-- id:FER-020 -->
>>> VA
Al·lèrgies, necessitats o coses que hem de saber
>>> ES
Alergias, necesidades o cosas que debemos saber
>>> END

#### [FER-021] Contenido — Qui l'apunta (mare, pare o tutor/a)
<!-- id:FER-021 -->
>>> VA
Qui l'apunta (mare, pare o tutor/a)
>>> ES
Quién lo apunta (madre, padre o tutor/a)
>>> END

#### [FER-022] Contenido — Nom i cognoms
<!-- id:FER-022 -->
>>> VA
Nom i cognoms
>>> ES
Nombre y apellidos
>>> END

#### [FER-023] Contenido — Telèfon
<!-- id:FER-023 -->
>>> VA
Telèfon
>>> ES
Teléfono
>>> END

#### [FER-024] Contenido — Com ens has conegut?
<!-- id:FER-024 -->
>>> VA
Com ens has conegut?
>>> ES
¿Cómo nos has conocido?
>>> END

#### [FER-025] Contenido — Permisos
<!-- id:FER-025 -->
>>> VA
Permisos
>>> ES
Permisos
>>> END

#### [FER-026] Contenido — He llegit i accepte la <a href="privacitat.html">política de protecci…
<!-- id:FER-026 -->
_Nota: Contiene una etiqueta HTML dentro del texto (por ejemplo un enlace o un <strong>): consérvala tal cual, solo reescribe las palabras de dentro y de fuera._
>>> VA
He llegit i accepte la <a href="privacitat.html">política de protecció de dades de menors</a>.
>>> ES
He leído y acepto la <a href="privacitat.html">política de protección de datos de menores</a>.
>>> END

#### [FER-027] Contenido — Vull que em contacteu per a parlar de la plaça.
<!-- id:FER-027 -->
>>> VA
Vull que em contacteu per a parlar de la plaça.
>>> ES
Quiero que me contactéis para hablar de la plaza.
>>> END

#### [FER-028] Contenido — Envia la sol·licitud
<!-- id:FER-028 -->
>>> VA
Envia la sol·licitud
>>> ES
Enviar la solicitud
>>> END

#### [FER-029] Contenido — I què passa el primer dia?
<!-- id:FER-029 -->
>>> VA
I què passa el primer dia?
>>> ES
¿Y qué pasa el primer día?
>>> END

#### [FER-030] Contenido — Véns al local a l'hora de la reunió, preguntes per <span class="pend"…
<!-- id:FER-030 -->
_Nota: Contiene un fragmento <span class="pend">…</span> dentro de la frase: no borres esa etiqueta, solo puedes reescribir el texto que hay dentro y fuera de ella._
>>> VA
Véns al local a l'hora de la reunió, preguntes per <span class="pend">responsable — per confirmar</span>, i el teu fill se'n va a jugar amb la seua secció. Tu et quedes el que faça falta. No cal portar res, només ganes.
>>> ES
Vienes al local a la hora de la reunión, preguntas por <span class="pend">responsable — por confirmar</span>, y tu hijo se va a jugar con su sección. Tú te quedas lo que haga falta. No hace falta traer nada, solo ganas.
>>> END

---

## Botiga del grup — merchandising.html

#### [BOT-001] Título de pestaña — Botiga del grup · Grup Scout Parpalló
<!-- id:BOT-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Botiga del grup · Grup Scout Parpalló
>>> END

#### [BOT-002] Meta description — Sudadera, polar, pañoleta i insígnies del Grup Scout Parpalló de Gand…
<!-- id:BOT-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Sudadera, polar, pañoleta i insígnies del Grup Scout Parpalló de Gandia. Reserva-ho i t'ho preparem per a un dissabte.
>>> END

#### [BOT-003] aria-label — Molla de pa
<!-- id:BOT-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [BOT-004] Contenido — Inici
<!-- id:BOT-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [BOT-005] Contenido — Botiga
<!-- id:BOT-005 -->
>>> VA
Botiga
>>> ES
Tienda
>>> END

#### [BOT-006] Contenido — Roba i insígnies del grup
<!-- id:BOT-006 -->
>>> VA
Roba i insígnies del grup
>>> ES
Ropa e insignias del grupo
>>> END

#### [BOT-007] Contenido — La botiga del grup
<!-- id:BOT-007 -->
>>> VA
La botiga del grup
>>> ES
La tienda del grupo
>>> END

#### [BOT-008] Contenido — La sudadera, el polar, la pañoleta i les insígnies del Parpalló. Tria…
<!-- id:BOT-008 -->
>>> VA
La sudadera, el polar, la pañoleta i les insígnies del Parpalló. Tria el que vulgues, envia'ns la reserva i quedem un dissabte per a arreplegar-ho al local.
>>> ES
La sudadera, el polar, la pañoleta y las insignias del Parpalló. Elige lo que quieras, envíanos la reserva y quedamos un sábado para recogerlo en el local.
>>> END

#### [BOT-009] Contenido — No es paga res per la web: es paga en arreplegar-ho.
<!-- id:BOT-009 -->
>>> VA
No es paga res per la web: es paga en arreplegar-ho.
>>> ES
No se paga nada por la web: se paga al recogerlo.
>>> END

#### [BOT-010] aria-label — Reserva de la botiga
<!-- id:BOT-010 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Reserva de la botiga
>>> END

#### [BOT-011] Contenido — Vestimenta scout
<!-- id:BOT-011 -->
>>> VA
Vestimenta scout
>>> ES
Vestimenta scout
>>> END

#### [BOT-012] Contenido — Sudadera
<!-- id:BOT-012 -->
>>> VA
Sudadera
>>> ES
Sudadera
>>> END

#### [BOT-013] Contenido — Amb el logo de la flor de lis a la part frontal, el disseny propi del…
<!-- id:BOT-013 -->
>>> VA
Amb el logo de la flor de lis a la part frontal, el disseny propi del grup a l'esquena i el nom del grup a les mànegues.
>>> ES
Con el logo de la flor de lis en la parte frontal, el diseño propio del grupo en la espalda y el nombre del grupo en las mangas.
>>> END

#### [BOT-014] Contenido — Unitats
<!-- id:BOT-014 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-015] aria-label — Llevar una unitat de Sudadera
<!-- id:BOT-015 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Sudadera
>>> END

#### [BOT-016] aria-label — Afegir una unitat de Sudadera
<!-- id:BOT-016 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Sudadera
>>> END

#### [BOT-017] Contenido — Polar
<!-- id:BOT-017 -->
>>> VA
Polar
>>> ES
Polar
>>> END

#### [BOT-018] Contenido — Polar del Grup Scout Parpalló amb la cérvola serigrafiada a l'esquena…
<!-- id:BOT-018 -->
>>> VA
Polar del Grup Scout Parpalló amb la cérvola serigrafiada a l'esquena. Peça còmoda que evita la pèrdua de calor, amb cremallera central.
>>> ES
Polar del Grup Scout Parpalló con la cierva serigrafiada en la espalda. Prenda cómoda que evita la pérdida de calor, con cremallera central.
>>> END

#### [BOT-019] Contenido — Unitats
<!-- id:BOT-019 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-020] aria-label — Llevar una unitat de Polar
<!-- id:BOT-020 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Polar
>>> END

#### [BOT-021] aria-label — Afegir una unitat de Polar
<!-- id:BOT-021 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Polar
>>> END

#### [BOT-022] Contenido — Camiseta morada
<!-- id:BOT-022 -->
>>> VA
Camiseta morada
>>> ES
Camiseta morada
>>> END

#### [BOT-023] Contenido — Camiseta de màniga curta amb el color morat del grup i la cérvola ser…
<!-- id:BOT-023 -->
>>> VA
Camiseta de màniga curta amb el color morat del grup i la cérvola serigrafiada en blanc.
>>> ES
Camiseta de manga corta con el color morado del grupo y la cierva serigrafiada en blanco.
>>> END

#### [BOT-024] Contenido — Unitats
<!-- id:BOT-024 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-025] aria-label — Llevar una unitat de Camiseta morada
<!-- id:BOT-025 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Camiseta morada
>>> END

#### [BOT-026] aria-label — Afegir una unitat de Camiseta morada
<!-- id:BOT-026 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Camiseta morada
>>> END

#### [BOT-027] Contenido — Polo de màniga curta, llis
<!-- id:BOT-027 -->
>>> VA
Polo de màniga curta, llis
>>> ES
Polo de manga corta, liso
>>> END

#### [BOT-028] Contenido — Polo de màniga curta sense cap logotip. Peça còmoda i lleugera per al…
<!-- id:BOT-028 -->
>>> VA
Polo de màniga curta sense cap logotip. Peça còmoda i lleugera per als mesos de calor.
>>> ES
Polo de manga corta sin ningún logotipo. Prenda cómoda y ligera para los meses de calor.
>>> END

#### [BOT-029] Contenido — Unitats
<!-- id:BOT-029 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-030] aria-label — Llevar una unitat de Polo llis
<!-- id:BOT-030 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Polo llis
>>> END

#### [BOT-031] aria-label — Afegir una unitat de Polo llis
<!-- id:BOT-031 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Polo llis
>>> END

#### [BOT-032] Contenido — Polo de màniga curta amb insígnia
<!-- id:BOT-032 -->
>>> VA
Polo de màniga curta amb insígnia
>>> ES
Polo de manga corta con insignia
>>> END

#### [BOT-033] Contenido — Polo de màniga curta amb la flor de lis. Peça còmoda i lleugera per a…
<!-- id:BOT-033 -->
>>> VA
Polo de màniga curta amb la flor de lis. Peça còmoda i lleugera per als mesos de calor.
>>> ES
Polo de manga corta con la flor de lis. Prenda cómoda y ligera para los meses de calor.
>>> END

#### [BOT-034] Contenido — Unitats
<!-- id:BOT-034 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-035] aria-label — Llevar una unitat de Polo amb insígnia
<!-- id:BOT-035 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Polo amb insígnia
>>> END

#### [BOT-036] aria-label — Afegir una unitat de Polo amb insígnia
<!-- id:BOT-036 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Polo amb insígnia
>>> END

#### [BOT-037] Contenido — Complements
<!-- id:BOT-037 -->
>>> VA
Complements
>>> ES
Complementos
>>> END

#### [BOT-038] Contenido — Pañoleta del Parpalló
<!-- id:BOT-038 -->
>>> VA
Pañoleta del Parpalló
>>> ES
Pañoleta del Parpalló
>>> END

#### [BOT-039] Contenido — Pañoleta groga amb el logo i el text en morat, la del Grup Scout Parp…
<!-- id:BOT-039 -->
>>> VA
Pañoleta groga amb el logo i el text en morat, la del Grup Scout Parpalló de Gandia.
>>> ES
Pañoleta amarilla con el logo y el texto en morado, la del Grup Scout Parpalló de Gandia.
>>> END

#### [BOT-040] Contenido — Unitats
<!-- id:BOT-040 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-041] aria-label — Llevar una unitat de Pañoleta
<!-- id:BOT-041 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Pañoleta
>>> END

#### [BOT-042] aria-label — Afegir una unitat de Pañoleta
<!-- id:BOT-042 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Pañoleta
>>> END

#### [BOT-043] Contenido — Bossa motxilla
<!-- id:BOT-043 -->
>>> VA
Bossa motxilla
>>> ES
Bolsa mochila
>>> END

#### [BOT-044] Contenido — Còmoda bossa-motxilla per a portar objectes menuts.
<!-- id:BOT-044 -->
>>> VA
Còmoda bossa-motxilla per a portar objectes menuts.
>>> ES
Cómoda bolsa-mochila para llevar objetos pequeños.
>>> END

#### [BOT-045] Contenido — Unitats
<!-- id:BOT-045 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-046] aria-label — Llevar una unitat de Bossa motxilla
<!-- id:BOT-046 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat de Bossa motxilla
>>> END

#### [BOT-047] aria-label — Afegir una unitat de Bossa motxilla
<!-- id:BOT-047 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat de Bossa motxilla
>>> END

#### [BOT-048] Contenido — Insígnies
<!-- id:BOT-048 -->
>>> VA
Insígnies
>>> ES
Insignias
>>> END

#### [BOT-049] Contenido — Insígnia de la cérvola
<!-- id:BOT-049 -->
>>> VA
Insígnia de la cérvola
>>> ES
Insignia de la cierva
>>> END

#### [BOT-050] Contenido — La insígnia del Grup Scout Parpalló de Gandia: la cérvola sobre fons …
<!-- id:BOT-050 -->
>>> VA
La insígnia del Grup Scout Parpalló de Gandia: la cérvola sobre fons roig i verd.
>>> ES
La insignia del Grup Scout Parpalló de Gandia: la cierva sobre fondo rojo y verde.
>>> END

#### [BOT-051] Contenido — Unitats
<!-- id:BOT-051 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-052] aria-label — Llevar una unitat d'Insígnia de la cérvola
<!-- id:BOT-052 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat d'Insígnia de la cérvola
>>> END

#### [BOT-053] aria-label — Afegir una unitat d'Insígnia de la cérvola
<!-- id:BOT-053 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat d'Insígnia de la cérvola
>>> END

#### [BOT-054] Contenido — Insígnia flor de lis SSVV
<!-- id:BOT-054 -->
>>> VA
Insígnia flor de lis SSVV
>>> ES
Insignia flor de lis SSVV
>>> END

#### [BOT-055] Contenido — La flor de lis brodada sobre fons morat, logotip de Scouts Valencians.
<!-- id:BOT-055 -->
>>> VA
La flor de lis brodada sobre fons morat, logotip de Scouts Valencians.
>>> ES
La flor de lis bordada sobre fondo morado, logotipo de Scouts Valencians.
>>> END

#### [BOT-056] Contenido — Unitats
<!-- id:BOT-056 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-057] aria-label — Llevar una unitat d'Insígnia flor de lis
<!-- id:BOT-057 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat d'Insígnia flor de lis
>>> END

#### [BOT-058] aria-label — Afegir una unitat d'Insígnia flor de lis
<!-- id:BOT-058 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat d'Insígnia flor de lis
>>> END

#### [BOT-059] Contenido — Insígnia de la Tropa
<!-- id:BOT-059 -->
>>> VA
Insígnia de la Tropa
>>> ES
Insignia de la Tropa
>>> END

#### [BOT-060] Contenido — El nus margarida: el llaç amb els companys i companyes de patrulla, q…
<!-- id:BOT-060 -->
>>> VA
El nus margarida: el llaç amb els companys i companyes de patrulla, que acaba sent part del mateix element.
>>> ES
El nudo margarita: el lazo con los compañeros y compañeras de patrulla, que acaba siendo parte del mismo elemento.
>>> END

#### [BOT-061] Contenido — Unitats
<!-- id:BOT-061 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-062] aria-label — Llevar una unitat d'Insígnia de la Tropa
<!-- id:BOT-062 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat d'Insígnia de la Tropa
>>> END

#### [BOT-063] aria-label — Afegir una unitat d'Insígnia de la Tropa
<!-- id:BOT-063 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat d'Insígnia de la Tropa
>>> END

#### [BOT-064] Contenido — Insígnia de l'Estol
<!-- id:BOT-064 -->
>>> VA
Insígnia de l'Estol
>>> ES
Insignia de la Manada
>>> END

#### [BOT-065] Contenido — El llobató segueix la petjada del llop més expert: Akela l'introduirà…
<!-- id:BOT-065 -->
>>> VA
El llobató segueix la petjada del llop més expert: Akela l'introduirà en la selva i n'anirà descobrint les normes i els valors.
>>> ES
El lobato sigue la huella del lobo más experto: Akela lo introducirá en la selva y así irá descubriendo sus normas y sus valores.
>>> END

#### [BOT-066] Contenido — Unitats
<!-- id:BOT-066 -->
>>> VA
Unitats
>>> ES
Unidades
>>> END

#### [BOT-067] aria-label — Llevar una unitat d'Insígnia de l'Estol
<!-- id:BOT-067 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Llevar una unitat d'Insígnia de l'Estol
>>> END

#### [BOT-068] aria-label — Afegir una unitat d'Insígnia de l'Estol
<!-- id:BOT-068 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Afegir una unitat d'Insígnia de l'Estol
>>> END

#### [BOT-069] Contenido — Encara no has triat res.
<!-- id:BOT-069 -->
>>> VA
Encara no has triat res.
>>> ES
Todavía no has elegido nada.
>>> END

#### [BOT-070] Contenido — Anar a les dades →
<!-- id:BOT-070 -->
>>> VA
Anar a les dades →
>>> ES
Ir a los datos →
>>> END

#### [BOT-071] Contenido — Últim pas
<!-- id:BOT-071 -->
>>> VA
Últim pas
>>> ES
Último paso
>>> END

#### [BOT-072] Contenido — Les teues dades
<!-- id:BOT-072 -->
>>> VA
Les teues dades
>>> ES
Tus datos
>>> END

#### [BOT-073] Contenido — Amb això ja podem apartar-t'ho. Et contestem per correu per a confirm…
<!-- id:BOT-073 -->
>>> VA
Amb això ja podem apartar-t'ho. Et contestem per correu per a confirmar-te la disponibilitat i quedar un dissabte.
>>> ES
Con esto ya podemos apartártelo. Te contestamos por correo para confirmarte la disponibilidad y quedar un sábado.
>>> END

#### [BOT-074] Contenido — La teua reserva
<!-- id:BOT-074 -->
>>> VA
La teua reserva
>>> ES
Tu reserva
>>> END

#### [BOT-075] Contenido — Puja i tria les unitats que vulgues de cada article.
<!-- id:BOT-075 -->
>>> VA
Puja i tria les unitats que vulgues de cada article.
>>> ES
Sube y elige las unidades que quieras de cada artículo.
>>> END

#### [BOT-076] Contenido — Total
<!-- id:BOT-076 -->
>>> VA
Total
>>> ES
Total
>>> END

#### [BOT-077] Contenido — Qui fa la reserva
<!-- id:BOT-077 -->
>>> VA
Qui fa la reserva
>>> ES
Quién hace la reserva
>>> END

#### [BOT-078] Contenido — Nom
<!-- id:BOT-078 -->
>>> VA
Nom
>>> ES
Nombre
>>> END

#### [BOT-079] Contenido — Cognoms
<!-- id:BOT-079 -->
>>> VA
Cognoms
>>> ES
Apellidos
>>> END

#### [BOT-080] Contenido — Telèfon
<!-- id:BOT-080 -->
>>> VA
Telèfon
>>> ES
Teléfono
>>> END

#### [BOT-081] Contenido — opcional
<!-- id:BOT-081 -->
>>> VA
opcional
>>> ES
opcional
>>> END

#### [BOT-082] Contenido — Talles o qualsevol cosa que hem de saber
<!-- id:BOT-082 -->
>>> VA
Talles o qualsevol cosa que hem de saber
>>> ES
Tallas o cualquier cosa que debamos saber
>>> END

#### [BOT-083] Contenido — Permisos
<!-- id:BOT-083 -->
>>> VA
Permisos
>>> ES
Permisos
>>> END

#### [BOT-084] Contenido — He llegit i accepte la <a href="privacitat.html">política de protecci…
<!-- id:BOT-084 -->
_Nota: Contiene una etiqueta HTML dentro del texto (por ejemplo un enlace o un <strong>): consérvala tal cual, solo reescribe las palabras de dentro y de fuera._
>>> VA
He llegit i accepte la <a href="privacitat.html">política de protecció de dades</a>.
>>> ES
He leído y acepto la <a href="privacitat.html">política de protección de datos</a>.
>>> END

#### [BOT-085] Contenido — Envia la reserva
<!-- id:BOT-085 -->
>>> VA
Envia la reserva
>>> ES
Enviar la reserva
>>> END

#### [BOT-086] Contenido — Reservar no és comprar: no es cobra res ara. Et confirmem disponibili…
<!-- id:BOT-086 -->
>>> VA
Reservar no és comprar: no es cobra res ara. Et confirmem disponibilitat i pagues en arreplegar-ho al local.
>>> ES
Reservar no es comprar: no se cobra nada ahora. Te confirmamos disponibilidad y pagas al recogerlo en el local.
>>> END

---

## Avís legal — avis-legal.html

#### [LEG-001] Título de pestaña — Avís legal · Grup Scout Parpalló
<!-- id:LEG-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Avís legal · Grup Scout Parpalló
>>> END

#### [LEG-002] Meta description — Dades del titular d'esta web i condicions d'ús del lloc del Grup Scou…
<!-- id:LEG-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Dades del titular d'esta web i condicions d'ús del lloc del Grup Scout Parpalló.
>>> END

#### [LEG-003] aria-label — Molla de pa
<!-- id:LEG-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [LEG-004] Contenido — Inici
<!-- id:LEG-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [LEG-005] Contenido — Avís legal
<!-- id:LEG-005 -->
>>> VA
Avís legal
>>> ES
Aviso legal
>>> END

#### [LEG-006] Contenido — Avís legal
<!-- id:LEG-006 -->
>>> VA
Avís legal
>>> ES
Aviso legal
>>> END

#### [LEG-007] Contenido — Qui publica esta web i en quines condicions es pot fer servir.
<!-- id:LEG-007 -->
>>> VA
Qui publica esta web i en quines condicions es pot fer servir.
>>> ES
Quién publica esta web y en qué condiciones se puede usar.
>>> END

#### [LEG-008] Contenido — Estes són les condicions d'ús d'esta web i les dades de qui la public…
<!-- id:LEG-008 -->
>>> VA
Estes són les condicions d'ús d'esta web i les dades de qui la publica.
>>> ES
Estas son las condiciones de uso de esta web y los datos de quien la publica.
>>> END

#### [LEG-009] Contenido — Qui publica esta web
<!-- id:LEG-009 -->
>>> VA
Qui publica esta web
>>> ES
Quién publica esta web
>>> END

#### [LEG-010] Contenido — Denominació:
<!-- id:LEG-010 -->
>>> VA
Denominació: 
>>> ES
Denominación: 
>>> END

#### [LEG-011] Contenido — Domicili:
<!-- id:LEG-011 -->
>>> VA
Domicili: 
>>> ES
Domicilio: 
>>> END

#### [LEG-012] Contenido — Inscripció registral:
<!-- id:LEG-012 -->
>>> VA
Inscripció registral: 
>>> ES
Inscripción registral: 
>>> END

#### [LEG-013] Contenido — Correu de contacte:
<!-- id:LEG-013 -->
>>> VA
Correu de contacte: 
>>> ES
Correo de contacto: 
>>> END

#### [LEG-014] Contenido — Per a què serveix esta web
<!-- id:LEG-014 -->
>>> VA
Per a què serveix esta web
>>> ES
Para qué sirve esta web
>>> END

#### [LEG-015] Contenido — Esta web és informativa: conta qui som, què fem i com apuntar-se al g…
<!-- id:LEG-015 -->
>>> VA
Esta web és informativa: conta qui som, què fem i com apuntar-se al grup. No és una botiga ni cobra res per cap servei.
>>> ES
Esta web es informativa: cuenta quiénes somos, qué hacemos y cómo apuntarse al grupo. No es una tienda ni cobra nada por ningún servicio.
>>> END

#### [LEG-016] Contenido — Condicions d'ús
<!-- id:LEG-016 -->
>>> VA
Condicions d'ús
>>> ES
Condiciones de uso
>>> END

#### [LEG-017] Contenido — En navegar per esta web acceptes usar-la de bona fe i no fer-la servi…
<!-- id:LEG-017 -->
>>> VA
En navegar per esta web acceptes usar-la de bona fe i no fer-la servir per a res que puga danyar-la o impedir que altres la puguen utilitzar. El formulari de sol·licitud de plaça s'ha d'omplir amb dades certes i només per qui té la pàtria potestat o la tutela del menor.
>>> ES
Al navegar por esta web aceptas usarla de buena fe y no utilizarla para nada que pueda dañarla o impedir que otras personas la puedan usar. El formulario de solicitud de plaza se debe rellenar con datos ciertos y solo por quien tiene la patria potestad o la tutela del menor.
>>> END

#### [LEG-018] Contenido — Continguts, textos i fotografies
<!-- id:LEG-018 -->
>>> VA
Continguts, textos i fotografies
>>> ES
Contenidos, textos y fotografías
>>> END

#### [LEG-019] Contenido — Titularitat i condicions d'ús dels continguts:
<!-- id:LEG-019 -->
>>> VA
Titularitat i condicions d'ús dels continguts: 
>>> ES
Titularidad y condiciones de uso de los contenidos: 
>>> END

#### [LEG-020] Contenido — Enllaços a altres webs
<!-- id:LEG-020 -->
>>> VA
Enllaços a altres webs
>>> ES
Enlaces a otras webs
>>> END

#### [LEG-021] Contenido — Esta web pot enllaçar a llocs d'altres organitzacions, com la federac…
<!-- id:LEG-021 -->
>>> VA
Esta web pot enllaçar a llocs d'altres organitzacions, com la federació. No controlem el que publiquen ni ens en fem responsables: quan ixques d'esta web, valen les seues condicions i la seua política de privacitat.
>>> ES
Esta web puede enlazar a sitios de otras organizaciones, como la federación. No controlamos lo que publican ni nos hacemos responsables de ello: cuando salgas de esta web, valen sus condiciones y su política de privacidad.
>>> END

#### [LEG-022] Contenido — Protecció de dades
<!-- id:LEG-022 -->
>>> VA
Protecció de dades
>>> ES
Protección de datos
>>> END

#### [LEG-023] Contenido — Tot el que té a veure amb les dades personals, i en especial amb les …
<!-- id:LEG-023 -->
>>> VA
Tot el que té a veure amb les dades personals, i en especial amb les dades de menors, s'explica a la 
>>> ES
Todo lo que tiene que ver con los datos personales, y en especial con los datos de menores, se explica en la 
>>> END

#### [LEG-024] Contenido — política de privacitat
<!-- id:LEG-024 -->
>>> VA
política de privacitat
>>> ES
política de privacidad
>>> END

#### [LEG-025] Contenido — Legislació aplicable
<!-- id:LEG-025 -->
>>> VA
Legislació aplicable
>>> ES
Legislación aplicable
>>> END

---

## Privacitat — privacitat.html

#### [PRI-001] Título de pestaña — Política de privacitat · Grup Scout Parpalló
<!-- id:PRI-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Política de privacitat · Grup Scout Parpalló
>>> END

#### [PRI-002] Meta description — Com tracta el Grup Scout Parpalló les dades personals del formulari d…
<!-- id:PRI-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Com tracta el Grup Scout Parpalló les dades personals del formulari de sol·licitud de plaça, amb un apartat específic sobre dades de menors.
>>> END

#### [PRI-003] aria-label — Molla de pa
<!-- id:PRI-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [PRI-004] Contenido — Inici
<!-- id:PRI-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [PRI-005] Contenido — Política de privacitat
<!-- id:PRI-005 -->
>>> VA
Política de privacitat
>>> ES
Política de privacidad
>>> END

#### [PRI-006] Contenido — Política de privacitat
<!-- id:PRI-006 -->
>>> VA
Política de privacitat
>>> ES
Política de privacidad
>>> END

#### [PRI-007] Contenido — Quines dades demanem, per a què les fem servir i com les protegim.
<!-- id:PRI-007 -->
>>> VA
Quines dades demanem, per a què les fem servir i com les protegim.
>>> ES
Qué datos pedimos, para qué los usamos y cómo los protegemos.
>>> END

#### [PRI-008] Contenido — Ací expliquem quines dades demanem al formulari de sol·licitud de pla…
<!-- id:PRI-008 -->
>>> VA
Ací expliquem quines dades demanem al formulari de sol·licitud de plaça, per a què les fem servir i què pots fer per a controlar-les. Hi ha un apartat específic sobre les dades dels menors, perquè és el cas que més ens importa cuidar.
>>> ES
Aquí explicamos qué datos pedimos en el formulario de solicitud de plaza, para qué los usamos y qué puedes hacer para controlarlos. Hay un apartado específico sobre los datos de los menores, porque es el caso que más nos importa cuidar.
>>> END

#### [PRI-009] Contenido — Qui és el responsable de les teues dades
<!-- id:PRI-009 -->
>>> VA
Qui és el responsable de les teues dades
>>> ES
Quién es el responsable de tus datos
>>> END

#### [PRI-010] Contenido — El responsable del tractament és:
<!-- id:PRI-010 -->
>>> VA
El responsable del tractament és:
>>> ES
El responsable del tratamiento es:
>>> END

#### [PRI-011] Contenido — Denominació:
<!-- id:PRI-011 -->
>>> VA
Denominació: 
>>> ES
Denominación: 
>>> END

#### [PRI-012] Contenido — Domicili:
<!-- id:PRI-012 -->
>>> VA
Domicili: 
>>> ES
Domicilio: 
>>> END

#### [PRI-013] Contenido — Correu de contacte:
<!-- id:PRI-013 -->
>>> VA
Correu de contacte: 
>>> ES
Correo de contacto: 
>>> END

#### [PRI-014] Contenido — Quines dades recollim
<!-- id:PRI-014 -->
>>> VA
Quines dades recollim
>>> ES
Qué datos recogemos
>>> END

#### [PRI-015] Contenido — Només les de dos formularis: el de «Fer-se scout» i el de reserva de …
<!-- id:PRI-015 -->
>>> VA
Només les de dos formularis: el de «Fer-se scout» i el de reserva de la botiga. No recollim res més ni per cap altra via.
>>> ES
Solo los de dos formularios: el de «Hacerse scout» y el de reserva de la tienda. No recogemos nada más ni por ninguna otra vía.
>>> END

#### [PRI-016] Contenido — Del formulari de «Fer-se scout»:
<!-- id:PRI-016 -->
>>> VA
Del formulari de «Fer-se scout»:
>>> ES
Del formulario de «Hacerse scout»:
>>> END

#### [PRI-017] Contenido — Del xiquet o xiqueta: nom, cognoms i data de naixement.
<!-- id:PRI-017 -->
>>> VA
Del xiquet o xiqueta: nom, cognoms i data de naixement.
>>> ES
Del niño o niña: nombre, apellidos y fecha de nacimiento.
>>> END

#### [PRI-018] Contenido — La secció que li correspondria, si l'heu indicada.
<!-- id:PRI-018 -->
>>> VA
La secció que li correspondria, si l'heu indicada.
>>> ES
La sección que le correspondería, si la habéis indicado.
>>> END

#### [PRI-019] Contenido — Al·lèrgies, necessitats o qualsevol cosa que ens vulgueu contar en el…
<!-- id:PRI-019 -->
>>> VA
Al·lèrgies, necessitats o qualsevol cosa que ens vulgueu contar en el camp obert. Esta informació pot incloure dades de salut, i per això la tractem amb un cuidado especial.
>>> ES
Alergias, necesidades o cualquier cosa que nos queráis contar en el campo abierto. Esta información puede incluir datos de salud, y por eso la tratamos con un cuidado especial.
>>> END

#### [PRI-020] Contenido — De la mare, pare o tutor/a: nom i cognoms, telèfon i correu electròni…
<!-- id:PRI-020 -->
>>> VA
De la mare, pare o tutor/a: nom i cognoms, telèfon i correu electrònic.
>>> ES
De la madre, padre o tutor/a: nombre y apellidos, teléfono y correo electrónico.
>>> END

#### [PRI-021] Contenido — Com ens heu conegut, si ho voleu contar. És opcional.
<!-- id:PRI-021 -->
>>> VA
Com ens heu conegut, si ho voleu contar. És opcional.
>>> ES
Cómo nos habéis conocido, si lo queréis contar. Es opcional.
>>> END

#### [PRI-022] Contenido — Del formulari de reserva de la botiga:
<!-- id:PRI-022 -->
>>> VA
Del formulari de reserva de la botiga:
>>> ES
Del formulario de reserva de la tienda:
>>> END

#### [PRI-023] Contenido — De qui fa la reserva: nom i cognoms, correu electrònic i, si el voleu…
<!-- id:PRI-023 -->
>>> VA
De qui fa la reserva: nom i cognoms, correu electrònic i, si el voleu deixar, telèfon.
>>> ES
De quien hace la reserva: nombre y apellidos, correo electrónico y, si lo queréis dejar, teléfono.
>>> END

#### [PRI-024] Contenido — Els articles i les unitats que voleu reservar, i el que ens vulgueu d…
<!-- id:PRI-024 -->
>>> VA
Els articles i les unitats que voleu reservar, i el que ens vulgueu dir sobre talles.
>>> ES
Los artículos y las unidades que queréis reservar, y lo que nos queráis decir sobre tallas.
>>> END

#### [PRI-025] Contenido — Ací no es demana cap dada de menors ni cap dada de salut: és una rese…
<!-- id:PRI-025 -->
>>> VA
Ací no es demana cap dada de menors ni cap dada de salut: és una reserva de roba, i el formulari no té cap camp per a això. La botiga tampoc no cobra res per la web, així que no es demana ni es guarda cap dada bancària.
>>> ES
Aquí no se pide ningún dato de menores ni ningún dato de salud: es una reserva de ropa, y el formulario no tiene ningún campo para eso. La tienda tampoco cobra nada por la web, así que no se pide ni se guarda ningún dato bancario.
>>> END

#### [PRI-026] Contenido — A més, quan s'envia qualsevol dels dos formularis el servidor fa serv…
<!-- id:PRI-026 -->
>>> VA
A més, quan s'envia qualsevol dels dos formularis el servidor fa servir l'adreça IP de manera temporal i només en memòria, per a evitar que els robots els inunden amb enviaments automàtics. Eixa adreça no es guarda ni s'associa a l'enviament.
>>> ES
Además, cuando se envía cualquiera de los dos formularios el servidor usa la dirección IP de manera temporal y solo en memoria, para evitar que los robots los inunden con envíos automáticos. Esa dirección no se guarda ni se asocia al envío.
>>> END

#### [PRI-027] Contenido — Per a què les fem servir
<!-- id:PRI-027 -->
>>> VA
Per a què les fem servir
>>> ES
Para qué los usamos
>>> END

#### [PRI-028] Contenido — Per a una cosa i prou:
<!-- id:PRI-028 -->
>>> VA
Per a una cosa i prou:
>>> ES
Para una cosa y nada más:
>>> END

#### [PRI-029] Contenido — Posar-nos en contacte amb la família, resoldre els dubtes que tingueu…
<!-- id:PRI-029 -->
>>> VA
Posar-nos en contacte amb la família, resoldre els dubtes que tingueu i gestionar la sol·licitud de plaça o la llista d'espera.
>>> ES
Ponernos en contacto con la familia, resolver las dudas que tengáis y gestionar la solicitud de plaza o la lista de espera.
>>> END

#### [PRI-030] Contenido — Preparar-vos la reserva de la botiga, confirmar-vos la disponibilitat…
<!-- id:PRI-030 -->
>>> VA
Preparar-vos la reserva de la botiga, confirmar-vos la disponibilitat i quedar per a arreplegar-la. Res més: eixes dades no s'afigen a cap llista d'enviaments.
>>> ES
Prepararos la reserva de la tienda, confirmaros la disponibilidad y quedar para recogerla. Nada más: esos datos no se añaden a ninguna lista de envíos.
>>> END

#### [PRI-031] Contenido — Base legal del tractament:
<!-- id:PRI-031 -->
>>> VA
Base legal del tractament: 
>>> ES
Base legal del tratamiento: 
>>> END

#### [PRI-032] Contenido — Dades de menors d'edat
<!-- id:PRI-032 -->
>>> VA
Dades de menors d'edat
>>> ES
Datos de menores de edad
>>> END

#### [PRI-033] Contenido — Este formulari està pensat per a que l'òmpliga sempre la mare, el par…
<!-- id:PRI-033 -->
>>> VA
Este formulari està pensat per a que l'òmpliga sempre la mare, el pare o el tutor o tutora legal, mai el xiquet o la xiqueta pel seu compte. En enviar-lo confirmeu que teniu la pàtria potestat o la tutela del menor i que autoritzeu que ens posem en contacte amb vosaltres.
>>> ES
Este formulario está pensado para que lo rellene siempre la madre, el padre o el tutor o tutora legal, nunca el niño o la niña por su cuenta. Al enviarlo confirmáis que tenéis la patria potestad o la tutela del menor y que autorizáis que nos pongamos en contacto con vosotros.
>>> END

#### [PRI-034] Contenido — Criteri d'edat aplicat:
<!-- id:PRI-034 -->
>>> VA
Criteri d'edat aplicat: 
>>> ES
Criterio de edad aplicado: 
>>> END

#### [PRI-035] Contenido — La informació sobre al·lèrgies i necessitats només s'utilitza per a l…
<!-- id:PRI-035 -->
>>> VA
La informació sobre al·lèrgies i necessitats només s'utilitza per a la seguretat del xiquet o xiqueta a les activitats. No s'usa per a res més, no es publica mai i no es comparteix fora del grup.
>>> ES
La información sobre alergias y necesidades solo se utiliza para la seguridad del niño o niña en las actividades. No se usa para nada más, no se publica nunca y no se comparte fuera del grupo.
>>> END

#### [PRI-036] Contenido — Dins del grup, hi tenen accés:
<!-- id:PRI-036 -->
>>> VA
Dins del grup, hi tenen accés: 
>>> ES
Dentro del grupo, tienen acceso: 
>>> END

#### [PRI-037] Contenido — Quant de temps les guardem
<!-- id:PRI-037 -->
>>> VA
Quant de temps les guardem
>>> ES
Cuánto tiempo los guardamos
>>> END

#### [PRI-038] Contenido — Els terminis de conservació són:
<!-- id:PRI-038 -->
>>> VA
Els terminis de conservació són:
>>> ES
Los plazos de conservación son:
>>> END

#### [PRI-039] Contenido — Si finalment no us apunteu:
<!-- id:PRI-039 -->
>>> VA
Si finalment no us apunteu: 
>>> ES
Si finalmente no os apuntáis: 
>>> END

#### [PRI-040] Contenido — Si us apunteu:
<!-- id:PRI-040 -->
>>> VA
Si us apunteu: 
>>> ES
Si os apuntáis: 
>>> END

#### [PRI-041] Contenido — Reserves de la botiga:
<!-- id:PRI-041 -->
>>> VA
Reserves de la botiga: 
>>> ES
Reservas de la tienda: 
>>> END

#### [PRI-042] Contenido — Qui més pot veure estes dades
<!-- id:PRI-042 -->
>>> VA
Qui més pot veure estes dades
>>> ES
Quién más puede ver estos datos
>>> END

#### [PRI-043] Contenido — No venem ni cedim les dades a ningú amb finalitats comercials. Per a …
<!-- id:PRI-043 -->
>>> VA
No venem ni cedim les dades a ningú amb finalitats comercials. Per a poder funcionar, però, la web s'apoia en estos serveis:
>>> ES
No vendemos ni cedemos los datos a nadie con fines comerciales. Para poder funcionar, eso sí, la web se apoya en estos servicios:
>>> END

#### [PRI-044] Contenido — Google (Sheets i Apps Script), on es guarden les fitxes de sol·licitu…
<!-- id:PRI-044 -->
>>> VA
Google (Sheets i Apps Script), on es guarden les fitxes de sol·licitud i on s'executa el script que les rep. És una empresa dels Estats Units. 
>>> ES
Google (Sheets y Apps Script), donde se guardan las fichas de solicitud y donde se ejecuta el script que las recibe. Es una empresa de los Estados Unidos. 
>>> END

#### [PRI-045] Contenido — El proveïdor que allotja la web:
<!-- id:PRI-045 -->
>>> VA
El proveïdor que allotja la web: 
>>> ES
El proveedor que aloja la web: 
>>> END

#### [PRI-046] Contenido — Google Fonts, que serveix les tipografies de la web. En carregar qual…
<!-- id:PRI-046 -->
>>> VA
Google Fonts, que serveix les tipografies de la web. En carregar qualsevol pàgina, el navegador demana eixes tipografies a Google i això li fa arribar l'adreça IP. Ho expliquem amb detall a la 
>>> ES
Google Fonts, que sirve las tipografías de la web. Al cargar cualquier página, el navegador pide esas tipografías a Google y eso le hace llegar la dirección IP. Lo explicamos con detalle en la 
>>> END

#### [PRI-047] Contenido — política de cookies
<!-- id:PRI-047 -->
>>> VA
política de cookies
>>> ES
política de cookies
>>> END

#### [PRI-048] Contenido — Google Maps, que s'ofereix a la pàgina de La Cova per a mostrar la ub…
<!-- id:PRI-048 -->
_Nota: Contiene una etiqueta HTML dentro del texto (por ejemplo un enlace o un <strong>): consérvala tal cual, solo reescribe las palabras de dentro y de fuera._
>>> VA
Google Maps, que s'ofereix a la pàgina de La Cova per a mostrar la ubicació. <strong>El mapa NO es carrega automàticament</strong>: cal prémer un botó. Fins que no es prem, no es fa cap petició a Google. Si es prem, Google rep l'adreça IP de qui visita la pàgina. Google és una empresa dels Estats Units.
>>> ES
Google Maps, que se ofrece en la página de La Cueva para mostrar la ubicación. <strong>El mapa NO se carga automáticamente</strong>: hay que pulsar un botón. Hasta que no se pulsa, no se hace ninguna petición a Google. Si se pulsa, Google recibe la dirección IP de quien visita la página. Google es una empresa de los Estados Unidos.
>>> END

#### [PRI-049] Contenido — També podríem haver de comunicar dades si ens ho exigira una obligaci…
<!-- id:PRI-049 -->
>>> VA
També podríem haver de comunicar dades si ens ho exigira una obligació legal.
>>> ES
También podríamos tener que comunicar datos si nos lo exigiera una obligación legal.
>>> END

#### [PRI-050] Contenido — Els teus drets
<!-- id:PRI-050 -->
>>> VA
Els teus drets
>>> ES
Tus derechos
>>> END

#### [PRI-051] Contenido — Sobre les dades del teu fill o filla i sobre les teues, pots exercir …
<!-- id:PRI-051 -->
>>> VA
Sobre les dades del teu fill o filla i sobre les teues, pots exercir en qualsevol moment estos drets:
>>> ES
Sobre los datos de tu hijo o hija y sobre los tuyos, puedes ejercer en cualquier momento estos derechos:
>>> END

#### [PRI-052] Contenido — Accedir a les dades que tenim.
<!-- id:PRI-052 -->
>>> VA
Accedir a les dades que tenim.
>>> ES
Acceder a los datos que tenemos.
>>> END

#### [PRI-053] Contenido — Rectificar el que estiga mal.
<!-- id:PRI-053 -->
>>> VA
Rectificar el que estiga mal.
>>> ES
Rectificar lo que esté mal.
>>> END

#### [PRI-054] Contenido — Demanar que les esborrem.
<!-- id:PRI-054 -->
>>> VA
Demanar que les esborrem.
>>> ES
Pedir que los borremos.
>>> END

#### [PRI-055] Contenido — Oposar-te al tractament o demanar que el limitem.
<!-- id:PRI-055 -->
>>> VA
Oposar-te al tractament o demanar que el limitem.
>>> ES
Oponerte al tratamiento o pedir que lo limitemos.
>>> END

#### [PRI-056] Contenido — Retirar el consentiment que vas donar, sense que això afecte el que j…
<!-- id:PRI-056 -->
>>> VA
Retirar el consentiment que vas donar, sense que això afecte el que ja s'havia fet abans.
>>> ES
Retirar el consentimiento que diste, sin que eso afecte a lo que ya se había hecho antes.
>>> END

#### [PRI-057] Contenido — Per a exercir-los, escriu-nos a
<!-- id:PRI-057 -->
>>> VA
Per a exercir-los, escriu-nos a 
>>> ES
Para ejercerlos, escríbenos a 
>>> END

#### [PRI-058] Contenido — Si consideres que no hem fet les coses bé, pots presentar una reclama…
<!-- id:PRI-058 -->
>>> VA
Si consideres que no hem fet les coses bé, pots presentar una reclamació davant l'Agència Espanyola de Protecció de Dades (
>>> ES
Si consideras que no hemos hecho las cosas bien, puedes presentar una reclamación ante la Agencia Española de Protección de Datos (
>>> END

#### [PRI-059] Contenido — Com protegim estes dades
<!-- id:PRI-059 -->
>>> VA
Com protegim estes dades
>>> ES
Cómo protegemos estos datos
>>> END

#### [PRI-060] Contenido — La web es serveix sempre per connexió xifrada (HTTPS). El formulari e…
<!-- id:PRI-060 -->
>>> VA
La web es serveix sempre per connexió xifrada (HTTPS). El formulari es comprova al servidor i no només al navegador, i les claus d'accés al sistema on es guarden les fitxes no estan mai dins de la pàgina web: viuen només al servidor. Als registres tècnics no s'escriu mai el contingut del que heu omplit.
>>> ES
La web se sirve siempre por conexión cifrada (HTTPS). El formulario se comprueba en el servidor y no solo en el navegador, y las claves de acceso al sistema donde se guardan las fichas no están nunca dentro de la página web: viven solo en el servidor. En los registros técnicos no se escribe nunca el contenido de lo que habéis rellenado.
>>> END

#### [PRI-061] Contenido — Canvis en esta política
<!-- id:PRI-061 -->
>>> VA
Canvis en esta política
>>> ES
Cambios en esta política
>>> END

#### [PRI-062] Contenido — Última actualització:
<!-- id:PRI-062 -->
>>> VA
Última actualització: 
>>> ES
Última actualización: 
>>> END

---

## Cookies — cookies.html

#### [COO-001] Título de pestaña — Política de cookies · Grup Scout Parpalló
<!-- id:COO-001 -->
_Nota: Título de pestaña del navegador (<title>) — solo valenciano en el código actual._
>>> VA
Política de cookies · Grup Scout Parpalló
>>> END

#### [COO-002] Meta description — Què desa esta web al teu navegador: cap cookie pròpia; Instagram, a l…
<!-- id:COO-002 -->
_Nota: Descripción para buscadores (meta description) — solo valenciano en el código actual._
>>> VA
Què desa esta web al teu navegador: cap cookie pròpia; Instagram, a l'inici, és l'única excepció de tercers.
>>> END

#### [COO-003] aria-label — Molla de pa
<!-- id:COO-003 -->
_Nota: Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano._
>>> VA
Molla de pa
>>> END

#### [COO-004] Contenido — Inici
<!-- id:COO-004 -->
>>> VA
Inici
>>> ES
Inicio
>>> END

#### [COO-005] Contenido — Política de cookies
<!-- id:COO-005 -->
>>> VA
Política de cookies
>>> ES
Política de cookies
>>> END

#### [COO-006] Contenido — Política de cookies
<!-- id:COO-006 -->
>>> VA
Política de cookies
>>> ES
Política de cookies
>>> END

#### [COO-007] Contenido — Què desa esta web al teu navegador i què no.
<!-- id:COO-007 -->
>>> VA
Què desa esta web al teu navegador i què no.
>>> ES
Qué guarda esta web en tu navegador y qué no.
>>> END

#### [COO-008] Contenido — Esta pàgina explica què desa esta web al teu navegador. La resposta c…
<!-- id:COO-008 -->
>>> VA
Esta pàgina explica què desa esta web al teu navegador. La resposta curta és: pràcticament res.
>>> ES
Esta página explica qué guarda esta web en tu navegador. La respuesta corta es: prácticamente nada.
>>> END

#### [COO-009] Contenido — Què és una cookie
<!-- id:COO-009 -->
>>> VA
Què és una cookie
>>> ES
Qué es una cookie
>>> END

#### [COO-010] Contenido — Una cookie és un fitxeret que una web deixa al teu navegador per a re…
<!-- id:COO-010 -->
>>> VA
Una cookie és un fitxeret que una web deixa al teu navegador per a recordar alguna cosa entre visites. N'hi ha de tècniques, imprescindibles per a que la web funcione, i n'hi ha d'altres que serveixen per a mesurar el que fas o per a mostrar-te publicitat.
>>> ES
Una cookie es un ficherito que una web deja en tu navegador para recordar algo entre visitas. Las hay técnicas, imprescindibles para que la web funcione, y las hay que sirven para medir lo que haces o para mostrarte publicidad.
>>> END

#### [COO-011] Contenido — Quines cookies fa servir esta web
<!-- id:COO-011 -->
>>> VA
Quines cookies fa servir esta web
>>> ES
Qué cookies usa esta web
>>> END

#### [COO-012] Contenido — Cap de pròpia. Esta web no instal·la cap cookie pròpia ni fa servir c…
<!-- id:COO-012 -->
>>> VA
Cap de pròpia. Esta web no instal·la cap cookie pròpia ni fa servir cap eina d'analítica, de mesura d'audiència ni de publicitat. L'única excepció és Instagram, que expliquem més avall: en carregar-se pot instal·lar les seues pròpies cookies.
>>> ES
Ninguna propia. Esta web no instala ninguna cookie propia ni usa ninguna herramienta de analítica, de medición de audiencia ni de publicidad. La única excepción es Instagram, que explicamos más abajo: al cargarse puede instalar sus propias cookies.
>>> END

#### [COO-013] Contenido — L'única cosa que desem al teu navegador és l'idioma que tries amb el …
<!-- id:COO-013 -->
>>> VA
L'única cosa que desem al teu navegador és l'idioma que tries amb el botó de dalt (valencià o castellà), perquè no l'hages de tornar a triar en cada pàgina. Es guarda amb el nom «parpallo-lang», es queda al teu dispositiu, no viatja a cap servidor i no serveix per a identificar-te.
>>> ES
Lo único que guardamos en tu navegador es el idioma que eliges con el botón de arriba (valenciano o castellano), para que no lo tengas que volver a elegir en cada página. Se guarda con el nombre «parpallo-lang», se queda en tu dispositivo, no viaja a ningún servidor y no sirve para identificarte.
>>> END

#### [COO-014] Contenido — Recursos que es carreguen de fora
<!-- id:COO-014 -->
>>> VA
Recursos que es carreguen de fora
>>> ES
Recursos que se cargan de fuera
>>> END

#### [COO-015] Contenido — Les tipografies d'esta web es carreguen des de Google Fonts. Això vol…
<!-- id:COO-015 -->
>>> VA
Les tipografies d'esta web es carreguen des de Google Fonts. Això vol dir que, en obrir qualsevol pàgina, el teu navegador demana eixos fitxers als servidors de Google i, en fer-ho, li arriba la teua adreça IP. No hi ha cookies pel mig, però és una connexió a un tercer i preferim contar-ho.
>>> ES
Las tipografías de esta web se cargan desde Google Fonts. Eso significa que, al abrir cualquier página, tu navegador pide esos ficheros a los servidores de Google y, al hacerlo, le llega tu dirección IP. No hay cookies de por medio, pero es una conexión a un tercero y preferimos contarlo.
>>> END

#### [COO-016] Contenido — Google Maps a la pàgina de la Cova
<!-- id:COO-016 -->
>>> VA
Google Maps a la pàgina de la Cova
>>> ES
Google Maps en la página de la Cueva
>>> END

#### [COO-017] Contenido — A la pàgina de La Cova hi ha un mapa que enllaça amb Google Maps. <st…
<!-- id:COO-017 -->
_Nota: Contiene una etiqueta HTML dentro del texto (por ejemplo un enlace o un <strong>): consérvala tal cual, solo reescribe las palabras de dentro y de fuera._
>>> VA
A la pàgina de La Cova hi ha un mapa que enllaça amb Google Maps. <strong>Per defecte no es carrega res de Google.</strong> Només quan prems el botó «Mostra el mapa», el mapa es carrega des dels servidors de Google, que en eixe moment reben la teua adreça IP i poden instal·lar cookies pròpies. Fins que no prems, no ix cap petició a Google.
>>> ES
En la página de La Cueva hay un mapa que enlaza con Google Maps. <strong>Por defecto no se carga nada de Google.</strong> Solo cuando pulsas el botón «Mostrar el mapa», el mapa se carga desde los servidores de Google, que en ese momento reciben tu dirección IP y pueden instalar cookies propias. Hasta que no pulsas, no sale ninguna petición a Google.
>>> END

#### [COO-018] Contenido — Google és una empresa dels Estats Units. Al carregar el mapa acceptes…
<!-- id:COO-018 -->
>>> VA
Google és una empresa dels Estats Units. Al carregar el mapa acceptes eixa transferència. Si prefereixes no fer-ho, tens l'adreça i el nom del paratge en text a la mateixa pàgina.
>>> ES
Google es una empresa de los Estados Unidos. Al cargar el mapa aceptas esa transferencia. Si prefieres no hacerlo, tienes la dirección y el nombre del paraje en texto en la misma página.
>>> END

#### [COO-019] Contenido — Instagram a la pàgina d'inici
<!-- id:COO-019 -->
>>> VA
Instagram a la pàgina d'inici
>>> ES
Instagram en la página de inicio
>>> END

#### [COO-020] Contenido — A l'inici mostrem algunes de les nostres publicacions d'Instagram amb…
<!-- id:COO-020 -->
>>> VA
A l'inici mostrem algunes de les nostres publicacions d'Instagram amb el reproductor oficial d'Instagram. Este es carrega sempre en obrir la pàgina d'inici, igual que les tipografies de Google Fonts: el teu navegador demana el contingut als servidors d'Instagram (Meta), que reben la teua adreça IP i poden instal·lar les seues pròpies cookies.
>>> ES
En el inicio mostramos algunas de nuestras publicaciones de Instagram con el reproductor oficial de Instagram. Este se carga siempre al abrir la página de inicio, igual que las tipografías de Google Fonts: tu navegador pide el contenido a los servidores de Instagram (Meta), que reciben tu dirección IP y pueden instalar sus propias cookies.
>>> END

#### [COO-021] Contenido — Instagram (Meta Platforms) és una empresa dels Estats Units. Si prefe…
<!-- id:COO-021 -->
>>> VA
Instagram (Meta Platforms) és una empresa dels Estats Units. Si prefereixes no carregar-ho, pots visitar el nostre perfil directament a 
>>> ES
Instagram (Meta Platforms) es una empresa de los Estados Unidos. Si prefieres no cargarlo, puedes visitar nuestro perfil directamente en 
>>> END

#### [COO-022] Contenido — I el formulari?
<!-- id:COO-022 -->
>>> VA
I el formulari?
>>> ES
¿Y el formulario?
>>> END

#### [COO-023] Contenido — El formulari de sol·licitud de plaça no fa servir cookies. El que hi …
<!-- id:COO-023 -->
>>> VA
El formulari de sol·licitud de plaça no fa servir cookies. El que hi escrius s'envia només quan li dones al botó, i el que passa després s'explica a la 
>>> ES
El formulario de solicitud de plaza no usa cookies. Lo que escribes en él se envía solo cuando le das al botón, y lo que pasa después se explica en la 
>>> END

#### [COO-024] Contenido — política de privacitat
<!-- id:COO-024 -->
>>> VA
política de privacitat
>>> ES
política de privacidad
>>> END

#### [COO-025] Contenido — Com esborrar el que s'ha guardat
<!-- id:COO-025 -->
>>> VA
Com esborrar el que s'ha guardat
>>> ES
Cómo borrar lo que se ha guardado
>>> END

#### [COO-026] Contenido — Pots esborrar l'idioma guardat en qualsevol moment des de les opcions…
<!-- id:COO-026 -->
>>> VA
Pots esborrar l'idioma guardat en qualsevol moment des de les opcions del teu navegador, on diga esborrar dades de navegació o dades de llocs web. Si ho fas, la web tornarà a mostrar-se en valencià, que és l'idioma per defecte.
>>> ES
Puedes borrar el idioma guardado en cualquier momento desde las opciones de tu navegador, donde diga borrar datos de navegación o datos de sitios web. Si lo haces, la web volverá a mostrarse en valenciano, que es el idioma por defecto.
>>> END

#### [COO-027] Contenido — Canvis en esta política
<!-- id:COO-027 -->
>>> VA
Canvis en esta política
>>> ES
Cambios en esta política
>>> END

#### [COO-028] Contenido — Si algun dia afegim alguna eina de mesura o qualsevol cosa que instal…
<!-- id:COO-028 -->
>>> VA
Si algun dia afegim alguna eina de mesura o qualsevol cosa que instal·le cookies, actualitzarem esta pàgina abans d'activar-la. Última actualització: 
>>> ES
Si algún día añadimos alguna herramienta de medición o cualquier cosa que instale cookies, actualizaremos esta página antes de activarla. Última actualización: 
>>> END

---

## Legal — pendiente de datos jurídicos

Estos fragmentos no son redacción de estilo: son datos legales concretos que solo puede decidir
alguien con acceso a la documentación del grupo (NIF, domicilio social, plazos de conservación,
base legal RGPD...). Ver `PRE-LANZAMIENTO.md`, apartado A, antes de rellenarlos.

#### [JUR-001] avis-legal.html — [PENDENT: nom jurídic complet del titular de la web]
<!-- id:JUR-001 -->
>>> VA
[PENDENT: nom jurídic complet del titular de la web]
>>> ES
[PENDIENTE: nombre jurídico completo del titular de la web]
>>> END

#### [JUR-002] avis-legal.html — [PENDENT: NIF del titular]
<!-- id:JUR-002 -->
>>> VA
[PENDENT: NIF del titular]
>>> ES
[PENDIENTE: NIF del titular]
>>> END

#### [JUR-003] avis-legal.html — [PENDENT: domicili a efectes de notificacions]
<!-- id:JUR-003 -->
>>> VA
[PENDENT: domicili a efectes de notificacions]
>>> ES
[PENDIENTE: domicilio a efectos de notificaciones]
>>> END

#### [JUR-004] avis-legal.html — [PENDENT: registre d'associacions i número d'inscripció, si escau]
<!-- id:JUR-004 -->
>>> VA
[PENDENT: registre d'associacions i número d'inscripció, si escau]
>>> ES
[PENDIENTE: registro de asociaciones y número de inscripción, si procede]
>>> END

#### [JUR-005] avis-legal.html — [PENDENT: de qui són els textos i les fotografies i amb quina autorit…
<!-- id:JUR-005 -->
>>> VA
[PENDENT: de qui són els textos i les fotografies i amb quina autorització es publiquen, especialment si hi apareixen menors]
>>> ES
[PENDIENTE: de quién son los textos y las fotografías y con qué autorización se publican, especialmente si aparecen menores]
>>> END

#### [JUR-006] avis-legal.html — [PENDENT: legislació aplicable i jurisdicció competent en cas de conf…
<!-- id:JUR-006 -->
>>> VA
[PENDENT: legislació aplicable i jurisdicció competent en cas de conflicte]
>>> ES
[PENDIENTE: legislación aplicable y jurisdicción competente en caso de conflicto]
>>> END

#### [JUR-007] privacitat.html — [PENDENT: nom jurídic complet de l'entitat responsable]
<!-- id:JUR-007 -->
>>> VA
[PENDENT: nom jurídic complet de l'entitat responsable]
>>> ES
[PENDIENTE: nombre jurídico completo de la entidad responsable]
>>> END

#### [JUR-008] privacitat.html — [PENDENT: NIF de l'entitat]
<!-- id:JUR-008 -->
>>> VA
[PENDENT: NIF de l'entitat]
>>> ES
[PENDIENTE: NIF de la entidad]
>>> END

#### [JUR-009] privacitat.html — [PENDENT: domicili social a efectes de notificacions]
<!-- id:JUR-009 -->
>>> VA
[PENDENT: domicili social a efectes de notificacions]
>>> ES
[PENDIENTE: domicilio social a efectos de notificaciones]
>>> END

#### [JUR-010] privacitat.html — [PENDENT: base legal aplicable segons l'art. 6 del RGPD per a cada un…
<!-- id:JUR-010 -->
>>> VA
[PENDENT: base legal aplicable segons l'art. 6 del RGPD per a cada un dels dos formularis i, per a les dades de salut de la sol·licitud de plaça, l'excepció aplicable de l'art. 9]
>>> ES
[PENDIENTE: base legal aplicable según el art. 6 del RGPD para cada uno de los dos formularios y, para los datos de salud de la solicitud de plaza, la excepción aplicable del art. 9]
>>> END

#### [JUR-011] privacitat.html — [PENDENT: edat mínima i criteri de consentiment aplicable als menors]
<!-- id:JUR-011 -->
>>> VA
[PENDENT: edat mínima i criteri de consentiment aplicable als menors]
>>> ES
[PENDIENTE: edad mínima y criterio de consentimiento aplicable a los menores]
>>> END

#### [JUR-012] privacitat.html — [PENDENT: quines persones del grup tenen accés a les fitxes i com es …
<!-- id:JUR-012 -->
>>> VA
[PENDENT: quines persones del grup tenen accés a les fitxes i com es controla eixe accés]
>>> ES
[PENDIENTE: qué personas del grupo tienen acceso a las fichas y cómo se controla ese acceso]
>>> END

#### [JUR-013] privacitat.html — [PENDENT: termini de conservació d'una sol·licitud que no acaba en al…
<!-- id:JUR-013 -->
>>> VA
[PENDENT: termini de conservació d'una sol·licitud que no acaba en alta]
>>> ES
[PENDIENTE: plazo de conservación de una solicitud que no acaba en alta]
>>> END

#### [JUR-014] privacitat.html — [PENDENT: termini de conservació de les dades una vegada la persona é…
<!-- id:JUR-014 -->
>>> VA
[PENDENT: termini de conservació de les dades una vegada la persona és membre del grup]
>>> ES
[PENDIENTE: plazo de conservación de los datos una vez la persona es miembro del grupo]
>>> END

#### [JUR-015] privacitat.html — [PENDENT: termini de conservació d'una reserva, ja s'arreplegue o no]
<!-- id:JUR-015 -->
>>> VA
[PENDENT: termini de conservació d'una reserva, ja s'arreplegue o no]
>>> ES
[PENDIENTE: plazo de conservación de una reserva, se recoja o no]
>>> END

#### [JUR-016] privacitat.html — [PENDENT: confirmar el contracte d'encarregat del tractament amb Goog…
<!-- id:JUR-016 -->
>>> VA
[PENDENT: confirmar el contracte d'encarregat del tractament amb Google (Workspace) i les garanties de transferència internacional]
>>> ES
[PENDIENTE: confirmar el contrato de encargado del tratamiento con Google (Workspace) y las garantías de transferencia internacional]
>>> END

#### [JUR-017] privacitat.html — [PENDENT: proveïdor de hosting, quan estiga decidit, i el seu contrac…
<!-- id:JUR-017 -->
>>> VA
[PENDENT: proveïdor de hosting, quan estiga decidit, i el seu contracte d'encarregat]
>>> ES
[PENDIENTE: proveedor de hosting, cuando esté decidido, y su contrato de encargado]
>>> END

#### [JUR-018] privacitat.html — [PENDENT: termini de resposta i procediment intern per a atendre este…
<!-- id:JUR-018 -->
>>> VA
[PENDENT: termini de resposta i procediment intern per a atendre estes sol·licituds]
>>> ES
[PENDIENTE: plazo de respuesta y procedimiento interno para atender estas solicitudes]
>>> END

#### [JUR-019] privacitat.html — [PENDENT: data de publicació d'esta versió]
<!-- id:JUR-019 -->
>>> VA
[PENDENT: data de publicació d'esta versió]
>>> ES
[PENDIENTE: fecha de publicación de esta versión]
>>> END

#### [JUR-020] cookies.html — [PENDENT: decidir si es mantenen les tipografies a Google Fonts o s'a…
<!-- id:JUR-020 -->
>>> VA
[PENDENT: decidir si es mantenen les tipografies a Google Fonts o s'allotgen al propi servidor per a evitar eixa connexió]
>>> ES
[PENDIENTE: decidir si se mantienen las tipografías en Google Fonts o se alojan en el propio servidor para evitar esa conexión]
>>> END

#### [JUR-021] cookies.html — [PENDENT: data de publicació d'esta versió]
<!-- id:JUR-021 -->
>>> VA
[PENDENT: data de publicació d'esta versió]
>>> ES
[PENDIENTE: fecha de publicación de esta versión]
>>> END

---

## Sistema (mensajes del formulario "Fer-se scout")

Textos que ve la familia al enviar el formulario: estado de envío, errores de validación y
mensajes del servidor. Viven en JavaScript, no en HTML, pero los reescribe `apply-text.js` igual.

#### [SYS-001] form.js · enviant — Enviant…
<!-- id:SYS-001 -->
>>> VA
Enviant…
>>> ES
Enviando…
>>> END

#### [SYS-002] form.js · xarxa — No hem pogut connectar. Comprova la connexió i torna a provar; les te…
<!-- id:SYS-002 -->
>>> VA
No hem pogut connectar. Comprova la connexió i torna a provar; les teues dades segueixen ací.
>>> ES
No hemos podido conectar. Comprueba la conexión e inténtalo de nuevo; tus datos siguen aquí.
>>> END

#### [SYS-003] api/_lib/validate.js · nom — Falta el nom del xiquet o xiqueta.
<!-- id:SYS-003 -->
>>> VA
Falta el nom del xiquet o xiqueta.
>>> ES
Falta el nombre del niño o niña.
>>> END

#### [SYS-004] api/_lib/validate.js · cognoms — Falten els cognoms.
<!-- id:SYS-004 -->
>>> VA
Falten els cognoms.
>>> ES
Faltan los apellidos.
>>> END

#### [SYS-005] api/_lib/validate.js · naixement — La data de naixement no és vàlida.
<!-- id:SYS-005 -->
>>> VA
La data de naixement no és vàlida.
>>> ES
La fecha de nacimiento no es válida.
>>> END

#### [SYS-006] api/_lib/validate.js · seccio — Eixa secció no existix.
<!-- id:SYS-006 -->
>>> VA
Eixa secció no existix.
>>> ES
Esa sección no existe.
>>> END

#### [SYS-007] api/_lib/validate.js · notes — El text és massa llarg.
<!-- id:SYS-007 -->
>>> VA
El text és massa llarg.
>>> ES
El texto es demasiado largo.
>>> END

#### [SYS-008] api/_lib/validate.js · tutor — Falta el nom de la mare, pare o tutor/a.
<!-- id:SYS-008 -->
>>> VA
Falta el nom de la mare, pare o tutor/a.
>>> ES
Falta el nombre de la madre, padre o tutor/a.
>>> END

#### [SYS-009] api/_lib/validate.js · telefon — El telèfon no és vàlid.
<!-- id:SYS-009 -->
>>> VA
El telèfon no és vàlid.
>>> ES
El teléfono no es válido.
>>> END

#### [SYS-010] api/_lib/validate.js · email — L'email no és vàlid.
<!-- id:SYS-010 -->
>>> VA
L'email no és vàlid.
>>> ES
El email no es válido.
>>> END

#### [SYS-011] api/_lib/validate.js · conegut — El text és massa llarg.
<!-- id:SYS-011 -->
>>> VA
El text és massa llarg.
>>> ES
El texto es demasiado largo.
>>> END

#### [SYS-012] api/_lib/validate.js · dades — Cal acceptar la política de protecció de dades.
<!-- id:SYS-012 -->
>>> VA
Cal acceptar la política de protecció de dades.
>>> ES
Hay que aceptar la política de protección de datos.
>>> END

#### [SYS-013] api/_lib/validate.js · contacte — Cal acceptar que us contactem.
<!-- id:SYS-013 -->
>>> VA
Cal acceptar que us contactem.
>>> ES
Hay que aceptar que os contactemos.
>>> END

#### [SYS-014] api/_lib/handler.js · ok — Rebut! Ens posarem en contacte amb tu per a parlar-ho amb calma.
<!-- id:SYS-014 -->
>>> VA
Rebut! Ens posarem en contacte amb tu per a parlar-ho amb calma.
>>> ES
¡Recibido! Nos pondremos en contacto contigo para hablarlo con calma.
>>> END

#### [SYS-015] api/_lib/handler.js · invalid — Revisa les dades marcades i torna a provar.
<!-- id:SYS-015 -->
>>> VA
Revisa les dades marcades i torna a provar.
>>> ES
Revisa los datos marcados e inténtalo de nuevo.
>>> END

#### [SYS-016] api/_lib/handler.js · rate — Has enviat massa sol·licituds seguides. Prova d'ací a una estona o es…
<!-- id:SYS-016 -->
>>> VA
Has enviat massa sol·licituds seguides. Prova d'ací a una estona o escriu-nos per correu.
>>> ES
Has enviado demasiadas solicitudes seguidas. Inténtalo dentro de un rato o escríbenos por correo.
>>> END

#### [SYS-017] api/_lib/handler.js · server — No hem pogut registrar la sol·licitud. Les teues dades segueixen ací:…
<!-- id:SYS-017 -->
>>> VA
No hem pogut registrar la sol·licitud. Les teues dades segueixen ací: torna a provar o escriu-nos a gsparpallo@scoutsvalencians.org.
>>> ES
No hemos podido registrar la solicitud. Tus datos siguen aquí: inténtalo de nuevo o escríbenos a gsparpallo@scoutsvalencians.org.
>>> END

#### [SYS-018] api/_lib/handler.js · method — Mètode no permès.
<!-- id:SYS-018 -->
>>> VA
Mètode no permès.
>>> ES
Método no permitido.
>>> END

#### [SYS-019] api/_lib/handler.js · enlace de vuelta (página sin JS) — Tornar / Volver
<!-- id:SYS-019 -->
_Nota: Este texto mezcla los dos idiomas en una sola cadena ("Tornar / Volver"); no lo separes en dos líneas._
>>> VA
Tornar / Volver
>>> END

#### [SYS-020] merch.js · enviant — Enviant…
<!-- id:SYS-020 -->
>>> VA
Enviant…
>>> ES
Enviando…
>>> END

#### [SYS-021] merch.js · xarxa — No hem pogut connectar. Comprova la connexió i torna a provar; el que…
<!-- id:SYS-021 -->
>>> VA
No hem pogut connectar. Comprova la connexió i torna a provar; el que has triat segueix ací.
>>> ES
No hemos podido conectar. Comprueba la conexión e inténtalo de nuevo; lo que has elegido sigue aquí.
>>> END

#### [SYS-022] merch.js · buit — Encara no has triat res.
<!-- id:SYS-022 -->
>>> VA
Encara no has triat res.
>>> ES
Todavía no has elegido nada.
>>> END

#### [SYS-023] merch.js · article — article
<!-- id:SYS-023 -->
>>> VA
article
>>> ES
artículo
>>> END

#### [SYS-024] merch.js · articles — articles
<!-- id:SYS-024 -->
>>> VA
articles
>>> ES
artículos
>>> END

#### [SYS-025] api/_lib/reserva.js · nom — Falta el teu nom.
<!-- id:SYS-025 -->
>>> VA
Falta el teu nom.
>>> ES
Falta tu nombre.
>>> END

#### [SYS-026] api/_lib/reserva.js · cognoms — Falten els cognoms.
<!-- id:SYS-026 -->
>>> VA
Falten els cognoms.
>>> ES
Faltan los apellidos.
>>> END

#### [SYS-027] api/_lib/reserva.js · telefon — El telèfon no és vàlid.
<!-- id:SYS-027 -->
>>> VA
El telèfon no és vàlid.
>>> ES
El teléfono no es válido.
>>> END

#### [SYS-028] api/_lib/reserva.js · email — L'email no és vàlid.
<!-- id:SYS-028 -->
>>> VA
L'email no és vàlid.
>>> ES
El email no es válido.
>>> END

#### [SYS-029] api/_lib/reserva.js · notes — El text és massa llarg.
<!-- id:SYS-029 -->
>>> VA
El text és massa llarg.
>>> ES
El texto es demasiado largo.
>>> END

#### [SYS-030] api/_lib/reserva.js · articles — Tria almenys un article abans d'enviar la reserva.
<!-- id:SYS-030 -->
>>> VA
Tria almenys un article abans d'enviar la reserva.
>>> ES
Elige al menos un artículo antes de enviar la reserva.
>>> END

#### [SYS-031] api/_lib/reserva.js · articlesInvalids — Hi ha algun article que no és de la botiga. Torna a provar.
<!-- id:SYS-031 -->
>>> VA
Hi ha algun article que no és de la botiga. Torna a provar.
>>> ES
Hay algún artículo que no es de la tienda. Inténtalo de nuevo.
>>> END

#### [SYS-032] api/_lib/reserva.js · dades — Cal acceptar la política de protecció de dades.
<!-- id:SYS-032 -->
>>> VA
Cal acceptar la política de protecció de dades.
>>> ES
Hay que aceptar la política de protección de datos.
>>> END

#### [SYS-033] api/_lib/handler-reserva.js · ok — Reserva rebuda! Et confirmarem la disponibilitat i quedem un dissabte…
<!-- id:SYS-033 -->
>>> VA
Reserva rebuda! Et confirmarem la disponibilitat i quedem un dissabte per a arreplegar-ho.
>>> ES
¡Reserva recibida! Te confirmaremos la disponibilidad y quedamos un sábado para recogerlo.
>>> END

#### [SYS-034] api/_lib/handler-reserva.js · invalid — Revisa les dades marcades i torna a provar.
<!-- id:SYS-034 -->
>>> VA
Revisa les dades marcades i torna a provar.
>>> ES
Revisa los datos marcados e inténtalo de nuevo.
>>> END

#### [SYS-035] api/_lib/handler-reserva.js · rate — Has enviat massa reserves seguides. Prova d'ací a una estona o escriu…
<!-- id:SYS-035 -->
>>> VA
Has enviat massa reserves seguides. Prova d'ací a una estona o escriu-nos per correu.
>>> ES
Has enviado demasiadas reservas seguidas. Inténtalo dentro de un rato o escríbenos por correo.
>>> END

#### [SYS-036] api/_lib/handler-reserva.js · server — No hem pogut registrar la reserva. Torna a provar o escriu-nos a gspa…
<!-- id:SYS-036 -->
>>> VA
No hem pogut registrar la reserva. Torna a provar o escriu-nos a gsparpallo@scoutsvalencians.org.
>>> ES
No hemos podido registrar la reserva. Inténtalo de nuevo o escríbenos a gsparpallo@scoutsvalencians.org.
>>> END

#### [SYS-037] api/_lib/handler-reserva.js · method — Mètode no permès.
<!-- id:SYS-037 -->
>>> VA
Mètode no permès.
>>> ES
Método no permitido.
>>> END
