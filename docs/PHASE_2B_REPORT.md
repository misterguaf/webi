# FASE 2B — backup, restore y resiliencia local

Fecha: 2026-09-23. Resultado: **PASS para el alcance local/sintético; NOT PRODUCTION READY**. La suite de entrada `npm run ci` pasó 83/83 antes de modificar código. No se creó ni consultó D1/R2 remoto; no se importaron datos reales, Sheets, Drive o CRM.

## Estrategia implementada

`gestio/scripts/recovery.js` usa Wrangler `d1 export --local` para extraer SQL de la D1 local, y `d1 execute --local --persist-to` para importarlo a una **D1 nueva**. No altera la D1 activa. El backup incluye tablas de identidad, sesiones (solo `token_hash`), roles, permisos, scopes, participantes ficticios, grants, audit events, incidentes y holds. El destino debe ser absoluto e inexistente; los destinos dentro del repositorio solo se permiten en las carpetas ignoradas `gestio/.local-backups/` y `gestio/.local-restores/`. La exportación requiere parar escrituras: no hay snapshot coordinado con un Worker concurrente.

Formato v1: `dump.sql` + `manifest.json`. Manifest no sensible: `backup_id`, `created_at`, `format_version`, `application_version`, `commit`, `schema_version`, lista/hash de migrations, hash de schema, inventario de objetos, recuentos por tabla, tamaño/hash SHA-256 del SQL, `environment=local-development`, `synthetic=true`. Es un checksum de corrupción accidental, **no** una firma de autenticidad frente a atacante con control de copia y manifest. El verificador comprueba SQLite `integrity_check`, foreign keys, nombres de migrations, tablas/índices/triggers requeridos, recuentos, fixtures sintéticos, invariantes de auth/hold y ausencia de patrones de secretos y de columna de token en claro. Rechaza formato, versión, hash o schema incompatibles.

El restore verifica **antes** de importar y **después** sobre D1 (`quick_check`, foreign keys, migrations, schema, recuentos e invariantes), publica atómicamente el nuevo directorio de estado y elimina temporales ante error. No hay modo permisivo ni overwrite. Migrations + seed crean una D1 sintética nueva; restore recupera un estado previo y no debe recibir seed posterior. Una migration defectuosa se revierte recuperando la copia pre-migration en un destino nuevo, no aplicando a ciegas una migration inversa.

## Drill y evidencia

`test/gestio-recovery.test.js`: D1 aislada vacía → 2 migrations → seed → login de varios perfiles → lectura con scope → audit events → incidente + hold → suspensión con revocación de sesión → backup → cambio defectuoso simulado que invalida rol Tropa → backup del estado defectuoso rechazado → restore aprobado a otra D1 → arranque del Worker contra la copia → autorización y auditoría verificadas. También rechaza dump truncado, versión de formato, versión de schema, checksum y canario secreto alterados, y overwrite de DB existente. Tras restore comprueba coordinador Tropa allow solo en Tropa, otra sección deny, TECH_ADMIN sin perfiles, Treasury sin salud, SECURITY_BLOCKED sin login, grant caducado deny, sesión persistida solo mediante hash, hold preservado durante lifecycle y escritura de nuevo evento. La guarda dev→prod sigue denegando egress. El ensayo no añade una migration defectuosa permanente.

La suite de entrada fue **83/83 PASS**. La CI final pasó **84/84**, lint/typecheck/schemas/guardas y `npm audit` (0 vulnerabilidades altas). También pasaron por separado `npm run db:backup:test`, `npm run db:restore:test` y `npm run disaster:drill`; los tres nombres ejecutan el mismo drill integral para mantener una sola fuente de invariantes. La prueba ejercita los comandos npm de crear, verificar y restaurar. El restore local medido en los últimos drills tardó ~10–15 s; esto no mide el RTO de producción. Se corrigió exclusivamente un test JWT preexistente que mutaba la cola base64 de una firma y podía dejarla decodificada sin cambios; el verificador de autenticación no se modificó.

## Objetivos provisionales

**RPO 24 horas** y **RTO 8 horas**, ambos `PROVISIONAL_OPERATIONAL_DECISION`, no aprobados. Una exportación independiente diaria ofrecería una pérdida máxima de aproximadamente un día si se verifica y conserva; Time Travel puede ayudar en fallos recientes, no en compromiso de cuenta. Ocho horas permiten intervención humana, verificación de permisos/supresiones y reapertura prudente para un grupo pequeño (~100 educandos) con disponibilidad moderadamente crítica. El drill local no prueba tiempos reales de Cloudflare ni recuperación de claves/configuración.

## Recomendación Cloudflare, no diseño de producción aprobado

D1 Time Travel puede recuperar cambios recientes en la misma cuenta; la ventana Free documentada es de hasta 7 días y el restore es in-place. Mantener exportación cifrada independiente para fallo/compromiso de cuenta. Si se elige R2 para copias con datos personales, bucket privado creado con restricción `jurisdiction = "eu"` y verificada; `weur` solo no basta. Aislar IAM y credenciales de backup de roles funcionales y considerar cuenta/medio independiente. Cifrado y gestión de claves: **REQUIRES EXTERNAL CONFIGURATION**; sin clave embebida. La estrategia puede caber en free tier a bajo volumen, condicionado al tamaño DB, tamaño/número de copias, operaciones D1/R2, Workers, retención y alertas. No hay proveedor alternativo introducido ni limitación D1 que lo justifique.

Fuentes: [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [límites D1](https://developers.cloudflare.com/d1/platform/limits/), [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

## Limitaciones y riesgos abiertos

- La copia local SQL no está cifrada; usar exclusivamente datos sintéticos. SHA-256 detecta corrupción, no alteración maliciosa con manifest recompuesto.
- El scan de patrones y los fixtures son defensa adicional, no prueba matemática de ausencia de cualquier secreto introducido fuera del diseño. No usar el CLI para una DB con datos reales.
- No existe copia independiente, scheduler, monitor de antigüedad, control de acceso remoto, registro administrativo duradero ni restore remoto. D1 Time Travel comparte cuenta y horizonte limitado.
- Backup D1 no protege configuración Cloudflare, Access, Workers, DNS, R2, Git ni secrets/KMS. Los objetos R2 tampoco están en esta copia.
- Un restore antiguo puede resucitar datos suprimidos o perder bloqueos posteriores. Deletion ledger/tombstone externo, re-aplicación y retención esperan decisiones jurídicas. Incident holds presentes en la copia sí sobreviven; posteriores no.
- La exportación debe hacerse sin escritores concurrentes; no existe una política de quiescence/consistency de producción ni verificación de consumo free tier en cuenta real.

## Decisiones necesarias antes de producción

1. Aprobar o ajustar RPO/RTO, titular/suplente, autoridad de restauración y frecuencia de drills.
2. Definir retención diaria/semanal/mensual con validación jurídica, supresión, bloqueo y ledger externo.
3. Aprobar ubicación de copia independiente, jurisdicción EU, IAM separado, cifrado/KMS, rotación y recuperación de claves.
4. Autorizar explícitamente staging/producción y verificar Access, DNS, D1/R2 EU, costes y restore remoto con datos sintéticos antes de datos reales.

## Readiness

**Sí para pasar a la siguiente fase funcional local con datos sintéticos, tras CI final PASS. No para producción, datos reales ni provisioning remoto.** [Runbook](runbooks/BACKUP_RESTORE.md), [política](BACKUP_POLICY_DRAFT.md), [desastres](DISASTER_RECOVERY.md).
