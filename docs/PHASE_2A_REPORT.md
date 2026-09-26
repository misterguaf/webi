# FASE 2A — Persistencia, auditoría y hardening del core

Fecha de cierre: 2026-09-23. Alcance: **solo `gestio/` local**, con datos sintéticos. `site/`, `portal/` y la web antigua publicada quedan fuera. **NOT PRODUCTION READY.** No se creó recurso remoto ni se importó dato real.

## Arquitectura y esquema

El flujo es Worker HTTP → servicio de aplicación → policy → repositorio D1. La autorización precede a consultas/cambios sensibles. El repositorio de participantes exige una decisión positiva y aplica sección de nuevo en SQL. Hay repositorios limitados de `auth`, `organization`, `participants`, `health`, `audit` y `security`; `activities` y `finance` son fronteras sin funcionalidad. No hay repositorio genérico ni acceso universal de TECH_ADMIN.

`0002_domain_audit_incidents.sql` es incremental: añade `audit_event` (índices de tiempo, actor, recurso, request), `security_incident`, `incident_resource`, `incident_audit_hold`, `retention_policy` desactivada, constraints/FK/uniques y triggers de estado/sesiones. Copia eventos legacy locales de `security_event` sin eliminar esa tabla. El seed es ficticio. Se prueban D1 vacía y FK negativas.

## Auditoría

Eventos efectivos: login correcto/fallido, creación/logout/revocación de sesión, allow/deny relevantes, suspensión/disable/enable, asignación/revocación de rol y permiso, grant/revocación de salud sintética, apertura de incidente, alta/liberación de hold y lectura de logs. Otros códigos quedan preparados sin emitirse mientras no exista su operación (export, break-glass, salud real). El request ID interno permite correlación. `audit.event.read` requiere rol y grant explícito; la API valida filtros, usa cursor y limita a 50. Cada lectura registra `AUTHZ_ALLOW` + `AUDIT_LOG_READ`; denegaciones relevantes registran `AUTHZ_DENY`. No hay ruta HTTP de retención.

Las escrituras sensibles y su evento usan un mismo lote D1. Un test fuerza fallo de auditoría y comprueba rollback del cambio de rol. Las lecturas no salen del Worker si falla su evidencia. El writer solo acepta metadatos `count` y `source`; los tests usan canarios sintéticos de password, token, cookie, JWT, DNI, alergia, medicación, diagnóstico y cuerpo HTTP. El log es append-only lógico, no inmutable ante administrador D1; véase [ADR-008](adr/ADR-008-gestio-domain-audit-lifecycle.md).

## Incidentes y lifecycle

Un incidente técnico puede asociar un evento a hold. Retención normal preserva el evento con hold; tras liberarlo, queda elegible. `retention_policy` centraliza plazos y permanece desactivada hasta decisión jurídica. Suspender bloquea la cuenta y revoca sesiones, roles, permisos y grants en el mismo lote que su evento. Dos sesiones activas de prueba dejan de funcionar. Un trigger revoca sesiones incluso si un cambio de estado se hace directamente en SQL; esto no sustituye al servicio auditado.

## Verificación y pendientes

`test/gestio.test.js` parte de D1 vacía, migra, siembra y prueba Worker local con scopes, sesiones, auditoría, grants, roles, suspensión, incident hold, FK negativas y rollback. `test/gestio-2a.test.js` prueba contratos de repositorio, minimización y retención desactivada. Ambas entran en `npm test`/`npm run ci`. **CI local final: PASS, 83/83 tests, lint/typecheck/guardas PASS y npm audit 0 vulnerabilidades.** No hay egress remoto; la primera ejecución GitHub Actions/Gitleaks sigue pendiente de evidencia.

Decisiones pendientes: plazos legales de retención y política de incidentes (`LEGAL_DECISION_REQUIRED`); aprobadores de roles/grants/bloqueos/logs; Access/MFA y step-up reales; RPO/RTO y backup/restore (FASE 2B); controles de cuenta D1 y coordinación IdP. La atomicidad cubre el lote de escritura, no elimina todas las carreras entre comprobar permiso y escribir. No hay limitación concreta de D1 que justifique cambiar proveedor. **YES para iniciar FASE 2B local/sintética; NO para producción ni datos reales. No continuar automáticamente.**
