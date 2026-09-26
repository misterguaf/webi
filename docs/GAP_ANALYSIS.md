# Gap analysis

Fecha: **2026-09-22**
Comparación: árbol actual frente a los requisitos de FASE 0A y RC1.

Alcance: exclusivamente la infraestructura nueva de este repositorio. La web antigua actualmente publicada no forma parte del sistema evaluado. En este documento, **web pública** se refiere a `site/`.

## 1. Dictamen

La nueva web pública no requiere una reescritura. Sus activos estáticos, validadores, adaptadores y pruebas pueden evolucionar. El núcleo de gestión sí requiere una arquitectura nueva y separada: el repositorio actual no contiene identidad interna, autorización, base de datos, auditoría, segregación sanitaria/económica ni capacidades operativas de revocación.

La estrategia recomendada es **evolución por estrangulamiento**: conservar la superficie pública; estabilizar el portal familiar como canal de envío; crear `gestio` y su backend con fronteras nuevas; retirar gradualmente Sheets/Drive como repositorio operativo principal cuando exista una migración aprobada y verificada.

La plataforma objetivo ya no es una brecha abierta: [ADR-001](adr/ADR-001-cloudflare-first-eu.md) selecciona D1/R2 con jurisdicción `eu`, Workers/Static Assets, Access y Turnstile. Sigue pendiente implementarla y configurar recursos, sin crear nada remoto en esta fase.

## 2. Hallazgos priorizados

| ID | Clase | Hallazgo y evidencia | Riesgo | Acción propuesta |
|---|---|---|---|---|
| GAP-001 | **RESOLVED IN 0B-A** | `fersescout`, API y payload ya no admiten salud; Apps Script deja vacía la columna legacy. | La Sheet remota no se ha migrado ni inspeccionado. | Mantener el gate automático y migrar la columna solo con autorización operativa. |
| GAP-002 | **CRITICAL / ARCHITECTURAL** | No existen usuarios internos, MFA, estado de cuenta, sesiones individuales ni autorización backend. | Imposible construir `gestio` de forma segura sobre la base actual. | Crear identidad y policy engine antes de cualquier pantalla interna con datos. |
| GAP-003 | **HIGH / ARCHITECTURAL** | Sheets y Drive mezclan identidad, pagos y otros datos; el acceso depende de permisos externos de archivos. | Sin permisos por recurso/sección/finalidad, segregación ni audit log de aplicación. | D1 `eu` y servicios separados; Sheets solo como transición/exportación controlada. |
| GAP-004 | **RESOLVED IN 0B-A FOR LOCAL DEV** | El modo ordinario es sintético, no carga `.env` y la salida externa exige opt-in más allowlist en el adaptador. | La separación de cuentas/secrets remotos sigue sin verificar. | Mantener tests negativos y verificar staging cuando exista. |
| GAP-005 | **HIGH IF EXPANDED** | El portal familiar usa una contraseña compartida y una cookie no identificativa. | La filtración de la clave permite abuso; no hay atribución o revocación individual. | Mantenerlo solo como filtro de envío provisional. Prohibido habilitar lectura, búsqueda o fichas con esa sesión. |
| GAP-006 | **PARTIALLY MITIGATED** | Hay política por entorno, Node fijado y CI configurada; no existen aún cuentas, recursos ni promoción remota. | Configuración cruzada al provisionar sin un proceso aprobado. | Activar branch protection y diseñar promoción antes de staging. |
| GAP-007 | **HIGH / ARCHITECTURAL** | No existe audit log backend con actor, acción, recurso, resultado y motivo. | Accesos sensibles e incidentes no reconstruibles. | Diseñar eventos append-only y acceso restringido antes de `gestio`. |
| GAP-008 | **HIGH** | Los justificantes aceptan JPEG/PNG/WEBP/PDF por magic bytes iniciales y se guardan en Drive; no hay cuarentena ni escaneo. | Archivo malicioso o polyglot, exposición a quien revisa y retención descontrolada. | R2 Standard privado `eu`, nombre generado, cuarentena, escaneo, descarga forzada y política de borrado. |
| GAP-009 | **MEDIUM/HIGH** | El rate limit de formularios vive en memoria por instancia y Turnstile no está integrado; solo el login declara un binding Cloudflare. | Bypass en serverless/distribuido y abuso masivo de flujos sensibles. | Turnstile con Siteverify, rate limiting distribuido por endpoint/identidad/IP y reglas WAF verificadas. |
| GAP-010 | **RESOLVED IN CODE** | Workers y servidores locales comprueban longitud declarada y cortan el stream al superar el límite. | Falta prueba de límites sobre infraestructura Cloudflare real. | Repetir test de consumo en staging cuando se autorice. |
| GAP-011 | **HIGH / LEGAL_DECISION_REQUIRED** | No hay diseño verificado de backup/restore para D1/R2, cifrado de aplicación, baja o retención efectiva. | Pérdida, exposición o conservación indefinida. | Definir RPO/RTO y categorías; diseñar y ejecutar restore tests antes de producción. |
| GAP-012 | **HIGH / LEGAL_DECISION_REQUIRED** | Las páginas legales conservan 21 marcadores pendientes y el dominio canónico sigue como placeholder en el árbol. | Información incompleta y publicación prematura. | Cerrar decisiones y generar versión publicable aprobada. |
| GAP-013 | **MEDIUM / LEGAL_DECISION_REQUIRED** | Google Fonts e Instagram se cargan desde terceros; Instagram se inicia en portada. | Transferencias/cookies/telemetría antes de decisión final. | Autoalojar fuentes y revisar carga bajo consentimiento o sustitución del embed. |
| GAP-014 | **MITIGATED IN CI** | Escaneo local de alta confianza y Gitleaks v3 configurado en GitHub Actions. | Primera ejecución remota y push protection pendientes. | Hacer obligatorio el check y ensayar rotación. |
| GAP-015 | **RESOLVED IN 0B-A** | ESLint, `tsc --checkJs` gradual y validación Ajv se ejecutan en CI. | Ampliar la cobertura de tipos de forma incremental. | No bloquear avances por migración masiva; ampliar frontera por módulo. |
| GAP-016 | **MEDIUM** | No existe inventario de datos/retención ejecutable ni jobs de borrado/bloqueo. | Incumplimiento de políticas futuras y borrado manual no verificable. | Estados de ciclo de vida y jobs auditados por categoría. |
| GAP-017 | **MEDIUM** | No hay gestión de sesiones internas, reautenticación, revocación masiva o suspensión urgente. | Una sesión robada seguiría operativa. | Sesiones server-side revocables y evento transaccional de suspensión. |
| GAP-018 | **MEDIUM** | No hay exportaciones aún, pero tampoco un diseño de autorización o minimización para ellas. | Futura fuga masiva si se añaden como descarga genérica. | Export jobs con permiso específico, propósito, campos, caducidad y auditoría. |
| GAP-019 | **LOW** | `.claude/settings.local.json` contiene una ruta temporal antigua y `.DS_Store` está presente localmente. | Ruido y configuración local no reproducible. | Limpiar en una fase de mantenimiento, sin prioridad de seguridad. |

## 3. Capacidades que ya cumplen parcialmente

| Requisito | Estado actual | Brecha restante |
|---|---|---|
| Validación server-side | IMPLEMENTED/TESTED | Falta esquema compartido formal y límites de plataforma. |
| No confiar en precios del cliente | IMPLEMENTED/TESTED | Falta modelo económico persistente y autorización. |
| No enumeración familiar | IMPLEMENTED por ausencia de lecturas | Debe preservarse al crear APIs futuras. |
| Secrets fuera del frontend | IMPLEMENTED | Falta automatización y configuración externa verificada. |
| Cookies seguras y CSRF del portal | IMPLEMENTED/TESTED | La identidad sigue siendo compartida. |
| HMAC hacia Apps Script | IMPLEMENTED/TESTED LOCALLY | Falta monitorización, rotación y verificación real. |
| Fixtures sintéticos | IMPLEMENTED y gate local | Falta verificar staging externo. |
| Cabeceras web | IMPLEMENTED IN CONFIG | Falta verificación sobre el host real. |

## 4. Arquitectura reutilizable y piezas a sustituir

### Reutilizar

- HTML/CSS/JS público y su diseño.
- Validadores server-side, catálogos y cálculo server-side como lógica de referencia.
- Adaptadores HTTP y pruebas existentes.
- Separación actual entre Worker público y Worker familiar.
- HMAC/idempotencia como defensa transitoria hacia Apps Script.

### Encapsular y retirar gradualmente

- Google Sheets como base operativa.
- Google Drive como almacenamiento de justificantes.
- Apps Script como backend de negocio, correo y automatización financiera.
- Contraseña compartida como cualquier forma de identidad/autorización.

### Construir nuevo

- Backend confiable de gestión.
- D1 con jurisdicción `eu` y R2 privado con jurisdicción `eu`.
- Workers/Static Assets, Access y Turnstile.
- Identidad individual, sesiones y suspensión.
- Policy engine server-side.
- Auditoría e incidentes.
- Backups, restore, retención y borrado verificables.

## 5. Gates de continuidad

No es seguro avanzar a tratamiento real: siguen abiertos GAP-002 para `gestio`, los controles de ficheros, las decisiones jurídicas y toda verificación remota. GAP-001 y GAP-004 han quedado cerrados en código local. Sí es seguro iniciar la FASE 1 con identidad y policy engine vacíos, exclusivamente con fixtures sintéticos y sin provisionar recursos remotos.
