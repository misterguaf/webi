# FASE 3.5D — Activitats: informe de cierre

Fecha de cierre: **2026-09-30**
Especificación: [`design/screens/ACTIVITIES.md`](design/screens/ACTIVITIES.md) v0.2
Rama de trabajo: `phase/3.5d-activities` → integrada en `phase/3.5-design` (sin merge a `main`)
Checkpoint: tag `phase-3.5d-complete`
Estado: **LOCAL / SYNTHETIC ONLY; NOT PRODUCTION READY**. Validación visual humana hecha por Borja sobre el
detalle; el pase artístico de motion queda fuera de esta fase.

## Qué entrega

| Bloque | Resultado | Evidencia |
|---|---|---|
| Concurrencia optimista | Migración append-only `0014_activity_version.sql`; editar, publicar, cerrar y descartar exigen `expectedVersion`; `409 stale_activity`; compare-and-set dentro del lote | `test/gestio-activities.test.js` |
| Descartar borrador | `DELETE /api/activities/:id` solo para DRAFT sin inscripciones, con autorización y versión; auditoría `ACTIVITY_DISCARDED`; PUBLISHED/CLOSED nunca se borran | ídem |
| Read model del listado | Resumen de inscripciones por actividad en una sola consulta, con el alcance del revisor (`ALL`/`PARTIAL`), `null` sin permiso de revisión | ídem (incluye test de número constante de consultas) |
| GENERAL: leer ≠ gestionar | Cualquier titular de `activities.read` consulta GENERAL; gestionar exige `activities.general.manage` | ídem y `test/gestio-permissions.test.js` |
| `termsLocked` | Booleano derivado de la existencia de inscripciones; el detalle no expone `created_by` | ídem |
| Transporte familiar | Ajuste FAMILY ≠ 0 rechazado (`invalid_activity`) al crear y al editar | ídem |
| Routing | `gestio/public/router.js`: hash, push/replace, atrás/adelante, deep links, ruta restaurada tras el login | `test/gestio-router.test.js` |
| Lista, Nova activitat, detalle, Inscripcions, Informació | Vista `gestio/public/views/activities*`; la pantalla legacy y el panel legacy de revisión se han retirado | `test/gestio-activities-ui.test.js` (modelo) y validación en navegador |
| Dashboard | Usa el resumen del listado (una petición); abre el detalle nuevo | `test/gestio-dashboard.test.js` |
| Demo | Escenarios D1–D12 con fechas relativas al seed | `test/gestio-demo.test.js` |

## Autorización de actividades mixtas (revisión de cierre)

Regla vigente: una actividad por secciones se **lee** con `activities.read` sobre al menos una de sus secciones
(la misma regla del listado); se **gestiona** solo con alcance sobre todas. Leerla no amplía ningún alcance:

- las inscripciones que recibe un revisor son solo las enviadas para sus secciones; los recuentos son `PARTIAL`
  y nunca incluyen otras secciones;
- candidatos, vinculación y rechazo de una inscripción de otra sección se deniegan, y vincular una inscripción
  propia con un participante de otra sección también;
- publicar, cerrar, descartar, reducir o ampliar las secciones exige gestionar todas las secciones implicadas.

Regresión añadida en el cierre: `mixed activity: registrations, candidates, reviews and transitions stay strictly
inside the section scope` (`test/gestio-activities.test.js`). No hizo falta cambiar el backend.

Observación menor (no bloqueante, anterior a 3.5D): revisar una inscripción fuera de alcance responde 403 y una
inexistente 404; las lecturas ya responden 404 en ambos casos. Los identificadores son UUID no enumerables.

## Dependencias

`npm audit` fallaba en CI por avisos nuevos de `undici` (vía `miniflare`/`wrangler` 4.135.0, solo desarrollo).
Se ha fijado `wrangler` en **4.144.0**; `npm audit` queda en 0 vulnerabilidades. Sin dependencias de ejecución
nuevas; el stack (Workers, D1, R2, ESM, sin framework) no cambia.

## Decisiones tomadas durante la implementación (para revisión de producto)

- Lectura de actividades mixtas con una sección en alcance (exigida por la spec §3.5 y D11).
- Un plazo de inscripción de menos de 48 h pasa por delante del recuento en las señales de la lista.
- `GET /api/me` incluye el catálogo de secciones (id/código) y la lista de inscripciones incluye `transport_code`.

## Pendiente (no forma parte de 3.5D)

- Gaps abiertos de la spec: G2 (filtrado en servidor), G6 (pagos por actividad), G8 (nombre del participante
  vinculado), G10 (historial legible), G12 (plazas), G15 (autoría).
- Pase artístico de motion (tarjeta → detalle con elemento compartido).
- Tests de DOM: el comportamiento de interfaz se validó en navegador; el modelo tiene tests en Node.
- Siguiente fase: 3.5E Participants. Su especificación (`design/screens/PARTICIPANTS.md` v0.1) se entrega como
  borrador fuera de este checkpoint y tiene decisiones de producto pendientes sobre tutores, contactos,
  consentimiento e importación inicial.
