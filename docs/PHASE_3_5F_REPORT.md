# FASE 3.5F — Inscripcions: informe de implementación

Fecha: **2026-10-01**
Especificación: [`design/screens/REGISTRATIONS.md`](design/screens/REGISTRATIONS.md) v0.2 (aprobada)
Rama: `phase/3.5f-registrations`, desde `phase/3.5-design` (`97fb9f3`, `phase-3.5e-complete`) + commit documental `b5096c3`.
Sin merge, sin tag. **Pendiente de revisión de Borja/Atlas. No declarada v1-ready.**
**LOCAL / SYNTHETIC ONLY; NOT PRODUCTION READY.**

## Commits

| Commit | Contenido |
|---|---|
| `b5096c3` | Especificación v0.2 aprobada + índice |
| `4099863` | Batch 1 — migración 0018 y dominio |
| `3ab6e89` | Batches 2–6 — autorización, sección histórica, escalado/corrección, contacto, retirada, justificantes, pestaña de actividad |
| `2d02f2c` | Batch 5 (portal) — optimización de fotos |
| `1a81e97` | Batches 7, 8, 10 — cola global, superficie temporal de pagos, Inici y contador de navegación |
| `6fd74e9` | Batch 14 — demo |
| `c984110` | Backup/restore con retiradas y correcciones |
| cierre | Documentación |

## Migración 0018

`activity_registration.status` y `notification_outbox.kind` están fijados por `CHECK` (0003): se reconstruyen
`activity_registration`, `payment_evidence`, `notification_outbox` y `notification_capture` con su nombre, copiando
todas las filas sin cambios (mismos ids y relaciones). Las tablas nuevas se referencian entre sí por nombres temporales
que SQLite reescribe al renombrar, de modo que nunca se borra un padre mientras un hijo `RESTRICT` antiguo lo
referencia; los triggers de bloqueo de actividad que nombran la tabla se eliminan y se recrean idénticos.

Añade: `registration_section_id` (relleno desde la sección declarada; se rellena al insertar; solo se corrige mientras
está pendiente, nunca a NULL y dentro del público), `version`, `review_level`/`escalation_*`, `WITHDRAWN` con
`withdrawn_at/by/source` inmutables, historial append-only `activity_registration_section_change`, avisos `REJECTED` y
`WITHDRAWN`, metadatos de conservación de justificantes (`object_purged_at/reason`, solo para verificados, una vez),
el permiso `activities.registration.contact.read` y la matriz (Secretaria: lectura, revisión y contacto de grupo; nunca
gestión). Verificada desde 0017 con filas en todos los estados (node:sqlite) y con el dataset demo en D1 local de
Wrangler (actualización, backup, restore, integridad, FKs y triggers).

## Máquina de estados

- Inscripción: `NEEDS_PARTICIPANT_REVIEW` → vincular (`CONFIRMED` / `AWAITING_PAYMENT_REVIEW`), rechazar
  (`REJECTED`) o retirar (`WITHDRAWN`); `AWAITING_PAYMENT_REVIEW` → `CONFIRMED` (pago verificado) o `WITHDRAWN`;
  `CONFIRMED` → `WITHDRAWN`. Nada sale de `REJECTED` ni de `WITHDRAWN`.
- Pago (derivado): sin pago / pendiente de revisión / incidencia / verificado. Verificar solo confirma desde
  `AWAITING_PAYMENT_REVIEW`; en una inscripción retirada el pago sigue revisable y la inscripción sigue retirada.
- Objeto del justificante: disponible / eliminado por política (solo verificados).
- Rechazo, retirada, incidencia y devolución nunca se mezclan; no hay devoluciones (3.5G).

## Sección histórica y autorización

Declarada (inmutable) ≠ de la inscripción (rige alcance, recuentos, listados, pagos y justificantes) ≠ actual del
participante (nunca la reescribe). Orden en todos los recursos: capacidad (403) → recurso en alcance (inexistente y
fuera de alcance = mismo 404, auditado) → estado/versión (409). Se eliminan los oráculos 403/404/409 de revisión,
candidatos y pagos.

## Matching, escalado y corrección

Matching automático sin cambios. Si el resultado no es claro y existe un participante activo con el mismo nombre
normalizado y fecha en otra sección, la inscripción entra en revisión global sin guardar ni mostrar nada de él; la
respuesta del portal no cambia. Escalado manual por el revisor de sección. Los escalados son visibles para la sección
(`En revisió global`) sin acciones; los resuelven revisores globales (Coordinació general, Secretaria). Corrección de
sección: solo pendiente, dentro del público, por revisor global o con autoridad sobre origen y destino; historial y
auditoría con identificadores. Vincular exige que la sección de la inscripción sea la actual del participante.

## Contactos

Fuera de todos los listados. `Mostra el contacte` → `GET /api/registrations/:id/contact` con
`activities.registration.contact.read`, en alcance, auditado (`SENSITIVE_DATA_READ`,
`REGISTRATION_CONTACT_CONSULTED`) sin valores, `no-store`.

## Justificantes

Bytes en R2 privado; D1 solo metadatos. Tipo detectado por firma al subir (sin cambios) y servido con ese tipo: vista
previa autenticada (`inline`, `frame-ancestors 'self'`) y descarga `justificant-<data>.<ext>`; `PAYMENT_EVIDENCE_VIEWED`
y `PAYMENT_EVIDENCE_DOWNLOADED` sin contenido. En Gestió: imagen o PDF en diálogo, con `Descarrega` siempre. Portal:
fotos desde ~1,5 MB → lado máximo 2000 px, JPEG 0,82, orientación aplicada, EXIF eliminado; PDFs intactos; límite de
4 MiB del servidor sin cambios. Conservación preparada (función de borrado de verificados, no programada).

## Retirada y notificaciones

Retirada desde pendiente, pendiente de pago o confirmada; conserva vínculo, justificante y pago; sin devolución
implícita; quién, cuándo y origen. Aviso neutro por defecto si lo comunica la familia, no si es «otra», con elección
explícita. Rechazo con aviso neutro. Texto de incidencia revisado (pide a la familia contactar con el grupo). Una
solicitud nueva tras una retirada crea una inscripción nueva. Outbox existente, sin proveedor concreto.

## Cola global, proyección financiera, participante vinculado, confirmados

- `Inscripcions`: *Pendents de revisar / Incidències / Totes*; actividades con recuentos en alcance y «vista parcial»
  que abren la pestaña; pagos como filas con vista previa, descarga, verificar e incidencia (con confirmación).
  Sustituye la lista legacy.
- `GET /api/payments` (`vista`, `activityId`) y `GET /api/payments/:id`: actividad (id, nombre, fecha), nombre enviado,
  participante solo con acceso de perfil, importe, transporte y sección solo si son relevantes, estados, metadatos del
  justificante. No concede lectura de Activitats. La pestaña de actividad pide solo sus pagos.
- Participante vinculado (nombre + enlace a la ficha) solo con `participants.profile.read` sobre él.
- Lista de confirmados por actividad, agrupada por sección, con total de transporte del grupo; sin contacto, sin
  exportación, sin asistencia.

## Inici y navegación

Pagos e incidencias abren la cola; escalados como aviso global solo para revisores globales; recuentos desde
`GET /api/registrations/queue/summary`; los avisos por actividad cuentan solo lo accionable. Contador `Inscripcions · n`
desde el mismo resumen; el elemento se oculta a sesiones sin revisión ni verificación.

## Demo

Vínculo manual, escalado automático y manual, sección corregida, rechazo, retirada (pendiente, tras pago verificado),
inscripción nueva tras retirada, incidencia, justificante PNG y PDF, GENERAL con alcances parciales, confirmados,
transporte, Tresoreria sin Activitats. En la demo, `seed-105` también actúa como Secretaria revisora global.

## Tests

Nuevos: `gestio-registrations-migration` (0018, triggers, permisos), `gestio-registrations` (IDOR/BOLA, 404
indistinguible, versión, sección histórica, escalado, corrección, contacto y su auditoría, retirada, rechazo, avisos,
pagos de retiradas, proyección, vista previa/descarga/MIME y auditoría, conservación, cola, confirmados, capacidades),
`gestio-registrations-ui` (modelo de la UI), `portal-evidence-optimizer`; ampliados: `gestio-recovery`, `gestio-demo`,
`gestio-dashboard`, `gestio-3a`, `gestio-activities`, `gestio-matching`, `gestio-shell`.

## Gaps conocidos

- `POST /api/registrations/:id/review` acepta todavía omitir `expectedVersion` (compatibilidad con el flujo 3A); la UI
  siempre lo envía. Corrección, escalado y retirada lo exigen.
- Sin `GET /api/registrations/:id` (no hace falta: la cola abre la pestaña de la actividad).
- Matching en memoria (≤ 1000 participantes activos), sin cambios.
- Borrado por conservación preparado, no programado (pendiente del plazo jurídico).
- Optimización de fotos solo en inscripciones de actividad; la quota anual sigue igual hasta 3.5G.
- En modo `SYNTHETIC_ONLY`, una foto grande reprocesada pierde el marcador sintético y el servidor la rechaza; los
  ficheros sintéticos de prueba son pequeños y no se reprocesan.
- La vista previa de PDF depende del navegador (en algunos móviles solo la primera página); descarga siempre disponible.
- Bases locales anteriores: las retiradas antiguas registradas como rechazos siguen como `REJECTED` (no se pueden
  distinguir); una D1 local sembrada antes de 3.5F necesita `npm run gestio:migrate` y no tiene los permisos de
  contacto del seed hasta resembrar.

## Revisión humana necesaria

Ver checklist de REGISTRATIONS.md §27: cola global, pestaña, revisión manual, contacto, justificante, rechazo,
retirada, incidencia, confirmados, experiencia temporal de Tresoreria y móvil.
