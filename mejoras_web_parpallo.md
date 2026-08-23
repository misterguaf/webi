# Esquema de mejoras — Web Grup Scout Parpalló

*(excluye contenido/textos definitivos: eso ya lo tenéis identificado como pendiente)*

## 1. Formulario "Fer-se scout" — prioridad máxima

- Conectar el formulario a un backend real. Ahora mismo `action="#"` no envía nada.
- Elegir arquitectura: función serverless (Vercel/Netlify/Cloudflare Workers) que reciba el POST y escriba en Notion vía API, con la clave guardada como variable de entorno en el servidor, nunca en el frontend.
- Validación en servidor además de la del navegador (`required` en HTML se salta fácilmente).
- Protección anti-spam/bots: honeypot field o captcha simple, para que no os llenen la lista de espera de basura.
- Mensaje de confirmación tras enviar (ahora el usuario no sabe si ha funcionado o no).
- Página o aviso de error si el envío falla, para que la familia no pierda los datos escritos.

## 2. Legal y RGPD (obligatorio antes de activar el formulario con datos de menores)

- Página de política de privacidad real, específica para datos de menores.
- Página de aviso legal.
- Página/banner de cookies si termináis usando analítica o algo que las genere.
- El checkbox de "política de protección de datos de menores" debe enlazar a esa página real, no a `#`.
- Definir por escrito: quién es responsable del tratamiento, cuánto tiempo se conservan los datos si la familia no se apunta, cómo se atiende una solicitud de acceso/borrado.
- Revisar si el servicio de IA/Notion/hosting que uséis firma un contrato de encargado de tratamiento (DPA) que cubra datos de menores.

## 3. Seguridad técnica

- HTTPS obligatorio en el hosting final (dar por hecho que local no lo tiene).
- Ninguna clave/API key/contraseña en el código del frontend (JS visible con F12).
- Si en el futuro hay panel de administración: autenticación real, no rutas "ocultas" sin login.
- Rate limiting en el endpoint del formulario para evitar abuso.
- Backups del contenido/datos si se acaba usando alguna base de datos propia.

## 4. SEO y descubribilidad

- Añadir `robots.txt` y `sitemap.xml`.
- Revisar el bilingüe CA/ES: ahora mismo ambos idiomas están en el mismo HTML ocultos por CSS, lo que duplica contenido en una sola URL. Valorar `hreflang` o URLs separadas por idioma si os importa el posicionamiento.
- Añadir datos estructurados (schema.org) básicos: organización, dirección, tipo de actividad.
- Revisar meta description/title de cada página de sección (manada, tropa, esculta, clan, cova) para que sean únicas y descriptivas.

## 5. Rendimiento y accesibilidad

- Comprobar peso de imágenes (`cierva.png` y similares) y servir en formatos optimizados (webp/avif) con `srcset` si hace falta.
- Revisar contraste de color en los textos sobre fondo oscuro (`.dark`, `.cova-bg`) con una herramienta tipo Lighthouse/axe.
- Confirmar que el toggle de idioma y la navegación por teclado funcionan bien en todas las páginas de sección, no solo en index.
- Testear con lector de pantalla al menos el formulario, por ser el punto de conversión más importante.

## 6. Enlaces y elementos rotos

- Instagram, Facebook y "Memòries del grup (PDF)" apuntan a `#` y no hacen nada (`data-pend` los bloquea intencionadamente, pero hay que sustituirlos cuando existan).
- Revisar que todos los `data-pend` se vayan reemplazando a medida que haya destino real, y quitar el bloqueo de clic en `script.js` cuando ya no aplique.

## 7. Analítica y seguimiento (opcional pero recomendable)

- Decidir si queréis saber cuánta gente visita la web y de dónde viene, antes de lanzarla.
- Si se añade analítica, tenerlo en cuenta en la política de cookies del punto 2.

## 8. Antes de publicar en producción

- Checklist final: HTTPS activo, formulario probado de extremo a extremo (envío real llega a Notion/email), políticas legales publicadas, robots.txt/sitemap subidos, revisión de accesibilidad básica hecha.
