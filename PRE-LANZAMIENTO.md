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
- [ ] **Base legal específica (art. 9 RGPD)** para el campo de alergias y
      necesidades. Son datos de salud: no basta el consentimiento genérico.
- [ ] **Plazo de conservación** si la familia no se apunta, y si se apunta. Un
      plazo concreto, y alguien encargado de borrar lo que caduque.
- [ ] **Quién accede** a las fichas dentro del grupo y cómo se controla.
- [ ] **Criterio de edad** y confirmación de que lo rellena siempre el tutor legal.
- [ ] **DPA de Notion firmado/aceptado** y revisadas las garantías de
      transferencia internacional (Notion es una empresa de EE. UU.).
- [ ] **DPA del proveedor de hosting** que elijas.
- [ ] **Procedimiento** para atender una petición de acceso, rectificación o
      borrado: quién la recibe y en cuánto tiempo se contesta.
- [ ] Poner la **fecha de publicación** en las tres páginas legales.
- [ ] **Revisar las tres páginas legales con alguien que entienda de protección
      de datos.** Yo he montado la estructura, no he redactado el contenido legal.

---

## B. Infraestructura

- [ ] **Crear la base de datos en Notion** con las propiedades exactas que están
      documentadas en el `README.md` (nombres con acentos incluidos).
- [ ] Añadir la opción `Nova` al select `Estat` y las cuatro secciones al select
      `Secció`.
- [ ] **Crear la integración interna de Notion** en <https://www.notion.so/my-integrations>
      y darle acceso **solo** a esa base de datos, a ninguna otra página.
- [ ] **Elegir hosting** (Vercel, Netlify o Cloudflare). El código ya funciona en
      los tres sin cambios.
- [ ] **Configurar las variables de entorno en el panel del hosting real**, no
      solo en tu `.env` local: `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `ALLOWED_ORIGIN`.
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
      comprobar que la ficha aparece en Notion con todos los campos bien.
- [ ] Borrar esa ficha de prueba de Notion.
- [ ] Probar el formulario **con JavaScript desactivado** (debe enviarse igual y
      mostrar una página de confirmación).
- [ ] Probar en **móvil real**, no solo en el navegador del ordenador.
- [ ] Pasar el dominio por <https://securityheaders.com> y comprobar que las
      cabeceras llegan de verdad.
- [ ] Comprobar que `https://tudominio/api/alta` con un GET responde 405 y no
      enseña nada raro.

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
