# FASE 0B-A — Informe de saneamiento y guardas

Fecha: **2026-09-22**
Alcance: **infraestructura nueva del repositorio; `site/` es la nueva web pública**
Fuera de alcance: **la web antigua actualmente publicada**
Provisioning remoto realizado: **ninguno**

## 1. Dictamen

La FASE 0B-A queda completada para trabajo local y CI: el desarrollo ordinario es sintético y sin egress, la lista de espera ya no acepta datos de salud, los cuerpos HTTP se limitan durante la lectura y existe una baseline reproducible de lint, `checkJs`, schemas, guardas, tests, audit y secret scanning.

Esto **no** convierte el sistema en production-ready. D1, R2, Access y Turnstile no se han creado ni activado remotamente; el policy engine, la identidad individual, la auditoría de aplicación, la cuarentena de ficheros y las decisiones jurídicas siguen pendientes.

## 2. Cambios implementados

### 0B.1 — Desarrollo sintético y egress fail-closed

- `npm run dev`, `npm run dev:site` y el launcher arrancan con Sheets simulado y no cargan `.env`.
- `npm run dev:site:integration` es el único comando local para integración real.
- La integración exige simultáneamente `ALLOW_REAL_EGRESS=true` y el origen exacto en `DEV_EGRESS_ALLOWLIST`.
- `api/_lib/environment.js` vuelve a comprobar la salida justo antes del `fetch`; cambiar el launcher o conservar un `.env` antiguo no basta para saltarse la guarda.
- Development, test y staging se consideran entornos restringidos. El portal local conserva únicamente credenciales y endpoints ficticios.
- Fixtures reutilizables: `Participant Test 001`, `Guardian Test 001` y `example.test`.

### 0B.2 — Lista de espera sin salud

- Eliminado el textarea de alergias/necesidades de `site/fersescout.html`.
- Eliminado `notes` del modelo validado y del payload de alta hacia Apps Script.
- El backend rechaza el antiguo campo `notes` y nombres sanitarios equivalentes; no se limita a ignorarlos silenciosamente.
- Apps Script conserva vacía la columna histórica y la marca `LEGACY_FIELD_PENDING_MIGRATION`. No se ha inspeccionado, modificado ni borrado ninguna Sheet remota.
- Actualizados privacidad, README, checklist, threat model, manifiesto de textos, ADR y tests.
- Añadido un gate que falla si vuelve a aparecer un textarea/campo sanitario o `notes` en el payload de alta.

### 0B.3 — Baseline de ingeniería

- Node 24 y npm 11.16.0 fijados mediante `.nvmrc`, `engines`, `packageManager` y lockfile.
- ESLint 10, TypeScript 7 con `checkJs` gradual y Ajv para JSON Schema.
- GitHub Actions ejecuta install reproducible, lint, typecheck, schemas, guardas Cloudflare/lista de espera/secretos, tests, audit y `git diff --check`.
- Gitleaks v3 queda configurado como job separado. La primera ejecución remota aún debe verificarse.
- Escaneo local de secretos de alta confianza ejecutado sin coincidencias; nunca imprime el contenido detectado.
- El audit cubre también las dependencias de desarrollo.

La protección de rama y la obligatoriedad de checks son configuración externa y siguen pendientes.

### 0B.4 — Cloudflare-first preparado, sin recursos remotos

- Inventario conceptual por entorno en `infra/cloudflare-resources.example.json`.
- Desarrollo y staging declaran `synthetic-only`; el fichero exige `remoteProvisioningAuthorized=false`.
- D1 y R2 personal/documental declaran `jurisdiction="eu"`; R2 permanece privado.
- La guarda automática rechaza `weur` como jurisdicción y cualquier binding D1/R2 futuro que no declare `jurisdiction = "eu"`.
- ADR separados para D1 EU, R2 EU privado, Access, desarrollo sintético y exclusión de salud.
- Access queda definido como frontera de identidad/MFA; el backend deberá validar su JWT y el policy engine seguirá resolviendo autorización por recurso.
- Existe un adaptador Turnstile con modo sintético que falla en producción y valida `success`, hostname y action. No está conectado a los formularios: faltan widget, CSP, secret por entorno, Siteverify E2E y control de replay.

## 3. Revisión de superficies

| Superficie | Rutas actuales | Resultado 0B-A |
|---|---|---|
| Worker público | `POST /api/alta`, `POST /api/reserva` | inventario cerrado; desconocidas devuelven 404 |
| Portal familiar | sesión GET/POST/DELETE, config GET, inscripción POST, cuota POST | sin listados ni lectura de participantes |
| Gestión interna | no existe | se mantiene fuera hasta FASE 1 |

Controles revisados:

- tipos de contenido explícitos: JSON y, solo donde procede, formulario URL-encoded;
- `Content-Length` como rechazo temprano más contador real del stream;
- 16 KiB para alta/reserva, 2 KiB para login y 8 MiB para formularios con justificante;
- errores externos genéricos, `Cache-Control: no-store` y sin payloads en logs;
- CSP y cabeceras existentes conservadas; no se añaden orígenes Turnstile antes de integrarlo;
- rate limiter encapsulado, pero todavía en memoria salvo el binding Cloudflare del login;
- ausencia de rutas familiares de búsqueda/listado, preservando la no enumeración.

## 4. Evidencia ejecutada

| Comando/control | Resultado |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run schema:check` | PASS |
| `npm run cloudflare:check` | PASS |
| `npm run waitlist:check` | PASS |
| `npm run secrets:check` | PASS, sin coincidencias |
| `npm test` | PASS: 78/78 |
| `npm audit --audit-level=high` | PASS: 0 vulnerabilidades, 84 paquetes auditados |
| `npm run ci` | PASS local |
| Arranque seguro + GET + alta sintética | PASS en `127.0.0.1:4199`; log confirma que no se envió nada |
| Gitleaks v3 | configurado en CI; ejecución remota pendiente |

Los tests negativos cubren egress bloqueado, doble opt-in, campos sanitarios legacy, ausencia de `notes` en el payload, content type inválido, longitud declarada excesiva, stream excesivo, rutas no declaradas y modo Turnstile de prueba prohibido en producción.

## 5. Riesgos corregidos

- Envío accidental desde el comando local ordinario hacia Google/producción.
- Reintroducción de salud en la lista de espera por interfaz o cliente antiguo.
- Acumulación completa de bodies sobredimensionados antes del rechazo.
- Ausencia de lint, typecheck gradual, validación de schemas y CI reproducible.
- Falta de guarda local verificable para jurisdicción D1/R2.
- Ausencia de secret scan automatizado en el pipeline.

## 6. Riesgos y decisiones abiertos

1. La Sheet remota puede conservar una columna y datos históricos de `Notes`; su migración/borrado exige autorización y procedimiento, no se ha tocado.
2. La contraseña familiar sigue siendo compartida. Solo es admisible mientras el portal no permita leer, buscar ni listar fichas.
3. Rate limiting distribuido, WAF y Turnstile completo siguen pendientes.
4. Los justificantes siguen en la arquitectura transitoria de Drive, sin cuarentena ni análisis antimalware.
5. Access, IdP, MFA, validación JWT, usuarios individuales, sesiones revocables y policy engine no existen todavía.
6. D1/R2 remotos, bindings, backups, restore, RPO/RTO y monitorización del free tier no existen todavía.
7. Las páginas legales mantienen decisiones organizativas pendientes; no hay autorización para datos reales.
8. Branch protection, required checks, Gitleaks remoto y push protection deben activarse/verificarse en GitHub.
9. Falta decidir `inscripcions` frente a `inscripciones` antes de DNS, cookies, CORS y Access.
10. No hay request IDs ni audit log de aplicación; deben entrar con la base de FASE 1/2.

## 7. Decisiones consolidadas

- Proveedor objetivo: Cloudflare Workers/Static Assets, D1, R2, Access y Turnstile.
- Coste objetivo inicial: 0 €/mes dentro de free tiers, con métricas y gates antes de producción.
- D1: creación futura con jurisdicción `eu`; `weur` no es sustituto.
- R2 personal/documental: creación futura privada con jurisdicción `eu` y binding explícito.
- No introducir PostgreSQL, Supabase, Neon, Firebase u otro proveedor sin ADR de excepción con limitación, impacto, alternativa, coste e impacto jurídico/residencia.
- La lista de espera no es un canal sanitario.
- No crear recursos remotos sin autorización explícita.

## 8. Gate hacia FASE 1

**YES — se puede iniciar la FASE 1, exclusivamente con identidad sintética y un policy engine deny-by-default, sin datos reales y sin provisionar recursos remotos.**

**NO — no se puede desplegar para tratamiento real ni considerar production-ready.** Antes harán falta autorización de provisioning, decisiones jurídicas, configuración externa verificable y cierre de los riesgos abiertos correspondientes.
