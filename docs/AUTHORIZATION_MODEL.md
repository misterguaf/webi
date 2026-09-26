# Modelo de autenticación y autorización

Estado: **IMPLEMENTADO Y PROBADO SOLO EN GESTIO LOCAL SINTÉTICO — NOT PRODUCTION READY**

FASE 3A: permisos `activities.read`, `activities.manage`, `activities.general.manage`, `activities.registration.review`, `finance.payment.verify` y `auth.permission.authorize/provision/ratify`. Crear/editar/publicar/cerrar una actividad por secciones requiere alcance sobre **todas** sus secciones; la gestión de GENERAL usa permiso explícito independiente. El revisor de matching y pagos ve únicamente expedientes permitidos por su sección; TECH_ADMIN no hereda acceso funcional por administrar identidades. `delegated_permission` registra `authorized_by` distinto de `provisioned_by`, referencia, plazo, scope y estado `PENDING_RATIFICATION`→`RATIFIED`→`REVOKED`; solo ratificado y vigente es efectivo. En local se exige sesión reciente para provisionar/ratificar/revocar. Access/MFA y autoridad organizativa real siguen pendientes de configuración/verificación. [Pruebas 3A](PHASE_3A_REPORT.md).

La implementación verificable está en `gestio/src/policy.js`, `gestio/worker.js`, `gestio/migrations/0001_identity_policy.sql` y `test/gestio.test.js`. Las secciones de break-glass, exports, step-up MFA y Access real de este documento continúan siendo diseño; `gestio/` solo exige sesión reciente para suspensión. Véase [ADR-007](adr/ADR-007-gestio-d1-local-sessions-policy.md).

## 1. Separación de responsabilidades

```text
Cloudflare Access / IdP: autentica y permite alcanzar gestio
Aplicación: mapea identidad, comprueba cuenta y sesión
Policy engine: decide acción sobre recurso y scope
Repositorio: ejecuta únicamente la consulta ya autorizada y acotada
Audit log: registra decisión y operación
```

Cloudflare Access no sustituye la autorización interna.

## 2. Cuentas y sesiones

- cuentas individuales; nunca compartidas para personal interno;
- MFA obligatorio en IdP;
- estados `ACTIVE`, `DISABLED`, `SECURITY_BLOCKED`;
- sesiones opacas server-side, expirables y revocables;
- cierre de sesión individual y “cerrar todas”;
- reautenticación para acciones de alto impacto;
- bloqueo urgente transaccional:

```text
SUSPEND USER
→ revocar grants y bloquear nuevas decisiones
→ revocar todas las sesiones
→ emitir audit event
→ intentar suspensión coordinada en Access/IdP
```

La aplicación debe bloquear inmediatamente aunque la regularización organizativa sea posterior.

## 3. Roles diferenciados

- `GROUP_COORDINATOR`
- `SECTION_COORDINATOR`
- `SECTION_DELEGATE`
- `TREASURY`
- `SECRETARY`
- `CRM_MANAGER`
- `TECH_ADMIN`

Una persona puede acumular roles, pero cada asignación conserva scope, vigencia, otorgante y justificación. No se fusionan tesorería, secretaría y CRM.

## 4. Gramática de permisos

Formato recomendado: `dominio.recurso.acción`, por ejemplo:

- `participants.profile.read`
- `memberships.update`
- `activities.registration.review`
- `finance.fee.read`
- `finance.fee.reconcile`
- `health.record.read`
- `health.grant.manage`
- `auth.user.suspend`
- `audit.event.read`
- `export.request.create`

Una asignación evalúa además:

```text
USER + ACCOUNT_STATUS + SESSION
+ ROLE + EXPLICIT_PERMISSION
+ SECTION_SCOPE
+ RESOURCE + ACTION
+ PURPOSE + TIME
+ RESOURCE_SPECIFIC_GRANT
```

Regla de precedencia: estado suspendido, denegación explícita o falta de evidencia => `DENY`.

## 5. Capacidades máximas por rol

La tabla define máximos posibles, no concesiones automáticas.

| Rol | Identidad/membresía | Economía | Salud | Permisos/infra |
|---|---|---|---|---|
| GROUP_COORDINATOR | scope aprobado de grupo | solo si recibe permiso distinto | solo grant individual | coordina, no superadmin |
| SECTION_COORDINATOR | participantes de su sección | no por defecto | no por cargo; grant individual | gestión de sección |
| SECTION_DELEGATE | operaciones delegadas y temporales | no por defecto | no por cargo; grant individual | scope y expiración obligatorios |
| TREASURY | identidad mínima para conciliar | sí, según permiso | DENY | no gestiona roles generales |
| SECRETARY | identidad/administración aprobada | DENY por defecto | DENY | altas/bajas documentales |
| CRM_MANAGER | dataset mínimo aprobado para CRM | DENY por defecto | DENY | integración aún no aprobada |
| TECH_ADMIN | DENY datos ordinarios | DENY contenido financiero | DENY | infraestructura, deploy y logs técnicos limitados |

No existe `if role == ADMIN: allow everything`.

## 6. Scopes

Tipos previstos:

- `GROUP`: grupo completo solo para una capacidad concreta.
- `SECTION`: una o varias secciones y periodo.
- `RESOURCE`: participante, actividad, inscripción o expediente concreto.
- `SELF`: acciones sobre la propia cuenta.

Los scopes se aplican en la policy y en la query. Una comprobación solo en la UI o después de cargar toda la tabla no es válida.

## 7. Salud

`health.record.read` es deny-by-default. Para permitirlo deben coincidir:

1. usuario y sesión activos;
2. permiso sanitario explícito;
3. `HealthAccessGrant` para el participante concreto;
4. purpose autorizado;
5. periodo vigente y no revocado;
6. si procede, reautenticación reciente;
7. evento `SENSITIVE_DATA_READ` generado por backend.

La pertenencia a una sección ayuda a contextualizar, pero no concede salud.

## 8. Break-glass

Flujo:

1. solicitud con motivo, recurso y alcance;
2. aprobación por persona distinta cuando sea viable;
3. expiración corta obligatoria;
4. reautenticación/MFA;
5. banner visible y reason code en cada operación;
6. alerta al responsable y auditoría reforzada;
7. revocación inmediata y revisión posterior.

No permite exportación masiva por defecto ni acceso permanente. `TECH_ADMIN` debe usarlo solo cuando una incidencia técnica concreta lo haga imprescindible.

## 9. Algoritmo fail-closed

```text
authorize(context):
  deny if identity/session invalid
  deny if account.status != ACTIVE
  deny if permission not explicitly effective
  deny if section scope does not contain resource section
  deny if purpose is required and absent/not allowed
  deny if health and no valid participant grant
  deny if grant expired/revoked
  deny if step-up required and stale
  allow, then emit decision event
```

La resolución del recurso debe ser segura frente a BOLA. OWASP exige comprobar autorización sobre cada objeto recibido desde el cliente: <https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/>.

## 10. Ejemplos

### ALLOW

- `SECTION_COORDINATOR` con `participants.profile.read`, scope `TRO`, lee el perfil administrativo de un participante con membresía activa en `TRO`.
- `TREASURY` con `finance.fee.reconcile` concilia un pago y solo recibe nombre mínimo, referencia e importe.
- Responsable con grant `health.record.read` para `participant_id=P1`, purpose `activity-safety`, vigente durante una actividad, lee P1 y genera `SENSITIVE_DATA_READ`.

### DENY

- Coordinador de `TRO` intenta leer participante de `EST`.
- Coordinador de sección sin grant intenta leer salud de alguien de su propia sección.
- `TECH_ADMIN` intenta abrir una ficha de participante durante mantenimiento ordinario.
- `TREASURY` intenta consultar medicación o alergias.
- Cualquier usuario envía un `role` o `section_id` manipulado desde el navegador.
- Sesión válida de una cuenta `SECURITY_BLOCKED` intenta cualquier acción.
- Token familiar compartido intenta listar o consultar participantes.

## 11. Exportaciones

Las exportaciones masivas están **DISABLED BY DEFAULT**. Cada tipo futuro requiere permiso separado, purpose, filtro, límite de campos, step-up, caducidad del fichero y eventos `EXPORT_REQUESTED`, `EXPORT_ALLOWED/DENIED`, `EXPORT_DOWNLOADED`. No habrá botón genérico “exportar todo”.

## 12. Pruebas obligatorias

- matriz allow/deny por rol, permiso, sección y acción;
- cross-section y object ID tampering;
- rol múltiple sin escalada accidental;
- salud sin grant, grant expirado/revocado y purpose incorrecto;
- tech admin y treasury sin acceso lateral;
- suspensión con sesión ya emitida;
- Access JWT inválido, audiencia/issuer erróneos y origen directo;
- break-glass caducado y sin aprobación;
- exportaciones con campos o scope excesivos;
- property-based tests de políticas y tests de queries acotadas.
