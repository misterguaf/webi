# Runbook: backup y restore de `gestio` local

Estado: **FASE 2B/3A/3B, solo D1 local y datos sintéticos**. No usar con datos reales ni recursos Cloudflare remotos. Requiere Node 24, dependencias instaladas (`npm ci`), `sqlite3` en `PATH` y `gestio/wrangler.toml` de desarrollo con el ID D1 ficticio. Ejecutar desde la raíz del repositorio. Los comandos no aceptan rutas relativas, no sobrescriben destinos y validan el backup antes de importarlo.

**Límite 3A/3B:** la copia cubre actividades, inscripciones, ronda de cuota, agrupaciones familiares, obligaciones, pagos, allocations y sus historiales de cambios, fraccionamientos, incidencias, auditoría, metadata de justificantes, delegaciones y outbox D1; **no copia binarios del R2 emulado**. Para recuperar descargas de actividades o cuotas se necesita copia independiente de objetos y reconciliación de `object_key`/SHA-256 antes de abrir el sistema. Sin ella, la descarga falla cerrada. No declarar restauración completa de producción. `test/gestio-3b.test.js` prueba el restore poblado de cuota y FK.

## Crear y verificar una copia

1. Detener `npm run dev:gestio` u otro Worker local que escriba la D1. No exportar mientras cambian las tablas: el script no implementa una barrera transaccional de escritura entre aplicación y exportación.
2. Si se parte de una D1 sintética vacía, ejecutar `npm run gestio:migrate` y `npm run gestio:seed`. Esto **crea fixtures**, no recupera datos anteriores. No ejecutar seed sobre un restore.
3. Crear un directorio padre ignorado por Git y elegir un nombre de copia nuevo:

```sh
mkdir -p gestio/.local-backups
npm run db:backup -- --output "$(pwd)/gestio/.local-backups/backup-prueba-001"
npm run db:backup:verify -- --backup "$(pwd)/gestio/.local-backups/backup-prueba-001"
```

El directorio resultante contiene `dump.sql` y `manifest.json` con permisos locales restrictivos. El manifest contiene ID, fecha, versión de formato/esquema/aplicación/commit, entorno, marca sintética, hash SHA-256, inventario de schema y recuentos; no contiene credenciales. El SQL contiene datos ficticios, hashes de sesión, permisos, auditoría e incident holds, pero nunca tokens de sesión utilizables. **No está cifrado**: mantenerlo solo en una máquina de prueba controlada. No subirlo a Git, R2, Drive ni correo.

## Restaurar en una D1 local nueva

El destino debe ser una ruta absoluta **inexistente**. Debe usarse `--persist-to` para que Wrangler abra la copia restaurada, no la D1 local activa. El script importa a un directorio temporal, comprueba integridad, claves foráneas, schema, migraciones, recuentos e invariantes de seguridad, y solo entonces publica el directorio destino. Ante fallo lo elimina; nunca hace un restore parcial en el destino solicitado.

```sh
mkdir -p gestio/.local-restores
npm run db:restore -- \
  --backup "$(pwd)/gestio/.local-backups/backup-prueba-001" \
  --dest-state "$(pwd)/gestio/.local-restores/restore-prueba-001"
```

Arrancar la aplicación explícitamente contra esa D1 y comprobar `/api/dev/identities`, login sintético, `/api/participants` y `/api/audit/events`:

```sh
cd gestio
../node_modules/.bin/wrangler dev --local \
  --config wrangler.toml \
  --persist-to "$(pwd)/.local-restores/restore-prueba-001" \
  --ip 127.0.0.1 --port 8788
```

La aplicación sigue en `APP_ENV=development`, con `DEV_IDENTITY_PROVIDER=enabled`. No activa egress real ni servicios externos. El restore **no** ejecuta migraciones ni seed después de importar: un backup aprobado ya contiene el schema y las migraciones aplicadas. Si el manifest o las migraciones no coinciden, se aborta; una evolución del schema requiere plan de migración explícito, no “best effort”.

## Drills y fallo

```sh
npm run db:backup:test
npm run db:restore:test
npm run disaster:drill
npm run ci
```

El test genera un D1 aislado, aplica migraciones y seed, ejecuta operaciones de la aplicación, crea auditoría y un hold, respalda, simula un cambio defectuoso, restaura en otra D1 y repite las pruebas. Usa exclusivamente fixtures y rutas temporales. `npm run ci` incluye el drill mediante `npm test`.

Si `db:backup:verify` o `db:restore` falla: **no arrancar la base recuperada ni reintentar con flags permisivos**. Conservar la copia original intacta, anotar el código `RECOVERY_FAILED` y el backup ID (sin imprimir tokens o paths sensibles), comprobar versión de aplicación/migraciones y probar una copia anterior en un destino nuevo. Una discrepancia de hash, schema o FK exige investigación; no corregir el dump a mano. Si se sospecha compromiso, revocar sesiones/credenciales por un procedimiento separado antes de reabrir el servicio.

## Migration defectuosa: rollback local

Antes de migrar: detener escrituras, crear y verificar una copia, anotar el backup ID y conservar el último estado válido. Aplicar la migration a una copia aislada y comprobar schema, FK y rutas críticas. Si falla cualquier invariante, mantener el servicio cerrado, restaurar el backup en un destino nuevo, ejecutar verificaciones y arrancar contra ese destino. En producción los criterios, ventana de mantenimiento, cambio de binding y responsables requieren aprobación; **no asumir** que una migration inversa recupera datos perdidos.

El backup no recupera Worker/Access/DNS/secrets ni objetos R2. Ver [DISASTER_RECOVERY.md](../DISASTER_RECOVERY.md) y [BACKUP_POLICY_DRAFT.md](../BACKUP_POLICY_DRAFT.md).
