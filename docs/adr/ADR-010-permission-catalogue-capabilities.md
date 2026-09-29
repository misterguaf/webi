# ADR-010 — Catálogo explícito de permisos y capacidades efectivas

Estado: **ACEPTADO** (2026-09-29, remediación 3.5, hallazgos M1, M2 y M3).

## Contexto

`authorize()` concedía a un titular con alcance de sección cuando no se pasaba `sectionId`; la seguridad dependía de que cada llamada filtrase por `decision.sections`. El frontend descubría sus permisos provocando 403, lo que llenaba la auditoría de `AUTHZ_DENY`. Las delegaciones registraban un `authorized_by` declarado por quien las provisionaba, sin ninguna acción del autorizador.

## Decisión

1. **Catálogo** (`gestio/src/permissions.js`). Cada permiso es:
   - `GLOBAL`: recurso de grupo. Exige una asignación sin sección, salvo `scopedHolders: 'ALLOWED'`, que hoy solo tiene `activities.general.manage` por decisión de producto (los coordinadores de sección gestionan actividades GENERAL).
   - `SCOPED`: toda evaluación declara `{sectionId}`, `{mode:'list'}` o `{mode:'all-sections'}`; si no, se deniega con `SCOPE_REQUIRED`.
   - No hay tipo CONTEXTUAL: las operaciones de grupo de un permiso de sección usan `all-sections`.
2. **Una sola función de decisión** (`decideScope`), compartida por la política y por la proyección de capacidades.
3. **`GET /api/me` → `capabilities` v1.** Alcances por código de sección, sin datos personales ni importes. Es orientativo: el servidor sigue autorizando cada operación.
4. **Gobierno de privilegios** (migración 0013):
   - El autorizador nombrado confirma en Gestió.
   - Ratifica otra persona distinta del provisionador y del destinatario.
   - No hay autodelegación.
   - Los roles `GROUP_COORDINATOR`, `TREASURY` y `TECH_ADMIN` solo los asigna una coordinación general vigente, con auditoría `ELEVATED_ROLE`.
   - La última coordinación general no se puede retirar ni desactivar (la suspensión de seguridad sigue siendo posible).
   - Las garantías están en el servicio y, en lo inequívoco, en triggers.
5. **Hook de reautenticación:** `requireFresh` usa `RECENT_AUTHENTICATION_MS` de `environment-policy.js`. Requisito de producción: sesión nacida de un login reciente de Access con MFA.

## Consecuencias

Añadir un permiso requiere declararlo en el catálogo; un test compara catálogo y esquema. Quedan como DECISION REQUIRED: la aprobación a dos personas de roles elevados, el vencimiento obligatorio de esos roles y la compatibilidad `TECH_ADMIN` + roles con datos en la misma persona.
