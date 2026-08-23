# Checklist antes de publicar — Web Grup Scout Parpalló

Todo lo que sigue es trabajo tuyo, no mío: son decisiones legales, credenciales
o comprobaciones que solo puede hacer alguien con acceso a las cuentas del grupo.

Marca las casillas a medida que las vayas cerrando.

---

## A. Bloqueante: antes de recoger un solo dato real de una familia

El formulario ya funciona técnicamente. **No lo pongas en producción hasta
cerrar este apartado entero.** Recoge nombre, fecha de nacimiento y alergias de
un menor: hasta que no esté esto resuelto, no hay base legal para guardarlo.

- [ ] **Responsable del tratamiento.** Decidir si es el Grup Scout Parpalló como
      asociación propia o la federación (Scouts Valencians / ASDE). De esto
      depende todo lo demás.
- [ ] **Datos identificativos:** denominación jurídica exacta, NIF, domicilio y,
      si procede, número de registro de asociaciones.
- [ ] Rellenar esos datos en los `[PENDENT]` de `privacitat.html` y `avis-legal.html`.
- [ ] **Base legal (art. 6 RGPD)** para los datos de contacto y la solicitud.
- [ ] **Base legal y plazo de conservación de las reservas de la tienda**
      (`merchandising.html` → `/api/reserva`). Son datos de adultos y sin datos
      de salud, así que es mucho más simple que la solicitud de plaza, pero
      sigue siendo un tratamiento con su propia finalidad. Los `[PENDENT]`
      correspondientes ya están puestos en `privacitat.html`.
- [ ] **Base legal específica (art. 9 RGPD)** para el campo de alergias y
      necesidades. Son datos de salud: no basta el consentimiento genérico.
- [ ] **Plazo de conservación** si la familia no se apunta, y si se apunta. Un
      plazo concreto, y alguien encargado de borrar lo que caduque.
- [ ] **Quién accede** a las fichas dentro del grupo y cómo se controla.
- [ ] **Criterio de edad** y confirmación de que lo rellena siempre el tutor legal.
- [ ] **DPA de Google (Workspace) firmado/aceptado** y revisadas las garantías
      de transferencia internacional (Google es una empresa de EE. UU., y ahí
      se guardan la Google Sheet y las ejecuciones de Apps Script).
- [ ] **DPA del proveedor de hosting** que elijas.
- [ ] **Procedimiento** para atender una petición de acceso, rectificación o
      borrado: quién la recibe y en cuánto tiempo se contesta.
- [ ] Poner la **fecha de publicación** en las tres páginas legales.
- [ ] **Revisar las tres páginas legales con alguien que entienda de protección
      de datos.** Yo he montado la estructura, no he redactado el contenido legal.

---

## B. Infraestructura

- [ ] **Crear la Google Sheet** donde van a aparecer las solicitudes (una hoja
      en blanco basta: el Apps Script crea la cabecera la primera vez). El
      mismo script crea también, solo, una segunda pestaña «Reserves botiga»
      la primera vez que llegue una reserva: no hay que preparar nada más.
      Si ya tenías el script pegado de antes, vuelve a pegarlo y **redespliega
      la MISMA URL** (Desplegar → Gestionar despliegues → editar → Nueva
      versión), o las reservas se escribirán en la pestaña de solicitudes.
- [ ] **Pegar el script `scripts/google-apps-script.gs`** en Extensions → Apps
      Script de esa Sheet, siguiendo los pasos del propio comentario del archivo.
- [ ] **Añadir la propiedad `SHARED_SECRET`** en Configuración del proyecto →
      Propiedades del script, con una cadena larga y aleatoria (32+ caracteres).
- [ ] **Desplegar como Aplicación web** (Ejecutar como: tú, Acceso: cualquiera)
      y **guardar la URL** que Google devuelve.
- [ ] **Elegir hosting** (Vercel, Netlify o Cloudflare). El código ya funciona en
      los tres sin cambios.
- [ ] **Configurar las variables de entorno en el panel del hosting real**, no
      solo en tu `.env` local: `SHEETS_WEBHOOK_URL` (la URL del paso anterior),
      `SHEETS_SHARED_SECRET` (el mismo valor que `SHARED_SECRET`) y `ALLOWED_ORIGIN`.
- [ ] **Dominio definitivo** contratado y apuntando al hosting.
- [ ] **HTTPS activo** y redirección de HTTP a HTTPS encendida.
- [ ] Poner el dominio real en `ALLOWED_ORIGIN`.
- [ ] Sustituir `EL-TEU-DOMINI` por el dominio real en **`robots.txt`** y en
      **`sitemap.xml`** (si no, el sitemap no sirve de nada).
- [ ] Añadir `"url"` y `"logo"` al bloque de datos estructurados de `index.html`
      cuando haya dominio.
- [ ] Cuando el sitio lleve unos días estable, **descomentar la línea de HSTS**
      en `_headers`.

---

## C. Pruebas que solo puedes hacer tú

- [ ] **Un envío real de principio a fin** desde el sitio ya publicado, y
      comprobar que la fila aparece en la Google Sheet con todos los campos bien.
- [ ] Borrar esa fila de prueba de la Sheet.
- [ ] Probar el formulario **con JavaScript desactivado** (debe enviarse igual y
      mostrar una página de confirmación).
- [ ] Probar en **móvil real**, no solo en el navegador del ordenador.
- [ ] Pasar el dominio por <https://securityheaders.com> y comprobar que las
      cabeceras llegan de verdad.
- [ ] Comprobar que `https://tudominio/api/alta` con un GET responde 405 y no
      enseña nada raro. Lo mismo con `https://tudominio/api/reserva`.
- [ ] **Una reserva real de principio a fin** desde la tienda publicada, y
      comprobar que aparece en la pestaña «Reserves botiga» con los artículos,
      las unidades y el total bien. Borrar después la fila de prueba.
- [ ] Probar también la tienda **con JavaScript desactivado**: sin JS no hay
      barra de total ni suma en vivo (es a propósito), pero elegir unidades y
      enviar debe seguir funcionando y llegar la fila igual.
- [ ] **Revisar los precios** de `api/_lib/productes.js` antes de publicar: se
      han copiado tal cual de la web antigua y puede que alguno esté
      desactualizado (la pañoleta a 1 € llama la atención). Los precios se
      cambian **solo ahí**; `npm test` avisa si la página deja de coincidir.

---

## D. Decisiones que te he dejado abiertas a propósito

No las he tocado porque cambian cosas que dijiste que no se tocan, o porque son
tuyas.

- [ ] **Imágenes en WebP.** `cierva.png` pasaría de 77 KB a 27 KB y
      `cierva-parche.png` de 25 KB a 14 KB, sin pérdida de calidad. No lo he
      hecho porque `cierva.png` es la máscara del logotipo en `styles.css` y
      habría que tocar 5 líneas de CSS existente. Dime y lo hago.
- [ ] **Google Fonts.** Las tipografías se cargan desde Google, lo que le manda
      la IP de cada visitante. Alojarlas en el propio servidor lo elimina de
      raíz y simplifica la política de cookies. Implica tocar el `<head>` de
      todas las páginas.
- [ ] **Enlace "Cookies" en el pie.** `index.html` y `cova.html` ya lo tenían;
      se lo he añadido a las otras cinco páginas para que las tres páginas
      legales sean accesibles desde cualquier sitio. Si prefieres que no esté,
      se quita en un minuto.
- [ ] **El `onerror` inline de `index.html`.** La CSP lo desactiva. Es inofensivo
      (imagen decorativa con `alt=""`), pero si quieres que funcione hay que
      mover esa línea a `script.js`.
- [ ] **Arquitectura de idiomas (SEO).** Sigue igual: los dos idiomas en el mismo
      HTML. Las opciones están explicadas más abajo.
- [ ] **Analítica.** No he añadido ninguna. Si algún día quieres, hay que
      actualizar `cookies.html` **antes** de activarla.
- [ ] **Instagram incrustado en `#noticies`.** Usa el reproductor oficial de
      Instagram (`embed.js`), sin token ni cuenta de desarrollador — pero se
      carga siempre, no tras un botón, y sí puede instalar cookies de
      terceros. Ya está explicado en `cookies.html`, pero falta confirmar con
      quien lleve lo legal si hace falta banner de consentimiento antes de
      publicar (ver el comentario al principio de `cookies.html`).
      Las 3 tarjetas de ejemplo apuntan al perfil, no a publicaciones reales:
      sustitúyelas por enlaces `/p/CODI/` reales cuando toque (instrucciones
      en el comentario junto a `<div class="ig-grid">` en `index.html`).

---

## E. Lo que sigue bloqueado a propósito

Estos enlaces siguen sin destino y siguen bloqueados con `data-pend`. Cuando
tengas la URL real, se cambian uno a uno:

- [ ] Instagram (en el pie de todas las páginas)
- [ ] Facebook (en el pie de todas las páginas)
- [ ] "Memòries del grup (PDF)" (en `index.html`)

Y todo el contenido marcado con `pend` o "per confirmar" sigue tal cual: eso lo
redactáis vosotros.

---

## Anexo: las opciones del bilingüismo para SEO

Ahora mismo el valenciano y el castellano están en el mismo HTML, ocultos por
CSS con `.va` / `.es`. Para un buscador eso es **una sola URL con el texto
duplicado en dos idiomas**, y no puede ofrecer la versión castellana a quien
busca en castellano. Estas son las salidas, de menos a más trabajo:

**1. Dejarlo como está.** Cero trabajo. Google indexará la página, pero mezclada.
Para un grupo scout local, cuyo tráfico vendrá sobre todo de búsquedas de marca
("scouts Gandia", "grup scout parpalló") y del boca a boca, el coste real es
bajo. Es una opción perfectamente defendible.

**2. Solo `hreflang`.** No arregla el problema de fondo: `hreflang` sirve para
relacionar URLs distintas por idioma, y aquí solo hay una. Sin separar las URLs
no aporta nada. **No la recomiendo.**

**3. URLs separadas por idioma** (`/va/index.html` y `/es/index.html`), cada una
con un solo idioma en el HTML, enlazadas entre sí con `hreflang`. Es lo correcto
de cara a buscadores y además cada página pesaría la mitad. Pero es un cambio
grande: duplicar las diez páginas, cambiar el toggle de idioma para que navegue
en vez de mostrar y ocultar, rehacer todos los enlaces internos y montar
redirecciones. Es rehacer la arquitectura del sitio.

**Mi recomendación:** quedarse en la opción 1 hasta que el contenido definitivo
esté escrito y el sitio publicado. Rehacer la arquitectura de idiomas sobre
textos que todavía van a cambiar es trabajo tirado. Si más adelante veis que la
gente no os encuentra buscando en castellano, entonces se hace la opción 3 con
el contenido ya cerrado.
