# FASE 3.5G.1A — Seguridad previa y autorización financiera

Estado: **IMPLEMENTADA — LOCAL / SYNTHETIC ONLY — pendiente de revisión Borja/Atlas**. Rama
`phase/3.5g-treasury` desde `phase-3.5g0-complete` (`13e5f00`). Sin merge ni tag de 1A. Especificación:
[TREASURY.md](design/TREASURY.md) §25.3 y §27.1. No se ha empezado el nuevo dominio financiero.

## Auditoría del motor de autorización (antes del cambio)

- Autoridad efectiva (`effectiveSections`/`effectiveGrants`): (1) rol vigente cuyo `role_permission`
  contiene el permiso **y** grant individual vigente; o (2) `delegated_permission` ratificada, no
  revocada, no caducada (o sin caducidad), **siempre que algún rol vigente del delegado contenga el
  permiso** (techo de rol) con sección compatible.
- Una delegación no podía conceder una capacidad que el rol no trajera. `SECTION_DELEGATE` tenía en su
  techo `finance.payment.verify` y `finance.fee.payment.review`: era la única vía de una delegación
  financiera a quien no fuera Tesorería o Coordinación general.
- Alcance: `section_id` (NULL = todo el grupo); caducidad en `expires_at`; revocación en
  `revoked_at`/`ratification_status`. Gobierno de delegaciones (0013): autorizador nombrado que confirma,
  ratificación por otra persona, sin autodelegación. Duración 90 días por defecto, máximo 365.
- La tabla `role` tiene un `CHECK` de códigos (0001): un rol nuevo exigía reconstruirla.

## Decisión técnica

Sin rol nuevo y sin reconstruir `role`. Los permisos marcados `financialDelegation` en
`gestio/src/permissions.js` (`finance.payment.verify`, `finance.fee.payment.review`,
`finance.fee.contact.read`) son efectivos por (a) rol + grant (Tesorería, Coordinación general) o (b) una
delegación ratificada **con caducidad**, evaluada **sin techo de rol**. Para no delegar lo que no se
tiene, el autorizador nombrado debe tener la misma capacidad (rol + grant) sobre el alcance delegado.
Las delegaciones no financieras mantienen el techo de rol.

## Cambios

- **Migración 0022** (aditiva, sin reconstrucciones): quita los permisos financieros del techo de
  `SECTION_DELEGATE`; revoca (conservando historial) los grants de esos permisos que ningún rol vigente
  sostiene; crea `finance.fee.contact.read` para Tesorería y Coordinación general y lo concede a quien ya
  revisaba pagos de cuota con esos roles. Seed sintético alineado.
- **Motor** (`domains/organization/repository.js`): tres fuentes de autoridad en una consulta común.
- **Delegaciones** (`delegation-service.js`): regla del autorizador para permisos financieros; los
  eventos `DELEGATED_PERMISSION_GRANTED/RATIFIED/REVOKED` llevan `reason_code=FINANCIAL_DELEGATION`.
- **Quotes** (`annual-fee-service.js`): listado sin nombre ni correo del remitente (añade
  `people_count`); detalle con proyección explícita (sin contacto, `idempotency_key`, `payload_sha256`,
  aviso de privacidad ni fecha declarada; incluye metadatos del justificante); nuevo
  `GET /api/fees/payments/:id/contact` (permiso `finance.fee.contact.read`, mismo alcance que el pago,
  auditado `SENSITIVE_DATA_READ`/`FEE_CONTACT_CONSULTED` sin valores).
- **Justificantes de cuota**: `GET /api/fees/evidence/:id?mode=view|download`, tipo detectado, nombre
  seguro, `no-store`, auditado `FEE_EVIDENCE_VIEWED`/`FEE_EVIDENCE_DOWNLOADED`; fuera de alcance, 404.
- **UI de Quotes**: listado por fecha y número de educandos; «Mostra el contacte» solo con la capacidad;
  «Veure justificant» y «Descarrega». Capacidad `fees.readContacts` en `/api/me`.

## Matriz efectiva (seed sintético)

| Usuario | Antes | Después |
|---|---|---|
| Tesorería (104) | revisión/verificación de pagos, correo en listados | igual + contacto bajo demanda auditado |
| Coordinación general (101) | igual que Tesorería | igual + contacto bajo demanda auditado |
| Coordinación de sección (102) | solo estado básico en su sección | sin cambios |
| Delegado de sección (105) | finanzas posibles por techo de rol + grant/delegación | ninguna autoridad financiera por el rol |
| Usuario sin rol con delegación financiera ratificada | imposible (sin techo) | solo la capacidad delegada, en su sección, hasta caducar o revocarse |
| TECH_ADMIN (107) | sin finanzas | sin cambios |

## Tests

`test/gestio-financial-delegation.test.js` (6): privacidad de listados/detalle y contacto con permiso y
auditoría; justificantes vista/descarga auditados, sin permiso 403, fuera de alcance 404; delegado de
sección sin finanzas incluso con grant antiguo; delegación financiera (pendiente no efectiva, alcance,
capacidades no concedidas, caducada, revocada, sin fecha, autorizador sin capacidad, auditoría);
regresión de matriz y `/api/me`; migración 0022 sobre datos previos. Ajustados: recuperación (esquema 22)
y 3B (el detalle ya no expone la fecha declarada).

## Deuda restante

- Retención de justificantes y de datos bancarios: LEGAL DECISION REQUIRED.
- La interfaz de Quotes sigue siendo la funcional de 3B (rediseño reservado).
- La caducidad se evalúa en cada petición; no hay evento propio de caducidad (los denegados quedan como
  `AUTHZ_DENY`).
- `finance.fee.reconcile` sigue reservado; lo sustituirá `finance.reconcile` en 3.5G.3.
