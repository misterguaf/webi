# Despliegue seguro en Cloudflare

La web se publica en **Cloudflare Pages**. El Worker de `worker.js` se asocia
al mismo dominio mediante una ruta de zona `tudominio.org/api/*`; Pages sigue
sirviendo todas las demás rutas.

La primera versión de la nueva infraestructura usará D1/R2 con jurisdicción
`eu`, Workers/Static Assets, Access y Turnstile, según
[ADR-001](adr/ADR-001-cloudflare-first-eu.md). No se debe ejecutar ningún
comando remoto de este documento hasta recibir autorización explícita.

## Datos y jurisdicción

- D1 se crea con `--jurisdiction=eu`, nunca solo con `--location=weur`.
- Todo R2 destinado a justificantes, documentos o datos personales se crea con
  `--jurisdiction=eu` y su binding declara `jurisdiction = "eu"`.
- Tras crear cada recurso, se comprueba el metadato remoto antes de usarlo.
- La jurisdicción no se puede añadir o cambiar después: un recurso incorrecto
  no se promociona ni recibe datos.
- R2 permanece privado, sin `r2.dev` ni dominio público.

Estos controles no se consideran implementados hasta que exista evidencia del
panel/API. La jurisdicción D1/R2 no limita por sí sola la ejecución global del
Worker, Access, logs ni otros proveedores.

## Secretos y variables

Para alta, reserva y cuota legacy, mientras siga el adaptador de Apps Script, configura como secretos
`SHEETS_WEBHOOK_URL` y
`SHEETS_SHARED_SECRET`, y como variable de texto `ALLOWED_ORIGIN` con
`https://tudominio.org`. No dejes `ALLOWED_ORIGIN` vacío en producción.

En Apps Script crea las propiedades `WEBHOOK_HMAC_SECRET` (el mismo secreto)
y `DRIVE_FOLDER_CUOTES_ID` (ID de la carpeta privada de cuota). Las actividades
nuevas usan D1, storage y outbox desde `portal/`, no Apps Script. Despliega una nueva versión del
script después de sustituir su contenido. La cuenta propietaria debe usar MFA;
la Sheet y la carpeta solo se comparten con las personas responsables.

## Turnstile y rate limiting

Turnstile es obligatorio para los formularios expuestos de la nueva
infraestructura. El sitekey puede aparecer en el frontend; el secret solo vive
como secreto del Worker. El backend llama a Siteverify y valida `success`,
hostname y action. Los tokens son de un solo uso y caducan a los cinco minutos.
El widget sin verificación server-side no aporta protección.

Development y staging usan las claves oficiales de prueba o widgets separados;
nunca reutilizan el secret de producción. La CSP deberá permitir únicamente los
orígenes necesarios de Turnstile.

`api/_lib/turnstile.js` contiene el adaptador preparatorio y un modo sintético
que falla si `APP_ENV=production`. Todavía no se invoca desde los handlers y,
por tanto, **Turnstile no está integrado**. No se añaden sus orígenes a la CSP
hasta que exista widget real, secret por entorno y prueba E2E de Siteverify.

En **Security → Security rules → Rate limiting rules**, crea reglas por IP para
`/api/alta` (5/h) y `/api/reserva` (10/h), con bloqueo temporal. El
endpoint público `/api/inscripcio` ya no existe. Turnstile complementa estas
reglas, el honeypot y la validación; no sustituye ninguna.

El Worker privado usa el binding `PORTAL_LOGIN_LIMITER` (5 intentos/minuto)
y conserva además el límite defensivo en memoria. Añade una regla WAF para
el subdominio si aparecen intentos sostenidos desde muchas ubicaciones.

No actives Bot Fight Mode sin una decisión específica: puede añadir desafíos
fuera de los flujos diseñados. Revisa Security Events y Turnstile Analytics
durante dos semanas y ajusta umbrales solo ante evidencia.

## Verificación y monitorización

**PRODUCTION_BLOCKER — HSTS:** `site/_headers` y `vercel.json` incluyen
`includeSubDomains` durante un año. Es una configuración relevante para la
web pública y alcanza también a `portal`, `gestio` y cualquier otro subdominio
del dominio que reciba esa cabecera. Antes de publicar, verificar HTTPS y
certificados en todos ellos o decidir explícitamente el alcance de HSTS.
No se ha comprobado aquí ningún despliegue ni DNS real.

Antes de abrir formularios reales: confirma HTTPS, la ruta `/api/*`, HSTS,
`ALLOWED_ORIGIN`, Siteverify, un envío por cada formulario y permisos de
storage. Verifica `jurisdiction = "eu"` en D1/R2 y que R2 no es público.

Monitoriza requests/CPU de Workers, filas D1, operaciones/almacenamiento R2,
seats Access y widgets/hostnames Turnstile. Configura alertas antes de acercarse
al free tier y prueba que un agotamiento de cuota falla cerrado. Mientras siga
Apps Script, revisa también sus ejecuciones/cuotas. Ni Apps Script ni R2 son un
antivirus: los adjuntos requieren cuarentena y escaneo antes de abrirse.
