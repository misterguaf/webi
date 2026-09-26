# Checklist antes de publicar — Web Grup Scout Parpalló

La plataforma objetivo de la nueva infraestructura es la definida en
[ADR-001](adr/ADR-001-cloudflare-first-eu.md). Las tareas de Sheets/Drive que
aparecen en esta lista describen solo alta, reserva y cuota anual legacy.
Las actividades nuevas usan `portal/` + servicios 3A + D1 + storage abstraction;
no crean filas ni justificantes en Sheets/Drive.

Todo lo que sigue es trabajo tuyo, no mío: son decisiones legales, credenciales
o comprobaciones que solo puede hacer alguien con acceso a las cuentas del grupo.

Marca las casillas a medida que las vayas cerrando.

---

## A. Bloqueante: antes de recoger un solo dato real de una familia

> Este apartado está desarrollado, decisión por decisión y en lenguaje llano,
> en **`../../Documentos jurídicos/DECISIONS-LEGALS.md`**. Ese documento es el que hay que llevar a la
> reunión del grupo; esta lista es solo el resumen para ir tachando.

El formulario ya funciona técnicamente. **No lo pongas en producción hasta
cerrar este apartado entero.** Recoge nombre y fecha de nacimiento de un menor,
además del contacto del tutor; la lista de espera no admite datos de salud.

- [ ] **Responsable del tratamiento.** Decidir si es el Grup Scout Parpalló como
      asociación propia o la federación (Scouts Valencians / ASDE). De esto
      depende todo lo demás.
- [ ] **Datos identificativos:** denominación jurídica exacta, NIF, domicilio y,
      si procede, número de registro de asociaciones.
- [ ] Rellenar esos datos en los `[PENDENT]` de `site/privacitat.html` y `site/avis-legal.html`.
- [ ] **Base legal (art. 6 RGPD)** para los datos de contacto y la solicitud.
- [ ] **Base legal y plazo de conservación de las reservas de la tienda**
      (`site/merchandising.html` → `/api/reserva`). Son datos de adultos y
      siguen siendo un tratamiento con su propia finalidad. Los `[PENDENT]`
      correspondientes ya están puestos en `site/privacitat.html`.
- [ ] Si se plantea un **canal sanitario separado**, decidir antes su necesidad,
      base jurídica del art. 9, campos mínimos, accesos y conservación. No está
      habilitado en la lista de espera.
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
      mismo script crea también las pestañas «Reserves botiga» y «Cuotas»
      cuando llegan esos tipos.
- [ ] **Carpeta privada separada para cuotas** y propiedad
      `DRIVE_FOLDER_CUOTES_ID`. Crear además la Sheet de solo lectura para
      responsables y configurar su ID como `STATUS_SPREADSHEET_ID`.
- [ ] **Pegar el script `scripts/google-apps-script.gs`** en Extensions → Apps
      Script de esa Sheet para los flujos legacy. Configura
      `DRIVE_FOLDER_CUOTES_ID`, `STATUS_SPREADSHEET_ID` y
      `WEBHOOK_HMAC_SECRET`; revisa también `REMITENT_NOM` y `CORREU_CONTACTE`.
      El script debe rechazar `inscripcio` de actividades.
- [ ] **Añadir la propiedad `WEBHOOK_HMAC_SECRET`** en Configuración del proyecto →
      Propiedades del script, con una cadena larga y aleatoria (32+ caracteres).
- [ ] **Desplegar como Aplicación web** (Ejecutar como: tú, Acceso: cualquiera),
      autorizar Sheets, Drive y Gmail, y **guardar la URL** que Google devuelve.
- [ ] **Publicar en Cloudflare Pages + Worker**, asociando el Worker a la ruta
      `/api/*` del dominio. Seguir `docs/CLOUDFLARE-SEGURIDAD.md`.
- [ ] **Autorización explícita de provisioning** registrada antes de crear
      D1, R2, Access o widgets Turnstile remotos.
- [ ] **Crear D1 con `--jurisdiction=eu`**, nunca solo con
      `--location=weur`, y comprobar en dashboard/API que el metadato remoto
      devuelve jurisdicción `eu`.
- [ ] **Crear cada R2 personal/documental con `--jurisdiction=eu`**,
      mantenerlo privado y declarar `jurisdiction = "eu"` en el binding.
- [ ] **Integrar Turnstile completo**, con secret exclusivo del Worker y
      validación Siteverify server-side de success, hostname y action. Probar
      token inválido, caducado y reutilizado.
- [ ] **Configurar Cloudflare Access delante de `gestio`** y verificar el JWT
      también en backend; Access no sustituye permisos por recurso.
- [ ] **Configurar métricas y alertas del free tier** para Workers, D1, R2,
      Access y Turnstile, y probar el comportamiento fail-closed al agotar cuota.
- [ ] **Desplegar el segundo Worker desde `portal/`** y asociarlo únicamente a
      `inscripciones.grupscoutparpallo.com`. Cargar sus cuatro secretos y no
      publicar la dirección en la web pública.
- [ ] **Configurar las variables de entorno en el panel del hosting real**, no
      solo en tu `.env` local: `SHEETS_WEBHOOK_URL` (la URL del paso anterior),
      `SHEETS_SHARED_SECRET` (el mismo valor que `WEBHOOK_HMAC_SECRET`) y
      `ALLOWED_ORIGIN` con el dominio HTTPS definitivo.
- [ ] **Dominio definitivo** contratado y apuntando al hosting.
- [ ] **HTTPS activo** y redirección de HTTP a HTTPS encendida.
- [ ] Poner el dominio real en `ALLOWED_ORIGIN`.
- [ ] Sustituir `EL-TEU-DOMINI` por el dominio real en **`site/robots.txt`**, en
      **`site/sitemap.xml`**, **`site/.well-known/security.txt`** y en las **etiquetas `og:` de las 11 páginas** (si no, el
      sitemap no sirve de nada y al compartir el enlace no saldrá la foto).
      Para hacerlo de una vez:
      Ejecuta la sustitución solo dentro de `site/` y revisa el resultado antes de publicar.
- [ ] Comprobar la previsualización con el **depurador de Facebook**
      (developers.facebook.com/tools/debug) y compartiendo el enlace **contigo
      mismo por WhatsApp**. WhatsApp cachea con fuerza: si te sale mal la
      primera vez, dale a "Scrape Again" en el depurador antes de repetir.
- [ ] Decidir si la foto de `site/assets/img/og-parpallo.jpg` es la que queréis que
      aparezca **cada vez que alguien comparta cualquier página**. Es fácil de
      cambiar: misma ruta, 1200×630 px.
- [ ] Añadir `"url"` y `"logo"` al bloque de datos estructurados de `site/index.html`
      cuando haya dominio.
- [ ] Resolver **PRODUCTION_BLOCKER HSTS**: `site/_headers` y `vercel.json`
      incluyen `includeSubDomains`; verificar HTTPS/certificados para `portal`,
      `gestio` y demás subdominios o decidir explícitamente otro alcance.

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
      enseña nada raro. Lo mismo con `https://tudominio/api/reserva`; el antiguo
      `https://tudominio/api/inscripcio` debe responder 404.
- [ ] **Una inscripción de actividad sintética** en un despliegue de pruebas
      independiente: comprobar D1, storage y outbox sin filas nuevas de
      actividades en Sheets ni ficheros en Drive. Pendiente de autorización
      de infraestructura remota.
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
      hecho porque `cierva.png` es la máscara del logotipo en `site/assets/css/styles.css` y
      habría que tocar 5 líneas de CSS existente. Dime y lo hago.
- [ ] **Google Fonts.** Las tipografías se cargan desde Google, lo que le manda
      la IP de cada visitante. Alojarlas en el propio servidor lo elimina de
      raíz y simplifica la política de cookies. Implica tocar el `<head>` de
      todas las páginas.
- [ ] **Enlace "Cookies" en el pie.** `site/index.html` y `site/cova.html` ya lo tenían;
      se lo he añadido a las otras cinco páginas para que las tres páginas
      legales sean accesibles desde cualquier sitio. Si prefieres que no esté,
      se quita en un minuto.
- [ ] **El `onerror` inline de `site/index.html`.** La CSP lo desactiva. Es inofensivo
      (imagen decorativa con `alt=""`), pero si quieres que funcione hay que
      mover esa línea a `site/assets/js/script.js`.
- [ ] **Arquitectura de idiomas (SEO).** Sigue igual: los dos idiomas en el mismo
      HTML. Las opciones están explicadas más abajo.
- [ ] **Analítica.** No he añadido ninguna. Si algún día quieres, hay que
      actualizar `site/cookies.html` **antes** de activarla.
- [ ] **Instagram incrustado en `#noticies`.** Usa el reproductor oficial de
      Instagram (`embed.js`), sin token ni cuenta de desarrollador — pero se
      carga siempre, no tras un botón, y sí puede instalar cookies de
      terceros. Ya está explicado en `site/cookies.html`, pero falta confirmar con
      quien lleve lo legal si hace falta banner de consentimiento antes de
      publicar (ver el comentario al principio de `site/cookies.html`).
      Las 3 tarjetas de ejemplo apuntan al perfil, no a publicaciones reales:
      sustitúyelas por enlaces `/p/CODI/` reales cuando toque (instrucciones
      en el comentario junto a `<div class="ig-grid">` en `site/index.html`).

---

## E. Lo que sigue bloqueado a propósito

Estos enlaces siguen sin destino y siguen bloqueados con `data-pend`. Cuando
tengas la URL real, se cambian uno a uno:

- [ ] Instagram (en el pie de todas las páginas)
- [ ] Facebook (en el pie de todas las páginas)
- [ ] "Memòries del grup (PDF)" (en `site/index.html`)

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
