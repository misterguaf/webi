# ADR-007 — D1 local, sesiones propias y frontera de autorización de gestio

Estado: **ACEPTADO PARA PROTOTIPO LOCAL, NO PARA PRODUCCIÓN** (2026-09-22).

## Contexto y decisión

`gestio/` es un Worker independiente de `site/` y `portal/`. D1 local es la única persistencia de FASE 1; el binding usa un UUID reservado de prueba. Las migraciones SQL numeradas son la fuente del esquema y `seed.sql` contiene exclusivamente datos ficticios. `gestio:reset` borra solo `gestio/.wrangler/state`, migra y siembra. Ningún comando de desarrollo usa `--remote`.

La jurisdicción **no es una propiedad válida del binding Wrangler** (Wrangler 4.135.0 la advierte como desconocida). Se fija **al crear la base remota**, operación no autorizada aún, y deberá usarse `wrangler d1 create ... --jurisdiction=eu` con posterior comprobación de metadatos. `weur` no equivale a jurisdicción. El plan `infra/cloudflare-resources.example.json` conserva esta exigencia, pero no prueba residencia de un recurso inexistente.

Cloudflare Access verifica identidad y MFA cuando se configure. El adaptador valida RS256, JWKS, `kid`, `iss`, `aud`, `type`, `sub`, `iat`, `nbf` y `exp`, y mapea `(issuer,subject)` a `auth_identity`. El email no es clave. Tras el intercambio se emite token de sesión opaco aleatorio; D1 guarda solo SHA-256. La cookie es `__Host-gestio_session; Secure; HttpOnly; SameSite=Strict; Path=/` fuera de localhost. Solo en localhost se usa `gestio_session` sin `Secure`. Idle 30 min y absoluto 8 h son provisionales. Cada petición revalida sesión y estado en D1. Logout, revocación individual/global y suspensión tienen efectos inmediatos en decisiones nuevas.

La policy central exige rol vigente **y** permiso explícito vigente; ni uno ni otro concede por sí solo. `SECTION` limita las consultas SQL mediante `WHERE current_section_id IN (...)`, no tras cargar la tabla. Salud requiere además grant individual, purpose y tiempo, y solo se prueba una decisión sin datos sanitarios. `TECH_ADMIN` y `TREASURY` carecen de permiso de perfil o salud. La suspensión usa `D1Database.batch`, que Cloudflare documenta como transacción que revierte el lote ante error; bloquea cuenta, sesiones y grants, y añade evento mínimo. No coordina todavía el bloqueo del IdP ni sustituye una revisión operativa.

## Actualización 2026-09-29 (remediación 3.5)

La policy se rige ahora por el catálogo explícito GLOBAL/SCOPED de [ADR-010](ADR-010-permission-catalogue-capabilities.md); una evaluación de sección sin alcance falla cerrado. El catálogo de secciones, roles, permisos y matriz por defecto vive en la migración 0012, no solo en `seed.sql`. Las identidades se provisionan por invitación de correo verificado, ligada en el primer login de Access (no hay autorregistro). Las reglas de entorno están centralizadas en `gestio/src/environment-policy.js`.

## Consecuencias y límites

- `gestio/` no comparte contraseña familiar ni rutas de `portal/`.
- En desarrollo solo se puede elegir entre identidades ficticias en `127.0.0.1`; `APP_ENV=production` con `DEV_IDENTITY_PROVIDER=enabled` falla cerrado.
- Los comandos locales comprueban configuración de desarrollo antes de arrancar y `gestio:deploy` se bloquea deliberadamente; el gate CI rechaza el cambio de la configuración local a producción. Un `wrangler deploy` directo sigue prohibido por proceso y deberá reemplazarse por pipeline con autorización y controles de residencia antes de habilitarse.
- No se crean tablas clínicas ni económicas de contenido, recursos Cloudflare remotos ni identidad real.
- Pendientes: MFA/Access reales, step-up fuerte para suspensión, protección operativa del origen, auditoría completa, retención, backup/restore, validación legal y revisión independiente de seguridad.

Fuentes técnicas: [D1 local y `--local`](https://developers.cloudflare.com/d1/best-practices/local-development/), [transacciones de `batch`](https://developers.cloudflare.com/d1/worker-api/d1-database/), [jurisdicción en creación](https://developers.cloudflare.com/d1/configuration/data-location/), [JWT Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
