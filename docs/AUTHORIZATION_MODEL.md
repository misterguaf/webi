# Modelo de autenticación y autorización

Estado: **IMPLEMENTADO Y PROBADO SOLO EN GESTIO LOCAL SINTÉTICO — NOT PRODUCTION READY**

FASE 3A: permisos `activities.read`, `activities.manage`, `activities.general.manage`, `activities.registration.review`, `finance.payment.verify` y `auth.permission.authorize/provision/ratify`. Crear/editar/publicar/cerrar una actividad por secciones requiere alcance sobre **todas** sus secciones; la gestión de GENERAL usa permiso explícito independiente. El revisor de matching y pagos ve únicamente expedientes permitidos por su sección; TECH_ADMIN no hereda acceso funcional por administrar identidades. `delegated_permission` registra `authorized_by` distinto de `provisioned_by`, referencia, plazo, scope y estado `PENDING_RATIFICATION`→`RATIFIED`→`REVOKED`; solo ratificado y vigente es efectivo. En local se exige sesión reciente para provisionar/ratificar/revocar. Access/MFA y autoridad organizativa real siguen pendientes de configuración/verificación. [Pruebas 3A](PHASE_3A_REPORT.md).

FASE 3B: permisos `finance.fee.read`, `finance.fee.manage`, `finance.fee.payment.review`, `finance.fee.installment.authorize` y `finance.fee.config.manage`. Tesorería y Coordinación de Grupo reciben permisos explícitos en el seed sintético; TECH_ADMIN no recibe ninguno. La revisión de pagos de cuota es **delegable** con scope de sección, `authorized_by`, `provisioned_by`, referencia, ratificación, vencimiento y revocación; una transferencia multisección solo es visible al revisor con alcance sobre **todas** las secciones declaradas. `PENDING_RATIFICATION` no otorga acceso; el fixture previo de 3A se marca ratificado expresamente. El fraccionamiento exige **permiso efectivo y rol vigente TREASURY o GROUP_COORDINATOR**; no basta una delegación a otro rol. `GET /api/fees/review-rounds` entrega solo ID/código al revisor delegado, no configuración financiera ni métricas. [Pruebas 3B](PHASE_3B_REPORT.md).

FASE 3.5C.1: `finance.fee.status.read` es una capacidad independiente de consulta básica de estado de cuota para `SECTION_COORDINATOR` con grant explícito vigente. `GET /api/fees/status` devuelve únicamente ID/nombre de participante, código de su **sección actual** y estado autoritativo (`PENDING`, `PARTIAL`, `PAID`, `ISSUE`), además del ID/código de ronda. La query aplica el scope efectivo en D1; no expone importes, transferencias, evidencias ni asignaciones. No concede `finance.fee.read/manage/payment.review/config.manage` ni altera la autorización financiera existente. La migración 0010 concede el nuevo grant solo a responsables de sección existentes con lectura de participantes activa; futuras altas requieren el grant explícito. Participantes sin obligación en la ronda seleccionada no aparecen como pendientes por inferencia.

REMEDIACIÓN 3.5 (2026-09-29, [ADR-010](adr/ADR-010-permission-catalogue-capabilities.md)): cada permiso está declarado en `gestio/src/permissions.js` como `GLOBAL` o `SCOPED`. Una evaluación de sección exige `{sectionId}`, `{mode:'list'}` o `{mode:'all-sections'}`; si falta, deniega con `SCOPE_REQUIRED`. Un permiso GLOBAL exige un titular sin sección, excepto `activities.general.manage` (`scopedHolders: 'ALLOWED'`: los coordinadores de sección con grant gestionan actividades GENERAL, por decisión de producto). `GET /api/me` expone `capabilities`, orientativas y sin datos personales. Las delegaciones exigen la confirmación del autorizador nombrado, ratifica una persona distinta del provisionador y del destinatario y no se admite la autodelegación. Los roles `GROUP_COORDINATOR`, `TREASURY` y `TECH_ADMIN` solo los asigna una coordinación general, con auditoría `ELEVATED_ROLE`, y no se puede retirar ni desactivar a la última coordinación general. El alta de personas e identidades se hace con `auth.user.manage` e invitación Access. Las lecturas de un recurso fuera de alcance responden 404. La matriz por rol está en `test/gestio-permissions.test.js`.

FASE 3.5D (Activitats, [spec](design/screens/ACTIVITIES.md) §3.3): lectura y gestión de actividades GENERAL son capacidades distintas. Cualquier titular de `activities.read` (con cualquier alcance) lista y consulta actividades GENERAL; gestionarlas sigue exigiendo `activities.general.manage`. Una actividad por secciones se puede consultar con `activities.read` sobre al menos una de sus secciones (la misma regla que ya aplicaba el listado); gestionarla exige alcance sobre todas. Fuera de alcance, 404. Los recuentos de inscripciones del listado y del detalle se calculan en servidor con el alcance de `activities.registration.review` (igual que `GET /api/activities/:id/registrations`), se etiquetan `ALL`/`PARTIAL` y son `null` sin alcance de revisión. Toda escritura de actividades (editar, publicar, cerrar, descartar esborrany) exige `expectedVersion` y responde `409 stale_activity` si no coincide. Solo se descarta un DRAFT sin inscripciones (`ACTIVITY_DISCARDED`). Pruebas en `test/gestio-activities.test.js`.

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
- `CRM_MANAGER` (retirado en 3.5E; ver abajo)
- `TECH_ADMIN`

Una persona puede acumular roles, pero cada asignación conserva scope, vigencia, otorgante y justificación.

FASE 3.5E (Participants, [spec](design/screens/PARTICIPANTS.md)): se añaden permisos de gestión de participantes, todos con alcance por **sección actual** y aplicados server-side: `participants.profile.manage`, `participants.contact.read`, `participants.contact.manage`, `participants.guardian.manage` (SCOPED, delegables) y `participants.representation.accredit`, `participants.review.manage` (GLOBAL, no delegables). La matriz por defecto (migración 0015, reflejada en el seed) los concede a `GROUP_COORDINATOR` y `SECRETARY` a nivel de grupo, y los cuatro SCOPED a `SECTION_COORDINATOR` (su sección) y a `SECTION_DELEGATE` (para que una delegación individual sea efectiva). Un permiso sobre un participante nunca da acceso a otros participantes relacionados; las escrituras fuera de alcance responden 404 sin distinguir inexistente de otra sección. La concurrencia usa `participant.version` con el patrón `versionCas`. `SECRETARY` absorbe funcionalmente a `CRM_MANAGER`: este queda **retirado** —ya no se puede asignar por la API (`role_retired`)— pero su código y las asignaciones históricas se conservan (fijados por un CHECK en la migración 0001 y presentes en la auditoría) y no otorgan nada operativo; no hay conversión automática de identidades (retirada solo en el servicio, sin trigger, aprobada). Una relación participante–tutor terminada se conserva como historial inmutable y puede seguirse de una relación nueva con el mismo tutor (migración 0017); reanudarla exige `participants.guardian.manage` sobre **ese** participante y nunca da acceso a otros participantes del tutor. Pruebas en `test/gestio-participants.test.js` y `test/gestio-participants-episodes.test.js`.

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
