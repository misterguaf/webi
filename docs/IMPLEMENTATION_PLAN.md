# Plan de implementación incremental

Estado: **TARGET PLATFORM APPROVED — NO REMOTE RESOURCES CREATED — SYNTHETIC DATA ONLY**

Actualización 2026-09-26: FASE 3B implementa localmente cuota anual y Tesorería sobre `phase-3a-ci-stable` en `phase/3b-annual-fees`. `portal/` envía cuotas nuevas solo a D1 + storage emulado + outbox fake; `gestio/` gestiona ronda, obligaciones, agrupación familiar explícita, pagos, allocations, fraccionamientos, incidencias y métricas. El código legacy de cuota se conserva deprecado sin dual-write. Ningún recurso remoto ni dato real. Ver [PHASE_3B_REPORT](PHASE_3B_REPORT.md). Antes de producción se debe verificar/desactivar Apps Script remoto legacy y cerrar los bloqueantes de Access/MFA, Turnstile, R2 EU, objetos/backups, correo, textos y retención legales, dominio HTTPS/Origin y HSTS. No iniciar FASE 3.5 automáticamente.

Actualización histórica 2026-09-24: consolidación local de actividades en `portal/public/` + `portal/worker.js` con servicios 3A en `gestio/`; `family/` deprecated y conservado. En aquel checkpoint la cuota anual permanecía legacy. D1/R2 seguían emulados, sin recursos remotos. Ver [PHASE_3A_REPORT](PHASE_3A_REPORT.md). La consolidación no resolvía prerrequisitos de producción: Access/MFA, Turnstile, correo, cuarentena/scan, backup de binarios, validación legal y provisioning EU autorizado.

Actualización 2026-09-23: FASE 1, 2A y 2B implementadas y probadas localmente en `gestio/`. La 2B añade backup SQL+manifest verificado, restore a D1 local nueva, drills de desastre/CI y RPO/RTO **provisionales**. No autoriza datos reales ni aprovisionamiento remoto; cifrado, IAM, copia independiente, retención y restore remoto siguen pendientes. Véanse [informe FASE 1](PHASE_1_REPORT.md), [informe FASE 2A](PHASE_2A_REPORT.md) e [informe FASE 2B](PHASE_2B_REPORT.md).

Alcance: este plan actúa solo sobre la infraestructura nueva de este repositorio. La web antigua actualmente publicada queda fuera. Cuando se menciona la **web pública**, se trata de `site/`.

## Principio de ejecución

No convertir la FASE 0B en un rediseño general. Primero se contienen riesgos y se construyen las fronteras de seguridad; después se añaden vertical slices pequeñas con tests negativos.

La plataforma de la primera versión está decidida en [ADR-001](adr/ADR-001-cloudflare-first-eu.md): D1/R2 con jurisdicción `eu`, Workers/Static Assets, Access y Turnstile. Este plan no autoriza a crear recursos remotos.

## FASE 0B — Bloqueantes y fundamentos

### 0B.1 Guardas de desarrollo

- hacer `dev:site:fake` el modo por defecto;
- mover el modo real a un comando explícito con confirmación y allowlist de entorno;
- separar secrets dev/staging/prod;
- impedir egress de dev hacia endpoints prod;
- añadir fixtures `Participant Test 001`, `Guardian Test 001`, dominios `.test`.

**Salida:** una ejecución local ordinaria no puede escribir fuera.

**Estado 0B-A:** completado en código y tests locales. Separación de cuentas remotas pendiente.

### 0B.2 Reconciliar lista de espera con RC1

- retirar alergias/salud del formulario público de espera y su campo abierto asociado;
- actualizar validación, Apps Script transitorio, privacidad y tests;
- dejar claro el canal sanitario separado, sin inventarlo todavía.

**Salida:** ningún payload de lista de espera admite o invita salud.

**Estado 0B-A:** completado; la columna remota legacy no se ha migrado.

### 0B.3 Baseline de ingeniería

- CI con Node fijado, lint, `checkJs`/typecheck gradual, tests y `diff-check`;
- validación de JSON Schema;
- secret scan y dependency audit;
- inventario de rutas y artefactos;
- reglas de protección de rama.

**Salida:** cambios inseguros básicos no pueden fusionarse.

**Estado 0B-A:** CI configurada y ejecutada localmente; falta activar branch protection y obtener la primera ejecución remota.

### 0B.4 Operacionalizar la decisión Cloudflare-first

- mantener ADR-001 como fuente de verdad y un gate automatizable que rechace bindings remotos nuevos hasta verificar la jurisdicción `eu` en la creación y metadata (no en el binding TOML);
- preparar configuración local D1/R2 y nombres por entorno, sin provisionar recursos remotos;
- documentar el boundary de Access/IdP y la validación JWT;
- documentar Turnstile, Siteverify server-side y secretos por entorno;
- decidir `inscripcions` frente a `inscripciones`;
- definir RPO/RTO objetivo;
- confirmar roles iniciales, aprobadores de grants y suspensión.

**Salida:** configuración local reproducible, ADR aceptado y checklist remoto listo para una autorización posterior.

**Estado 0B-A:** inventario y guardas locales, ADR de D1/R2/Access y documentación Turnstile listos. Dominio, RPO/RTO y responsables siguen abiertos.

## FASE 1 — Identidad y policy engine vacío

- modelo `user`, `auth_identity`, `session`, roles y permisos;
- Access JWT validation;
- MFA/IdP en development/staging;
- suspensión y revocación;
- policy engine deny-by-default sin datos reales;
- tests de matriz y cross-section.

**Salida:** un usuario sintético entra; todo dato/acción no concedido devuelve DENY; TECH_ADMIN no puede leer perfiles.

## FASE 2 — Persistencia y auditoría base

- migraciones D1/SQLite versionadas y probadas localmente;
- schemas/repositorios por dominio;
- audit event writer transaccional y request IDs;
- secret manager, KMS y configuración de entornos;
- diseño de backup/restore D1 y primer restore test con datos sintéticos.

**Salida:** CRUD sintético mínimo con auditoría y restore probado.

**Estado FASE 2B:** salida local/sintética cumplida. Backup y restore no reemplazan migrations/seed. Antes de producción faltan decisión legal-operativa de retención/RPO/RTO, cifrado, credenciales separadas, copia independiente, ledger de supresión, infraestructura EU autorizada y drill remoto.

## FASE 3 — Intake seguro

- llevar `alta`, actividad y cuota a la nueva capa mediante adaptadores;
- conservar endpoints y diseño actuales;
- R2 Standard privado con jurisdicción `eu`, cuarentena/scan y bindings explícitos;
- Turnstile con Siteverify server-side en formularios expuestos;
- rate limiting distribuido;
- outbox para correos;
- evitar cualquier lectura familiar general.

**Salida:** envío sintético extremo a extremo, idempotente y auditable.

## FASE 4 — `gestio` administrativo mínimo

- búsqueda exacta y listados acotados por sección;
- perfil administrativo sin salud ni economía;
- membresías y actividades;
- suspensión de cuentas y revisión de sesiones;
- tests BOLA/BFLA y de enumeración.

**Salida:** vertical slice administrativo con permisos negativos demostrados.

## FASE 5 — Salud aislada

Solo tras validación jurídica del supuesto y campos:

- dominio sanitario separado;
- cifrado de aplicación revisado;
- grants por participante/purpose/tiempo;
- step-up y `SENSITIVE_DATA_READ`;
- break-glass mínimo;
- pruebas y revisión independiente.

**Salida:** salud deny-by-default demostrada; ningún rol obtiene acceso por cargo.

## FASE 6 — Economía

- fee schedules/obligations/allocations;
- vista de tesorería sin salud;
- justificantes minimizados y lifecycle;
- conciliación y notificaciones;
- separación Secretary/CRM/Treasury.

**Salida:** tesorería opera sin acceso lateral.

## FASE 7 — Exportaciones, retención e incidentes

- export jobs limitados y auditados;
- jobs de ciclo de vida;
- incident model, evidencias y runbooks;
- dashboards/alertas mínimas;
- break-glass completo y revisión posterior.

**Salida:** simulacro de suspensión, export controlado y borrado/bloqueo sintético.

## FASE 8 — Staging y verificación preproducción

- staging con datos exclusivamente ficticios;
- revisión Cloudflare/Access/Turnstile/WAF y jurisdicción D1/R2;
- prueba de límites y alertas del free tier, con fallos cerrados y mensajes operativos;
- SAST/DAST y pentest de autorización;
- restore y rollback;
- revisión de logs/source maps/errores;
- accesibilidad y regresión funcional.

**Salida:** informe de evidencias; no una declaración RGPD.

## FASE 9 — Gate legal, migración y cutover

- RC1 aprobada y decisiones externas cerradas;
- Cloudflare/DPA/subencargados/transferencias validados;
- EIPD/cribado terminado;
- plan de migración minimizado y aprobado;
- ensayo con dataset sintético;
- despliegue, verificación y activación controlada de la nueva infraestructura.

**Salida:** autorización organizativa explícita para la fecha de producción.

## Decisiones que sí hacen falta antes de implementar lo correspondiente

1. Responsable del tratamiento y órgano de aprobación.
2. Canal/base jurídica/campos sanitarios; la lista de espera debe quedar sin salud.
3. IdP, padrón de usuarios y método MFA.
4. Contratos y configuración de Cloudflare; solución de KMS/cifrado de campos y correo.
5. Matriz inicial de permisos, quién concede salud y quién aprueba break-glass.
6. RPO/RTO y responsables de restore.
7. Plazos por categoría y tratamiento del bloqueo jurídico.
8. Necesidad y minimización de DNI/SIP/justificantes por flujo.
9. Relación Parpalló–Scouts Valencians–ASDE–CRM.
10. Dominio familiar definitivo (`inscripcions` o `inscripciones`).

No hace falta cerrar ahora todos los campos de formularios, KMS/correo ni diseño visual del portal interno para empezar 0B.1–0B.4 con datos sintéticos locales.

## Qué no hacer todavía

- desplegar la nueva gestión con datos reales;
- importar Sheets, Drive o CRM;
- habilitar pagos online;
- exponer lecturas familiares;
- implementar salud antes de la decisión jurídica y los grants;
- cambiar DNS o comprar servicios sin aprobación;
- crear D1, R2, Access o Turnstile remotos sin autorización explícita;
- crear D1/R2 únicamente con location hint `weur` o sin verificar `jurisdiction = "eu"`;
- introducir PostgreSQL, Supabase, Neon, Firebase u otro proveedor sin ADR de excepción;
- construir exportaciones generales;
- reescribir la web pública;
- declarar la plataforma segura, conforme o production-ready.
