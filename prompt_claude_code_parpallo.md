# Prompt para Claude Code — Grup Scout Parpalló

Copia todo el bloque de abajo (desde "Contexto" hasta el final) y pégalo como primer mensaje a Claude Code dentro de la carpeta del proyecto (`WEB Parpallo`).

---

## Contexto del proyecto

Estás trabajando en la web estática del Grup Scout Parpalló (Gandia), un sitio bilingüe (valenciano/castellano) hecho en HTML/CSS/JS puro, sin frameworks ni backend. Estructura actual:

- `index.html`, `clan.html`, `cova.html`, `esculta.html`, `fersescout.html`, `fuentes.html`, `manada.html`, `tropa.html`
- `script.js` — JS compartido vanilla (toggle de idioma, animaciones de scroll, quadern interactivo, etc.)
- `styles.css`
- `img/`

El contenido de texto (redacción definitiva, fechas, dirección del local, noticias reales) **todavía no está listo y no debes tocarlo ni inventarlo**. Todo lo que veas marcado con `pend`, `data-pend` o "per confirmar" se queda tal cual — no tapes ese trabajo pendiente ni rellenes contenido de relleno definitivo. Tu trabajo es exclusivamente funcionalidad, seguridad e infraestructura, no copywriting.

No existe ningún backend ni servidor propio todavía. Vamos a construirlo desde cero, minimizando la superficie de ataque y evitando guardar datos sensibles en sitios inseguros. Recuerda en todo momento que el formulario de `fersescout.html` recoge datos de MENORES DE EDAD (nombre, apellidos, fecha de nacimiento, alergias/necesidades, datos de contacto del tutor) — trátalo con el máximo cuidado de seguridad y privacidad, no como un formulario de contacto normal.

Trabaja de forma incremental: implementa un bloque, explícame qué has hecho y por qué, y espera confirmación antes de pasar al siguiente si el cambio es estructural (por ejemplo, elegir el proveedor de la función serverless). Para cambios menores y no ambiguos (robots.txt, sitemap, meta tags) puedes seguir sin pararte a preguntar.

**Regla no negociable de todo el proyecto: la web debe quedarse tal y como está.** El diseño visual, la maquetación, la estructura HTML existente, las clases CSS, el comportamiento actual (idioma, animaciones de scroll, el quadern interactivo, etc.) y la experiencia de usuario NO se tocan. Tu tarea es añadir las funcionalidades de este plan por encima de lo que ya existe, no rediseñar ni reestructurar nada. En la práctica esto significa:
- Añade código nuevo (archivos nuevos, funciones nuevas, endpoints nuevos) en vez de reescribir el que ya hay, siempre que sea posible.
- Si necesitas tocar un archivo existente (por ejemplo `fersescout.html` para conectar el formulario), haz el cambio mínimo imprescindible: no reordenes el HTML, no cambies clases, ids, nombres de campos o estilos que no estén directamente relacionados con lo que estás implementando.
- Antes de tocar cualquier archivo existente, dime qué vas a cambiar y por qué es imprescindible tocar ese archivo en concreto (y no añadir algo nuevo al lado).
- Si en algún bloque no ves manera de implementar algo sin alterar el diseño o la estructura actual, párate y pregúntame antes de hacerlo, explicándome las opciones.

## Plan de trabajo, en este orden

### Bloque 1 — Formulario funcional y seguro (prioridad máxima)

1. Antes de escribir código, pregúntame qué opción prefiero para el backend del formulario: (a) función serverless en Vercel/Netlify/Cloudflare Workers que escriba directamente en una base de datos de Notion vía su API oficial, o (b) otra alternativa equivalente que me expliques con sus pros/contras. No implementes nada hasta que yo confirme la opción.
2. Una vez decidido, implementa el endpoint: recibe el POST del formulario, valida los campos en servidor (no solo confiar en `required` del HTML, que se salta fácilmente), y guarda/envía los datos de forma estructurada.
3. La clave de API (Notion o la que sea) va SIEMPRE como variable de entorno del lado servidor. Nunca debe aparecer en el HTML/JS que se sirve al navegador. Añade un `.env.example` y asegúrate de que `.env` real está en `.gitignore`.
4. Sustituye `action="#"` y quita el aviso rojo "El formulari encara no envia" del formulario en `fersescout.html` una vez esté conectado de verdad.
5. Añade protección anti-spam básica (honeypot field oculto, por ejemplo) sin depender de servicios de pago.
6. Añade un mensaje de confirmación visible tras el envío correcto, y un mensaje de error claro si falla (sin que la familia pierda lo que ha escrito).
7. Rate limiting básico en el endpoint para evitar abuso/spam masivo.
8. Prueba el flujo de extremo a extremo y documenta en un README cómo se despliega y qué variables de entorno hacen falta.

### Bloque 2 — Legal y RGPD (bloqueante para activar el formulario en producción)

1. Crea páginas nuevas: aviso legal, política de privacidad (con una sección específica y clara sobre tratamiento de datos de menores) y política de cookies, siguiendo el mismo estilo visual bilingüe que el resto del sitio. Usa placeholders del tipo `[PENDIENTE: nombre del responsable del tratamiento]` donde falte un dato legal que yo tenga que rellenar — no inventes el contenido legal.
2. Enlaza el checkbox de "política de protección de dades de menors" en `fersescout.html` a la página real de privacidad, en vez de `#`.
3. Enlaza también los `data-pend` de "Avís legal", "Privacitat" y "Cookies" en el footer de todas las páginas.
4. Deja un comentario en el código señalando qué decisiones legales (plazo de conservación de datos, responsable del tratamiento, base legal) tengo que confirmar yo antes de publicar, ya que eso no lo puedes decidir tú.

### Bloque 3 — Seguridad técnica

1. Revisa que no quede ninguna clave o secreto hardcodeado en el código fuente del cliente.
2. Si añadimos cualquier tipo de panel de administración en el futuro, dime explícitamente que eso necesita autenticación real antes de tocarlo — no lo implementes sin que lo hablemos primero.
3. Verifica cabeceras de seguridad básicas recomendadas para el hosting elegido (CSP, X-Content-Type-Options, etc.) y sugiéreme cuáles aplicar.
4. Documenta en el README que el sitio debe servirse siempre por HTTPS.

### Bloque 4 — SEO y descubribilidad

1. Genera `robots.txt` y `sitemap.xml` con todas las páginas actuales.
2. Sobre el bilingüismo: ahora mismo el valenciano y el castellano están ambos en el mismo HTML, ocultos por CSS con `.va`/`.es`. Esto duplica contenido en una sola URL de cara a buscadores. Explícame las opciones (URLs separadas por idioma tipo `/es/`, o `hreflang`) con sus implicaciones de esfuerzo, y no cambies la arquitectura de idiomas sin que yo lo apruebe — es un cambio grande.
3. Revisa y, si faltan, añade `<title>` y `<meta name="description">` únicos y descriptivos por página (manada, tropa, esculta, clan, cova) sin inventar contenido, basándote en lo que ya dice cada página.
4. Añade datos estructurados básicos (schema.org, tipo `Organization` o `SportsOrganization`) usando solo los datos ya presentes en el sitio (no inventes dirección, teléfono, etc. si están marcados `pend`).

### Bloque 5 — Rendimiento y accesibilidad

1. Revisa el peso de las imágenes en `img/` y sugiere/optimiza formatos (webp/avif) y `srcset` donde aplique, sin romper el diseño actual.
2. Pasa una auditoría tipo Lighthouse/axe sobre contraste de color en las secciones oscuras (`.dark`, `.cova-bg`) y corrige solo lo que sea un problema real de accesibilidad, sin tocar la paleta de diseño intencionada.
3. Verifica que la navegación por teclado y el toggle de idioma funcionan igual en todas las páginas de sección, no solo en `index.html`.
4. Prueba el formulario completo con lector de pantalla y corrige cualquier problema de accesibilidad que encuentres (labels, foco, mensajes de error anunciados).

### Bloque 6 — Enlaces y elementos pendientes de destino

1. No elimines el bloqueo de `data-pend` en `script.js` de forma global. Solo quítalo, enlace por enlace, para aquellos que ya tengan destino real tras completar los bloques anteriores (privacidad, aviso legal, cookies). Los que sigan sin destino (Instagram, Facebook, PDF de memorias) se quedan bloqueados tal cual.

### Bloque 7 — Analítica (opcional, solo si yo lo pido explícitamente)

1. No añadas ninguna herramienta de analítica por iniciativa propia. Si te lo pido más adelante, recuérdame que hay que reflejarlo en la política de cookies del bloque 2 antes de activarla.

### Bloque 8 — Checklist final antes de publicar

Al terminar todo lo anterior, genérame un checklist final en un archivo `PRE-LANZAMIENTO.md` que yo pueda repasar a mano antes de poner esto en producción: HTTPS activo, formulario probado de extremo a extremo con un envío real, páginas legales publicadas y enlazadas, robots.txt/sitemap subidos, auditoría de accesibilidad hecha, variables de entorno configuradas en el hosting real (no solo en local).

## Reglas generales para todo el trabajo

- No toques ni "completes" ningún texto marcado como pendiente/provisional. Ese contenido lo redactamos nosotros aparte.
- No cambies el diseño visual, la paleta de colores, la estructura HTML ni el CSS existentes salvo que sea estrictamente necesario para accesibilidad o para conectar una funcionalidad de este plan, y en ese caso el cambio debe ser mínimo y me avisas explicando por qué era imprescindible.
- Ve haciendo commits pequeños y descriptivos por cada bloque, no un único commit gigante al final, así puedo revisar y revertir fácilmente si algo afecta más de lo esperado.
- Después de cada bloque, dime explícitamente qué archivos existentes has modificado (aparte de los que hayas creado nuevos) y qué tipo de cambio ha sido, para que pueda confirmar que no se ha tocado nada del diseño o la estructura que no tocaba.
- Cualquier decisión que implique elegir un proveedor externo (hosting de la función serverless, servicio de email transaccional, etc.) me la preguntas antes de implementarla.
