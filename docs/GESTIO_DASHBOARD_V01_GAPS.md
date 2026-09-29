# Gestió Dashboard v0.1 — límites de datos existentes

El Dashboard consulta únicamente endpoints ya disponibles. Las listas de
actividades, inscripciones y pagos se filtran en el servidor según los permisos
y secciones efectivos. El porcentaje de cuotas procede de
`GET /api/fees/rounds/:id/metrics`.

## Actividad reciente

El sistema registra eventos operativos como publicación de actividades,
revisión de inscripciones, verificación de pagos y resolución de incidencias.
`GET /api/audit/events` exige `audit.event.read` y devuelve registros técnicos
con identificadores y códigos. No ofrece una proyección humana con nombre de
actor, contexto navegable y autorización por recurso afectado. Por ello, la
v0.1 omite `Activitat recent` e `Historial d'activitat`. Antes de añadirlos se
necesita una proyección server-side con filtrado por permiso y sección,
redacción de datos sensibles y copy humano.

## Capacidad de crear actividades

`GET /api/me` devuelve roles, pero no permisos efectivos. La v0.1 solo muestra
`Nova activitat` cuando una lectura de detalle de una actividad general existente
confirma `activities.general.manage`, porque ese endpoint ya exige dicho
permiso. La acción usa el formulario y `POST /api/activities` existentes. Un
usuario que solo tenga `activities.manage` de sección, o un gestor general sin
ninguna actividad general creada, puede tener permiso y no ver el CTA en Inici.
El flujo de Activitats permanece disponible. Para resolver esa omisión sin
heurísticas de roles se necesitaría exponer capacidades efectivas de forma
explícita desde el servidor en una fase posterior.

## Alcance de los contadores

La lista de actividades y cada lista de inscripciones tienen un límite de 100
registros en el contrato actual. Los contadores del Dashboard representan los
registros devueltos, no un total global garantizado si se supera ese límite.
Las incidencias abiertas de cuotas enlazan con el bloque de incidencias ya
existente en Quotes; el servidor sigue comprobando el permiso de resolución.
