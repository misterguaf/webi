# ADR-009 — El portal familiar accede a Gestió solo mediante `PortalIntake`

Estado: **ACEPTADO PARA LOCAL/SINTÉTICO; PRODUCCIÓN PENDIENTE DE DESPLIEGUE AUTORIZADO** (2026-09-29, remediación 3.5, hallazgo A1).

## Contexto

`portal/` es un Worker público protegido solo por una contraseña compartida. Hasta la fase 3B importaba servicios de `gestio/src/` y enlazaba la misma D1/R2 que Gestió, de modo que cualquier fallo del portal o de su código importado alcanzaba toda la base: participantes, roles, sesiones, auditoría, grants de salud y tesorería. D1 no ofrece permisos por tabla.

## Decisión

- El portal **no tiene bindings de datos** (D1, R2, KV ni Durable Objects) en ningún entorno.
- Gestió exporta un entrypoint con nombre, `PortalIntake`, alcanzable solo por *service binding* (`GESTIO_INTAKE`). No está enrutado desde el `fetch` público de Gestió.
- Contrato v1, solo `POST` y JSON: `/v1/catalog`, `/v1/registrations`, `/v1/fees`. Claves en lista blanca, versiones de textos legales fijadas por Gestió, respuestas idénticas para coincidencia clara, ambigua o inexistente y ningún candidato ni identificador interno en la respuesta, salvo la referencia de pago que ya se devolvía.
- `environment-policy.js` decide si el intake está abierto: sí en `local-synthetic` y `test`, no en `production` hasta la puesta en marcha.
- Se descarta una segunda D1 con sincronización: el service binding es viable (verificado en workerd local, en un proceso y en dos) y evita duplicar datos personales.

## Consecuencias

- `scripts/check-cloudflare-config.js` (CI) rechaza bindings de datos en el portal y exige el entrypoint.
- En local, el portal necesita el Worker de Gestió en marcha (el launcher arranca ambos). Los tests usan un registro de desarrollo privado (`WRANGLER_REGISTRY_PATH`): con el registro global, el binding puede resolverse contra otra instancia con el mismo nombre.
- En producción, el Worker `parpallo-gestio` debe existir antes de desplegar el portal; el binding falla cerrado mientras no exista.
- `family/` (DEPRECATED, solo local) sigue importando servicios con su propia D1 local; no debe desplegarse y se retirará cuando el portal esté en producción.
