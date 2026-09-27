# Requisitos de seguridad verificables

Fecha: **2026-09-22**

Plataforma objetivo: Cloudflare D1/R2 con jurisdicción `eu`, Workers/Static Assets, Access y Turnstile, según [ADR-001](adr/ADR-001-cloudflare-first-eu.md). No se han creado recursos remotos.

FASE 3A consolidada, alcance local sintético: `portal/worker.js` es el único Worker familiar mantenido para actividades; conserva sesión/cookie, CSRF, Origin checks, límites y respuesta neutral para match claro, ambiguo o inexistente. El servidor obtiene catálogo, calcula precio/transporte y matching desde D1; el justificante requerido para importe positivo va en el mismo trámite hacia la abstracción de storage y el outbox. `receipt_email` es destino de notificación, no identidad ni contacto maestro. `submitted_by_name` no verifica tutoría; `contact_phone` es opcional; `submitted_birth_date` vive solo mientras haya revisión pendiente. Ningún dato de envío actualiza participante, guardian ni relaciones. Actividades no escriben en Sheets/Drive ni usan `data/activitats.json`; cuota anual permanece legacy. `family/` queda deprecated sin borrado. Los archivos de evidencia son **solo fixtures**, sin escaneo antimalware real ni cuarentena. Antes de producción: Access/MFA, Turnstile server-side, rate limiting distribuido, R2 EU privado, antivirus/cuarentena, autorización de contacto familiar, email real, controles de descarga y lifecycle/retención validados jurídicamente. **NOT PRODUCTION READY**.

FASE 3B local/sintética: la referencia a cuota legacy de 3A es histórica. `portal/worker.js` ya no enruta **cuotas nuevas** a Apps Script/Sheets/Drive. Exige cookie, Origin exacto, CSRF, límite de cuerpo, allowlist, honeypot, rate limit y justificante sintético válido; D1 calcula deuda/descuento y un usuario autorizado verifica el banco. Una subida no marca PAID. Matching externo permanece neutral, no crea personas ni actualiza datos maestros; DOB pendiente se limpia al resolver. Las asignaciones y correcciones se controlan con transacción, constraints y auditoría; TECH_ADMIN no hereda acceso. Delegación de revisión requiere ratificación y scope; fraccionamiento solo por Tesorería o Coordinación. El backend legacy y cualquier Apps Script remoto anterior son **PRODUCTION_BLOCKER / MIGRATION_CHECK** antes de datos reales. Origin HTTPS final, HSTS includeSubDomains, Access/MFA, Turnstile, R2 EU remoto, antivirus, backup de binarios y retención legal siguen abiertos. **NOT PRODUCTION READY**.

Estados: `IMPLEMENTED`, `TESTED`, `PARTIAL`, `NOT IMPLEMENTED`, `REQUIRES EXTERNAL CONFIGURATION`, `REQUIRES LEGAL VALIDATION`, `NOT APPLICABLE`.

## Autenticación y sesiones

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| AUTH-001 | Cuentas internas individuales | IMPLEMENTED/TESTED SOLO SINTÉTICO LOCAL | `gestio.test.js`; roster real pendiente |
| AUTH-002 | MFA obligatorio para `gestio` | REQUIRES EXTERNAL CONFIGURATION | IdP/Access policy review + login test |
| AUTH-003 | Validar firma, issuer, audience y expiración del JWT Access | IMPLEMENTED/TESTED CON CLAVES SINTÉTICAS; CONFIG EXTERNA PENDIENTE | `gestio.test.js` |
| AUTH-004 | Sesiones internas server-side, opacas y revocables | IMPLEMENTED/TESTED LOCAL | D1 y `gestio.test.js` |
| AUTH-005 | Idle y absolute timeout | IMPLEMENTED/TESTED LOCAL | `gestio.test.js`, tiempos provisionales |
| AUTH-006 | Logout y revocación de todas las sesiones | IMPLEMENTED/TESTED LOCAL | `gestio.test.js` |
| AUTH-007 | Estados ACTIVE/DISABLED/SECURITY_BLOCKED | PARTIAL/TESTED LOCAL | schema, disabled y suspensión; lifecycle completo pendiente |
| AUTH-008 | Suspensión urgente bloquea y revoca de inmediato | IMPLEMENTED/TESTED LOCAL | D1 batch + sesión previa inválida; coordinación IdP pendiente |
| AUTH-009 | Reautenticación para acciones sensibles | PARTIAL | sesión reciente en suspensión; MFA step-up pendiente |
| AUTH-010 | Cookie familiar segura | IMPLEMENTED, TESTED | `portal-auth.test.js`, header inspection |
| AUTH-011 | DEV_AUTH_BYPASS imposible fuera de development | IMPLEMENTED/TESTED EN CÓDIGO | guard `APP_ENV=production`, test negativo; deploy no probado |

## Autorización

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| AZ-001 | Deny-by-default centralizado en backend | IMPLEMENTED/TESTED LOCAL | policy + matriz negativa; property tests pendientes |
| AZ-002 | Roles distintos sin superadmin universal | IMPLEMENTED/TESTED LOCAL | schema + siete perfiles sintéticos |
| AZ-003 | Permiso explícito además del rol | IMPLEMENTED/TESTED LOCAL | revoke grant negativo |
| AZ-004 | Scope de sección en policy y query | IMPLEMENTED/TESTED LOCAL | SQL `IN`, cross-section |
| AZ-005 | Object-level authorization en cada recurso | IMPLEMENTED/TESTED PARA PARTICIPANTES | ID BOLA; otros recursos futuros pendientes |
| AZ-006 | Salud requiere grant por participante/purpose/tiempo | IMPLEMENTED/TESTED COMO POLICY SIN DATOS DE SALUD | activo/expirado/revocado/purpose |
| AZ-007 | TECH_ADMIN sin acceso ordinario a datos | IMPLEMENTED/TESTED LOCAL | 403 perfil y deny salud |
| AZ-008 | Treasury/Secretary/CRM segregados | PARTIAL/TESTED LOCAL | matriz de perfil/salud; dominios futuros pendientes |
| AZ-009 | Break-glass temporal, aprobado, auditado y revocable | NOT IMPLEMENTED | workflow test + drill |
| AZ-010 | La sesión familiar nunca permite listar/leer miembros | IMPLEMENTED BY ABSENCE, TESTED | route inventory tests |

## Datos y privacidad

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| DATA-001 | Separar identidad, economía y salud | PARTIAL | identidad y grant de policy; dominios de contenido futuros |
| DATA-002 | IDs internos aleatorios | IMPLEMENTED EN BACKEND | UUID nuevos; fixture sintético con UUID fijos |
| DATA-003 | DNI/email/nombre nunca PK | IMPLEMENTED EN SCHEMA FASE 1 | migration review; DNI no existe |
| DATA-004 | Eliminar salud de la lista de espera pública | IMPLEMENTED, TESTED | form/API/payload/Apps Script boundary tests |
| DATA-005 | Datos reales prohibidos en dev/staging | IMPLEMENTED IN CODE; EXTERNAL STAGING PENDING | egress/config guard tests |
| DATA-006 | Retención por categoría | REQUIRES LEGAL VALIDATION | policy approval + job tests |
| DATA-007 | Estados active/inactive/legal-block/deleted | NOT IMPLEMENTED | lifecycle tests |
| DATA-008 | No copiar producción a desarrollo | NOT IMPLEMENTED | IAM + backup restore controls |
| DATA-009 | Minimización de DNI en campamentos | REQUIRES LEGAL VALIDATION | field inventory review |
| DATA-010 | Integración CRM federativo desactivada hasta decisión | IMPLEMENTED BY ABSENCE | route/job inventory |

## Formularios, API y ficheros

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| API-001 | Validación server-side de campos, enums y límites | IMPLEMENTED, TESTED | test suite |
| API-002 | Precios/importes calculados en servidor | IMPLEMENTED, TESTED | quota/reserva tests |
| API-003 | Límite de payload antes de acumulación | IMPLEMENTED, TESTED IN ADAPTERS | declared + streamed oversized body tests |
| API-004 | Rate limiting distribuido | PARTIAL | multi-instance/load test |
| API-005 | Turnstile con Siteverify server-side, más rate limit y honeypot | PARTIAL: adapter/test mode; handlers/widget pending | adapter tests; token E2E/replay pending |
| API-006 | CSRF en requests con cookie | IMPLEMENTED, TESTED para portal | portal worker tests |
| API-007 | Respuestas no enumerables | PARTIAL | black-box differential tests |
| FILE-001 | Allowlist, tamaño y magic bytes | IMPLEMENTED, TESTED | upload tests |
| FILE-002 | Cuarentena y malware scan | NOT IMPLEMENTED | EICAR/safe test corpus |
| FILE-003 | R2 privado `eu` y URL breve autorizada | NOT IMPLEMENTED | jurisdiction/IAM review + URL expiry test |
| FILE-004 | Nombre de objeto generado, no de cliente | IMPLEMENTED en Apps Script | code review |

## Criptografía y secretos

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| CRYPTO-001 | TLS en toda producción | REQUIRES EXTERNAL CONFIGURATION | TLS scan + origin review |
| CRYPTO-002 | Cifrado en reposo DB/objetos/backups | NOT IMPLEMENTED | provider evidence |
| CRYPTO-003 | Cifrado de aplicación para salud evaluado | NOT IMPLEMENTED | design + crypto review |
| SEC-001 | Secrets fuera de Git y frontend | IMPLEMENTED LOCALLY | history scan + bundle scan |
| SEC-002 | Secret manager por entorno | NOT IMPLEMENTED | platform config review |
| SEC-003 | Rotación/revocación de secretos | NOT IMPLEMENTED | rotation drill |
| SEC-004 | Secret scan automatizado | IMPLEMENTED IN CI; FIRST REMOTE RUN PENDING | local scan + Gitleaks v3 workflow |
| SEC-005 | HMAC Worker→Apps Script | IMPLEMENTED, TESTED LOCALLY | unit test + external replay test |

## Logging, auditoría e incidentes

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| LOG-001 | Audit events generados por backend | PARTIAL/TESTED LOCAL | eventos auth/authz/suspensión, cobertura completa pendiente |
| LOG-002 | Registrar auth, roles, grants, salud, export y break-glass | PARTIAL | auth/authz/suspensión; resto pendiente |
| LOG-003 | No guardar passwords, tokens, MFA, salud o payload completos | PARTIAL | log capture tests |
| LOG-004 | Retención y borrado de logs definidos | REQUIRES LEGAL VALIDATION | config/job review |
| LOG-005 | Acceso a logs restringido y auditado | NOT IMPLEMENTED | IAM review |
| LOG-006 | Correlación por request/event ID | PARTIAL/TESTED LOCAL | `X-Request-ID` y `security_event.request_id`; tracing externo pendiente |
| IR-001 | Identificar recursos afectados por incidente | NOT IMPLEMENTED | tabletop exercise |
| IR-002 | Preservar evidencias sin copiar datos indiscriminadamente | NOT IMPLEMENTED | incident drill |

## Infraestructura y SDLC

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| INFRA-001 | Access delante de `gestio` | REQUIRES EXTERNAL CONFIGURATION | unauthenticated access test |
| INFRA-002 | Origen no accesible o JWT validado | PARTIAL | adaptador JWT probado local; origen remoto no configurado |
| INFRA-003 | Dev/staging/prod separados | PARTIAL: policy/config local only | account/config inventory |
| INFRA-004 | Backups cifrados y restringidos | LOCAL SYNTHETIC BACKUP TESTED; PRODUCTION NOT IMPLEMENTED | cifrado, IAM y almacenamiento independiente requieren configuración externa |
| INFRA-005 | Restore periódico probado | ONE LOCAL SYNTHETIC DRILL TESTED; PRODUCTION NOT IMPLEMENTED | `test/gestio-recovery.test.js`, runbook y futuros drills programados |
| INFRA-006 | WAF/rate limits configurados | REQUIRES EXTERNAL CONFIGURATION | dashboard review + load test |
| INFRA-007 | D1 creado con `jurisdiction = "eu"`, nunca solo `weur` | LOCAL PLAN/GUARD IMPLEMENTED; REMOTE NOT CREATED | config check + future API/dashboard assertion |
| INFRA-008 | Todo R2 personal/documental creado y enlazado con `jurisdiction = "eu"` | LOCAL PLAN/GUARD IMPLEMENTED; REMOTE NOT CREATED | config check + future bucket metadata assertion |
| INFRA-009 | R2 privado, sin `r2.dev` ni dominio público | NOT IMPLEMENTED | negative public-access test |
| INFRA-010 | Uso del free tier medido y alertado por servicio | NOT IMPLEMENTED | dashboard/API threshold test |
| INFRA-011 | Workers críticos fallan cerrados al superar límites | NOT IMPLEMENTED | quota/failure integration test |
| SDLC-001 | CI con lint/typecheck/test/build | IMPLEMENTED IN CONFIG; REQUIRED CHECK PENDING | local CI pass + first GitHub run |
| SDLC-002 | Dependency audit/SBOM | PARTIAL: audit implemented, SBOM pending | CI output; current npm audit 0 vulnerabilities |
| SDLC-003 | Migrations versionadas y revisadas | NOT IMPLEMENTED | migration pipeline |
| SDLC-004 | Source maps/artefactos revisados | NOT APPLICABLE CURRENT STATIC SITE | build artifact scan when introduced |
| SDLC-005 | Errores de producción sin stack/config | PARTIAL | black-box error tests |

## Exportaciones y operaciones

| ID | Requisito | Estado | Verificación |
|---|---|---|---|
| EXP-001 | Exportación con permiso y purpose específico | NOT IMPLEMENTED | authorization tests |
| EXP-002 | Campos y filas minimizados | NOT IMPLEMENTED | snapshot tests |
| EXP-003 | Fichero temporal cifrado y con expiración | NOT IMPLEMENTED | lifecycle test |
| EXP-004 | Solicitud, denegación y descarga auditadas | NOT IMPLEMENTED | event tests |
| OPS-001 | No hay datos reales antes del gate | PROCESS REQUIREMENT | environment review |
| OPS-002 | No se crean recursos remotos sin autorización explícita | PROCESS REQUIREMENT | approval record + provisioning log |
| OPS-003 | Cambiar D1/R2 exige ADR con limitación, impacto, alternativa, coste y residencia | PROCESS REQUIREMENT | ADR review |

## Baseline

Usar OWASP ASVS **v5.0.0** con identificadores versionados cuando se haga el mapeo detallado, y OWASP API Security Top 10 2023 para pruebas de BOLA, autenticación, consumo de recursos, inventario y flujos sensibles. Esta lista es una baseline específica del proyecto, no una declaración de cumplimiento ASVS.
