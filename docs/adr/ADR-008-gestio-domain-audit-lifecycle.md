# ADR-008 — Fronteras D1, auditoría e incidentes de gestio

Fecha: 2026-09-22. Estado: aceptada para prototipo **local y sintético**; no autoriza despliegue ni datos reales.

## Contexto y decisión

FASE 1 mezclaba SQL de aplicación en el Worker y solo persistía `security_event`. FASE 2A separa handler → servicio → policy → repositorio D1. Los módulos `auth`, `organization`, `participants`, `health`, `audit` y `security` tienen repositorios limitados; `activities` y `finance` quedan como fronteras explícitas sin funcionalidades. No existe repositorio genérico ni acceso universal por TECH_ADMIN.

`0002_domain_audit_incidents.sql` es incremental, copia la historia local de `security_event` a `audit_event` y añade incidente, recursos, hold y política de retención. `security_event` queda legacy y no recibe nuevos eventos. Ninguna migración previa se reescribe. Las operaciones de escritura sensibles y su evento comparten `D1Database.batch()`, que revierte el lote ante error. Un fallo de auditoría no debe devolver al cliente una operación satisfactoria.

El audit log es append-only **a nivel de aplicación**, no inmutable frente a un operador con permisos D1. El repositorio ordinario solo expone creación y consulta paginada; la eliminación se limita al servicio de retención interno, sin ruta HTTP. No se introduce hash chaining: sin anclaje externo no protege frente a un administrador de D1, y añade complejidad de concurrencia y restauración. Su integridad operativa depende también de permisos de Cloudflare, copias y revisión independiente, pendientes de FASE 2B.

Cada petición genera UUID interno; se ignora cualquier ID de cliente. La taxonomía es cerrada. No se persisten IP, email, cuerpo HTTP, cookies, tokens ni datos sanitarios; los metadatos solo admiten recuento y origen sintético/técnico. El audit log requiere `audit.event.read` como permiso explícito **además** del rol. La lectura produce `AUTHZ_ALLOW` y `AUDIT_LOG_READ` después de la consulta; la consulta de esos eventos no dispara recursión porque solo una lectura HTTP invoca el servicio. Una denegación relevante produce `AUTHZ_DENY`. Los datos no salen del Worker si falla la escritura de evidencia de lectura.

La retención está centralizada en `retention_policy` y desactivada por defecto (`LEGAL_DECISION_REQUIRED`). Un evento con hold activo queda excluido del borrado normal aunque sea antiguo. Liberar el hold solo lo hace elegible; no lo borra inmediatamente. Los incidentes guardan códigos técnicos y referencias, no narrativas libres. La política de cierre, revisión y conservación del incidente permanece pendiente.

## Límites y consecuencias

La consistencia de la escritura y el audit event se prueba mediante un fallo provocado en la inserción de auditoría. Las lecturas autorizadas se auditan antes de emitir respuesta, pero la lectura SQL y el append no son una única instantánea transaccional. Las carreras entre comprobación de permisos y escritura siguen requiriendo revisión adicional antes de producción. La revocación en Access/IdP externo tampoco se ha integrado. No existen exportaciones ni salud real. Los plazos de sesión y step-up siguen provisionales.

D1 sigue siendo el proveedor aprobado. No se ha identificado una limitación concreta que justifique migrarlo. Si en el futuro aparece, documentar limitación, impacto, alternativa, coste e impacto jurídico/residencia antes de plantear otro proveedor. D1 y R2 remotos con datos personales deben nacer con jurisdicción `eu`, no solo `weur`; esta ADR no crea recursos.
