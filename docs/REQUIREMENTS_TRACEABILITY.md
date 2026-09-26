# Matriz de trazabilidad

Estado: **FASE 3A — actividades e inscripciones locales sintéticas; infraestructura remota no creada**

| Requisito FASE 3A | Evidencia local | Estado |
|---|---|---|
| Actividades, scopes, ciclo de vida y precio/transporte | `0003_activities_registrations.sql`, `activity-service.js`, prueba 3A | IMPLEMENTED/TESTED local |
| Matching con nombre, sección y DOB auxiliar; sin enumeración ni creación automática | `registration-service.js`, `portal/worker.js`, prueba clara/ambigua/inexistente y lifecycle de DOB | IMPLEMENTED/TESTED local |
| Una única superficie familiar de actividades; conservar portal existente | `portal/public/`, `portal/worker.js`; `family/` deprecated | IMPLEMENTED/TESTED local |
| Datos de envío no actualizan personas/contactos maestros | allowlist portal + servicio 3A + comparación de filas master antes/después | IMPLEMENTED/TESTED local |
| Participación obligatoria y privacidad como lectura informada; sin imagen | formulario portal, `0005_registration_authorizations.sql`, validación y restore 3A | IMPLEMENTED/TESTED local sintético; versiones jurídicas pendientes |
| Pendientes homónimos con fecha distinta no se colapsan | índice incremental y test de dos solicitudes | IMPLEMENTED/TESTED local |
| Justificante y revisión manual, sin banco | `evidence-service.js`, `payment_evidence`, prueba de pago/incidencia | IMPLEMENTED/TESTED sintético |
| Delegación con autorización, provisión y ratificación separadas | `delegation-service.js`, policy, prueba de scope/revocación | IMPLEMENTED/TESTED local |
| Notificación fake/outbox y minimización audit | `notification-service.js`, `notification_capture`, prueba de fallo/reintento | IMPLEMENTED/TESTED local |
| Backup de metadata 3A | `recovery.js`, pruebas recovery/3A | IMPLEMENTED/TESTED local |
| Backup independiente de binarios, correo/Access/Turnstile/R2 EU reales | diseño pendiente | REQUIRES EXTERNAL CONFIGURATION |
| Retención y autorización legal de contacto/ficheros | decisión pendiente | LEGAL_DECISION_REQUIRED |


Alcance: solo la infraestructura nueva de este repositorio; la web antigua actualmente publicada no forma parte de esta matriz. **Web pública** significa `site/`.

Las rutas `target/*` aún son conceptuales cuando figuran abajo; FASE 1, 2A y 2B materializan subconjuntos en `gestio/`. Véanse [PHASE_1_REPORT](PHASE_1_REPORT.md), [PHASE_2A_REPORT](PHASE_2A_REPORT.md) y [PHASE_2B_REPORT](PHASE_2B_REPORT.md).

La selección de plataforma está aceptada en [ADR-001](adr/ADR-001-cloudflare-first-eu.md), pero sus recursos remotos siguen sin crear.

| Requisito | Implementación actual/objetivo | Test/evidencia | Estado |
|---|---|---|---|
| REQ-SURFACE-001 Web pública sin datos privados | `site/`, `worker.js` | `test/worker.test.js` | PARTIAL |
| REQ-SURFACE-002 Portal familiar sin listados/búsqueda/fichas | `portal/worker.js` | `test/gestio-3a.test.js`, `portal-worker.test.js` | IMPLEMENTED/TESTED LOCALLY |
| REQ-SURFACE-003 Portal interno separado | `gestio/` | Worker local + `gestio.test.js` | IMPLEMENTED LOCALLY |
| REQ-CF-001 Access primera capa de `gestio` | `gestio/src/auth.js` + configuración externa | JWT sintético probado; Access remoto pendiente | PARTIAL |
| REQ-CF-002 Access no sustituye app authorization | `gestio/src/policy.js` | matriz negativa local | IMPLEMENTED LOCALLY |
| REQ-CF-003 D1 nace con jurisdicción `eu` | inventario/guard local + futuro metadata check | `cloudflare:check`; API/dashboard pendiente | LOCAL GUARD IMPLEMENTED; REMOTE NOT CREATED |
| REQ-CF-004 R2 personal/documental nace y se enlaza con jurisdicción `eu` | inventario/guard local + futuro binding | `cloudflare:check`; metadata pendiente | LOCAL GUARD IMPLEMENTED; REMOTE NOT CREATED |
| REQ-CF-005 Workers/Static Assets como compute objetivo | `gestio/worker.js`, `gestio/public` | Wrangler local | IMPLEMENTED LOCALLY; NO DEPLOY |
| REQ-CF-006 Turnstile validado mediante Siteverify | adapter preparatorio + futuro middleware | test mode/hostname/action; E2E/replay pendientes | PARTIAL; NOT WIRED TO FORMS |
| REQ-CF-007 Objetivo 0 €/mes monitorizado | usage budgets/alerts | threshold and quota failure tests | NOT IMPLEMENTED |
| REQ-CF-008 Recursos remotos requieren autorización explícita | provisioning workflow | approval record | PROCESS GATE |
| REQ-AUTH-001 Cuentas individuales | `gestio/migrations/0001_identity_policy.sql` | siete usuarios sintéticos | IMPLEMENTED LOCALLY |
| REQ-AUTH-002 MFA obligatorio | IdP/Access | external policy review | NOT IMPLEMENTED |
| REQ-AUTH-003 Expiración/logout/revocación | `gestio/src/auth.js`, `gestio/worker.js` | D1 integration tests | IMPLEMENTED/TESTED LOCALLY |
| REQ-AUTH-004 Salud deny-by-default | `gestio/src/policy.js` | health policy tests sin datos clínicos | IMPLEMENTED/TESTED LOCALLY |
| REQ-AUTH-005 Suspensión urgente | `gestio/worker.js` | sesión previa inválida | IMPLEMENTED/TESTED LOCALLY |
| REQ-AUTH-006 Estados de cuenta separados de bloqueo de datos | `app_user.status` | ACTIVE/DISABLED/SECURITY_BLOCKED tests | PARTIAL; lifecycle futuro |
| REQ-AUTH-007 DEV_AUTH_BYPASS imposible en prod | `assertEnvironment` | producción negativa | IMPLEMENTED/TESTED IN CODE |
| REQ-ROLE-001 Roles RC1 independientes | `role`, `user_role` | matriz siete perfiles | IMPLEMENTED/TESTED LOCALLY |
| REQ-ROLE-002 Role + explicit permission + section scope | grants/policy engine | cross-section y revoke tests | IMPLEMENTED/TESTED LOCALLY |
| REQ-ROLE-003 TECH_ADMIN sin datos ordinarios | role max + policy | 403 perfil y deny salud | IMPLEMENTED/TESTED LOCALLY |
| REQ-ROLE-004 Break-glass temporal/auditado | break-glass workflow | expiry/revoke/drill | NOT IMPLEMENTED |
| REQ-DATA-001 Browser→backend→DB | `gestio/public` → Worker → D1 | local E2E | IMPLEMENTED LOCALLY |
| REQ-DATA-002 Dominios identity/finance/health | identidad y grant de policy; contenido futuro | schema review | PARTIAL |
| REQ-DATA-003 IDs aleatorios | UUID backend; seed fijo ficticio | migration + session tests | IMPLEMENTED FOR NEW ROWS |
| REQ-DATA-004 DNI no PK y minimizado | DNI no almacenado en FASE 1 | schema review | IMPLEMENTED BY ABSENCE |
| REQ-DATA-005 HealthAccessGrant completo | `health_access_grant` | activo/expirado/revocado/purpose | IMPLEMENTED/TESTED AS POLICY |
| REQ-CRYPTO-001 TLS | hosting/Cloudflare | live TLS scan | EXTERNAL PENDING |
| REQ-CRYPTO-002 Cifrado en reposo | DB/object/backup provider | provider evidence | NOT IMPLEMENTED |
| REQ-CRYPTO-003 Cifrado de campo evaluado | envelope encryption design | crypto review | DESIGNED/NOT IMPLEMENTED |
| REQ-SECRET-001 Secrets fuera de Git | `.gitignore`, `.env.example` | pattern/history scan | PARTIAL/IMPLEMENTED LOCALLY |
| REQ-SECRET-002 Secret manager y rotación | target platform | rotation drill | NOT IMPLEMENTED |
| REQ-AUDIT-001 Eventos backend obligatorios | `audit_event` y repositorio cerrado; `security_event` legacy | D1 local, integración y rollback 2A | IMPLEMENTED/TESTED FOR EXISTING OPERATIONS; FUTURE OPERATIONS PENDING |
| REQ-AUDIT-002 Minimización de logs | metadatos allowlist, sin body/token/health | canarios sintéticos y tests de contrato 2A | IMPLEMENTED/TESTED LOCALLY |
| REQ-AUDIT-003 Retención/acceso de logs | `audit.event.read`, cursor, lectura auditada; retención desactivada y hold | tests 2A; plazo jurídico pendiente | PARTIAL; LEGAL DECISION REQUIRED |
| REQ-EXPORT-001 Exports con necesidad, auth y campos limitados | export jobs | authorization/snapshot tests | NOT IMPLEMENTED |
| REQ-FORM-001 Validación server-side | `api/_lib/validate.js`, `reserva.js`, `inscripcio.js`, `quota.js` | 75 tests | IMPLEMENTED, TESTED |
| REQ-FORM-002 Límites/rate limit/Turnstile | handlers + stream reader + target Siteverify | body tests; abuse/token tests pendientes | PARTIAL; BODY LIMIT IMPLEMENTED, TURNSTILE NOT IMPLEMENTED |
| REQ-FORM-003 Sin enumeración | rutas actuales + target uniform responses | differential black-box tests | PARTIAL |
| REQ-UPLOAD-001 Validar y aislar uploads | magic bytes actual + target quarantine | upload corpus/scan tests | PARTIAL |
| REQ-ENV-001 Dev/staging solo ficticios | safe dev, fixtures, policy config | egress/config tests | IMPLEMENTED IN CODE; EXTERNAL STAGING PENDING |
| REQ-ENV-002 Evitar dev→prod | `environment.js` + Sheets adapter | negative egress tests | IMPLEMENTED, TESTED |
| REQ-BACKUP-001 Backup cifrado/restringido de D1/R2 | SQL + manifest D1 local sintético; diseño cifrado/R2 EU | hash, schema, FK, canarios y runbook 2B | LOCAL IMPLEMENTED; PRODUCTION ENCRYPTION/IAM NOT IMPLEMENTED |
| REQ-BACKUP-002 Restore periódico | `gestio/scripts/recovery.js`, runbook y drill CI | `test/gestio-recovery.test.js`, informe 2B | LOCAL DRILL IMPLEMENTED; PRODUCTION SCHEDULE PENDING |
| REQ-PROVIDER-001 D1/R2/Workers/Access/Turnstile como plataforma objetivo | ADR-001 | decision record | APPROVED |
| REQ-PROVIDER-002 Cambio de D1/R2 solo por limitación concreta documentada | ADR futuro obligatorio | five-point ADR review | PROCESS GATE |
| REQ-CRM-001 Sin integración federativa no aprobada | no existe integración | code inventory | IMPLEMENTED BY ABSENCE |
| REQ-RET-001 Ciclo active/inactive/blocked/deleted | disable/enable/suspend y retención configurada desactivada | tests 2A; delete/cron pendiente | PARTIAL |
| REQ-IR-001 Capacidades técnicas de incidente | `security_incident`, recurso y hold | test incidente/hold/retención 2A; tabletop pendiente | PARTIAL |
| REQ-ERR-001 Errores sin stack/secrets | handlers actuales | black-box tests | PARTIAL |
| REQ-SC-001 Dependency y supply-chain audit | lockfile/npm audit + CI | `npm audit`: 0 vulnerabilidades | IMPLEMENTED BASELINE; SBOM PENDING |
| REQ-BUILD-001 Revisar source maps/config pública | no hay build actual | artifact scan futuro | NOT APPLICABLE NOW |
| REQ-LEGAL-001 RC1 no es autorización | docs y gates | approval checklist | ACKNOWLEDGED |
| REQ-REALDATA-001 No usar datos reales | fixtures sintéticos + egress guard | tests/config scan | IMPLEMENTED LOCALLY; PROCESS GATE |
| REQ-PAY-001 No pagos online todavía | no hay pasarela | route/dependency inventory | IMPLEMENTED BY ABSENCE |

Marca obligatoria vigente: `FEDERATED_CRM_INTEGRATION = LEGAL_AND_TECHNICAL_DECISION_REQUIRED`.

## Trazabilidad de hallazgos bloqueantes

| Hallazgo | Requisito afectado | Control de salida |
|---|---|---|
| GAP-001 salud en lista de espera | REQ-AUTH-004, REQ-DATA-002 | CLOSED 0B-A: captura/payload retirados y tests negativos |
| GAP-002 sin auth interna | REQ-AUTH-001/002/003, REQ-ROLE-* | vertical slice individual + deny tests |
| GAP-004 entorno real por defecto | REQ-ENV-001/002 | CLOSED 0B-A LOCAL: modo ficticio default + egress guard |
| GAP-008 uploads | REQ-UPLOAD-001 | cuarentena + escaneo + lifecycle |

## Regla de actualización

Cada implementación futura debe actualizar en el mismo cambio:

1. requisito y estado;
2. ruta concreta de implementación;
3. test automatizado o evidencia externa;
4. fecha/versión de verificación;
5. riesgo residual o decisión pendiente.
