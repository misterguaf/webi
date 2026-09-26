# ADR-001 — Infraestructura Cloudflare-first con jurisdicción UE

Fecha: **2026-09-22**
Estado: **ACEPTADO**
Alcance: primera versión de la nueva infraestructura Parpalló.

## Contexto

El sistema necesita persistencia relacional, almacenamiento privado de documentos, cómputo serverless, acceso privado y protección anti-bot. Para la primera versión se prioriza un coste de infraestructura de **0 €/mes** mientras el volumen real permanezca dentro de los free tiers de Cloudflare.

Esta decisión selecciona tecnología y residencia objetivo. No crea recursos, no aprueba por sí sola contratos o tratamientos y no autoriza datos reales.

## Decisión

| Capacidad | Proveedor objetivo | Restricción obligatoria |
|---|---|---|
| Base de datos | Cloudflare D1 | crear desde el inicio con jurisdicción `eu` |
| Objetos privados | Cloudflare R2 Standard | buckets con datos personales/documentos creados con jurisdicción `eu` |
| Cómputo y web | Cloudflare Workers / Static Assets | usar cuando sea técnicamente adecuado |
| Acceso privado | Cloudflare Access | primera barrera de `gestio`; no sustituye autorización backend |
| Anti-bot | Cloudflare Turnstile | validación obligatoria en servidor además del widget |

No se introducirá PostgreSQL, Supabase, Neon, Firebase ni otra base de datos mientras D1 satisfaga los requisitos.

## Restricciones de creación

### D1

La creación futura deberá usar jurisdicción, no un location hint:

```bash
npx wrangler@latest d1 create parpallo-production --jurisdiction=eu
```

- Prohibido sustituirlo por `--location=weur`: `weur` es una preferencia de ubicación, no una restricción jurisdiccional.
- Prohibido crear primero la base y “corregirla después”: Cloudflare no permite añadir o cambiar la jurisdicción tras la creación.
- Antes de enlazar una base remota, verificar mediante dashboard/API que su metadato es `jurisdiction: "eu"`.
- Development y tests usarán D1 local con datos sintéticos hasta que exista autorización expresa para crear recursos remotos.

### R2

Todo bucket que pueda contener justificantes, documentos o datos personales deberá crearse así:

```bash
npx wrangler@latest r2 bucket create parpallo-documents-production --jurisdiction=eu
```

El binding futuro deberá conservar la jurisdicción:

```toml
[[r2_buckets]]
binding = "PRIVATE_DOCUMENTS"
bucket_name = "parpallo-documents-production"
jurisdiction = "eu"
```

- No usar únicamente `location = "weur"` ni un location hint.
- La jurisdicción del bucket no se puede cambiar después.
- El bucket permanece privado: sin `r2.dev`, sin dominio público y sin listados.
- El acceso será mediado por backend autorizado o por URL firmada breve cuando el diseño la justifique.
- La primera versión usará almacenamiento **Standard**, porque el free tier no cubre Infrequent Access.

### Turnstile

- Widget y credenciales separados por entorno.
- Sitekey pública; secret únicamente en secretos del Worker.
- Verificación server-side mediante Siteverify en cada envío protegido.
- Validar `success`, hostname y action esperados; tokens de un solo uso y cinco minutos.
- Turnstile complementa validación, rate limiting y honeypot; no los sustituye.

## Objetivo económico y límites de diseño

Snapshot de precios/límites consultado el **2026-09-22**:

| Servicio | Free tier relevante |
|---|---|
| Workers | 100.000 requests/día; 10 ms CPU por invocación |
| D1 | 5 millones de filas leídas/día; 100.000 escritas/día; 5 GB totales |
| R2 Standard | 10 GB-mes; 1 millón Class A/mes; 10 millones Class B/mes; egress sin cargo |
| Access | hasta 50 usuarios en Zero Trust Free; retención estándar de logs de hasta 24 h |
| Turnstile | gratuito; hasta 20 widgets y 10 hostnames por widget; challenges sin límite publicado |

El objetivo de 0 €/mes no es una garantía indefinida. Antes de producción se configurarán métricas/alertas y un presupuesto operativo. Las consultas D1 deben usar índices y evitar full scans; documentos y versiones R2 tendrán lifecycle; los Workers de seguridad deben fallar cerrados al alcanzar límites.

Los precios y límites se volverán a verificar en la fecha de cada despliegue o revisión presupuestaria.

## Consecuencias técnicas

- El modelo y las migraciones usarán semántica SQLite/D1; no se diseñarán alrededor de extensiones o tipos exclusivos de PostgreSQL.
- D1 será la fuente transaccional de identidad, administración, salud, economía y auditoría lógica, manteniendo fronteras de acceso en repositorios/servicios.
- R2 almacenará binarios; D1 solo guardará metadatos, estado, hash, propietario lógico y clave de objeto.
- La restricción `eu` de D1/R2 no regionaliza por sí sola todo el tráfico, ejecución de Workers, Access, logs o proveedores externos. Contratos, subencargados, transferencias y controles adicionales siguen requiriendo validación jurídica/técnica.
- Backups, restore, malware scanning y cifrado de campos sensibles siguen siendo decisiones/implementaciones pendientes; elegir D1/R2 no satisface automáticamente esos controles.

## Gate para cambiar de proveedor

Antes de proponer o adoptar otra base de datos u object storage deberá existir un ADR nuevo que documente:

1. limitación concreta y reproducible de D1/R2;
2. impacto funcional, operativo o de seguridad;
3. alternativa evaluada;
4. coste inicial y coste esperado por volumen;
5. impacto jurídico, contractual y de residencia de datos.

Una preferencia personal, una posible escala futura o una funcionalidad no requerida no bastan para abrir ese cambio.

## Estado de ejecución

- Decisión técnica: **ACEPTADA**.
- Recursos Cloudflare remotos: **NO CREADOS**.
- Bindings D1/R2 en el repositorio: **NO IMPLEMENTADOS**.
- Turnstile: **NO IMPLEMENTADO**.
- Access para `gestio`: **NO CONFIGURADO**.
- Datos reales: **PROHIBIDOS HASTA GATE FORMAL**.

## Referencias oficiales

- D1 data location: <https://developers.cloudflare.com/d1/configuration/data-location/>
- D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/>
- R2 data location: <https://developers.cloudflare.com/r2/reference/data-location/>
- R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Access pricing: <https://www.cloudflare.com/plans/>
- Turnstile plans: <https://developers.cloudflare.com/turnstile/plans/>
- Turnstile server validation: <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>
