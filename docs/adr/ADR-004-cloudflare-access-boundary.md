# ADR-004 — Cloudflare Access como frontera de identidad, no de autorización

## STATUS

Aceptado como arquitectura objetivo; configuración remota pendiente de autorización.

## CONTEXT

La gestión interna futura necesita identidad individual y MFA. La contraseña compartida del portal familiar no identifica a una persona ni permite permisos por participante, sección o finalidad.

## DECISION

Cloudflare Access protegerá `gestio` y aportará identidad federada. El backend validará firma, issuer, audience, expiración y claims permitidos del JWT. Access no concederá acceso a datos de negocio: el policy engine de aplicación seguirá siendo deny-by-default y resolverá cada recurso/acción.

## CONSEQUENCES

- La caída o mala configuración de Access debe fallar cerrada.
- No habrá bypass de desarrollo posible en producción.
- MFA, IdP, audiencia y grupos son configuración externa que requiere evidencia.

## ALTERNATIVES

- Contraseña compartida: descartada para gestión interna.
- Autorización basada solo en grupos de Access: descartada por falta de granularidad de recurso/finalidad.

## OPEN QUESTIONS

- Elegir IdP y padrón inicial de usuarios.
- Aprobar política MFA, grupos de entrada y procedimiento de suspensión urgente.
