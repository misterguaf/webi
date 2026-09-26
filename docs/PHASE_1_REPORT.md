# FASE 1 — Informe de implementación local

Fecha: **2026-09-22**. Alcance: infraestructura nueva; `site/` y `portal/` sin cambios funcionales. La web antigua publicada está fuera. **NOT PRODUCTION READY.** Sin recursos remotos creados y sin datos reales.

## 1. Arquitectura implementada

`gestio/` es un Worker/Static Assets independiente: UI → API → sesión propia → policy engine → consultas D1 acotadas. Access es solo adaptador de identidad futuro; la autorización sigue en la aplicación. Véase [ADR-007](adr/ADR-007-gestio-d1-local-sessions-policy.md).

## 2. Esquema D1

`app_user`, `auth_identity`, `app_session`, `section`, `role`, `permission`, `role_permission`, `user_role`, `user_permission_grant`, `participant`, `health_access_grant` y `security_event`. PK/FK, unicidad `(issuer,subject)`, estados y vigencias con CHECK e índices de sesiones, roles, grants y participantes. No hay contenido de salud, finanzas, DNI ni justificantes.

## 3. Migraciones

`0001_identity_policy.sql` versionada y aplicada contra D1 **local**. `gestio:reset` reproduce base vacía → migración → seed ficticio; `gestio:migrate` preserva datos. El binding local tiene ID ficticio. Una D1 remota debe nacer con `--jurisdiction=eu`, no con `weur` ni con una propiedad de binding ignorada por Wrangler.

## 4. Identidad

Usuarios individuales con `ACTIVE`, `DISABLED`, `SECURITY_BLOCKED`; identificadores internos UUID. `auth_identity` separa emisor/sujeto de email mutable. El validador Access RS256/JWKS comprueba firma y claims; las claves de las pruebas son sintéticas. No existe Access ni MFA real configurado. El selector de identidades de desarrollo falla cerrado en runtime, la configuración local de startup es obligatoriamente development y `gestio:deploy` está bloqueado hasta autorización y configuración separada.

## 5. Sesiones

Token opaco aleatorio de 256 bits, solo SHA-256 en D1; cookie HttpOnly/SameSite, prefijo `__Host-` y Secure fuera de localhost. Idle 30 min, absoluto 8 h, logout, revocar una/todas, y invalidación por estado. Duraciones provisionales. La suspensión revoca sesiones y grants en un lote D1 transaccional, más evento. No se ha probado la coordinación con IdP.

## 6. Policy engine

Fail-closed: estado y sesión vigentes, rol máximo, permiso explícito, scope y, para salud, participante/purpose/grant/tiempo. La ruta de salud en desarrollo solo verifica policy; no hay datos sanitarios. Cada lectura de participante se filtra en SQL por sección, y los ID fuera de scope devuelven 404.

## 7. Roles, permisos y scopes

Siete roles diferenciados: coordinación general, coordinación/delegación de sección, tesorería, secretaría, CRM y técnica. Asignaciones con vigencia, concedente y justificación. Fixture: dos coordinaciones de secciones distintas, más los demás roles, cinco participantes ficticios. No hay superadmin.

## 8. gestio mínimo

Pantalla local con usuario, estado, roles/scopes, sesiones propias y participantes autorizados. Selector solo local. No muestra tokens, hash de sesión ni matriz global de permisos.

## 9. Tests

`test/gestio.test.js` cubre JWT (firma/issuer/audience/tiempo/sujeto), configuración de producción y startup/deploy bloqueados, D1 local desde cero, siete perfiles, SQL scope, BOLA, grants de salud activos/expirados/revocados/purpose erróneo, rol/permiso caducados, permiso explícito ausente, cuenta deshabilitada, sesiones inválidas/expiradas/idle, revocación individual/global, suspensión y sesión previamente emitida. Los tests existentes de `site/` y `portal/` continúan en `npm test`.

## 10. Resultados

Migración y seed local: PASS. Flujo manual Worker/consulta Tropa: PASS. Suite gestio: 2/2 PASS. `npm run ci`: PASS; 80/80 tests (78 previos + 2 nuevos), lint, typecheck, schemas, guardas y secret check. `npm audit --audit-level=high`: 0 vulnerabilidades. La prueba de integración crea una base D1 local vacía, migra, siembra y ejecuta el Worker en `127.0.0.1`; la base de prueba temporal se elimina al finalizar. Ninguna verificación demuestra controles de producción.

## 11. Limitaciones

Sin Access/MFA remotos ni cuentas reales; sin backup/restore; sin CRUD de dominios; sin MFA step-up (solo sesión emitida hace menos de cinco minutos para suspensión); sin evidencia de residencia remota; auditoría mínima, no completa; sin retención; sin controles anti-bot o WAF de gestio verificados. El endpoint de Access recarga JWKS en cada intercambio y requiere diseño de disponibilidad/rate-limit previo a producción.

## 12. Riesgos abiertos

El prototipo local jamás debe publicarse con selector dev. Hay que proteger origen y configurar Access/MFA, revisar suspensión en carreras y coordinación IdP, definir retención de eventos y probar restauración D1. La contraseña familiar compartida no autoriza fichas; `portal/` permanece sin listados. El estado de la web vieja publicada no se ha evaluado aquí.

## 13. Decisiones necesarias

Dominio definitivo de `gestio`, responsables de aprobar roles/grants/bloqueos, política de duración/step-up, RPO/RTO y retención, configuración legal/EIPD y autorización separada para crear D1/R2/Access remotos. No se solicita ninguna de ellas para seguir con desarrollo sintético de FASE 2.

## 14. Readiness para FASE 2

**YES para FASE 2 exclusivamente local y sintética:** hay identidad, sesión, policy, D1 local y pruebas negativas sobre las que añadir persistencia por dominios, auditoría completa y backups/restores sintéticos. **NO para producción ni datos reales**; todos los gates externos/jurídicos siguen pendientes.
