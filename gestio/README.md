# gestio — prototipo estrictamente local

Separado de `site/` (web pública nueva) y `portal/` (portal familiar). No tocar la web antigua publicada. **NOT PRODUCTION READY.** Usar solo identidades y participantes ficticios.

Desde la raíz del repositorio, con Node 24 y `npm ci`:

```sh
npm run gestio:reset   # borra SOLO gestio/.wrangler/state, migra y siembra
npm run dev:gestio     # http://127.0.0.1:8788
npm run gestio:test    # D1 local aislado en un directorio temporal
```

`gestio:migrate` aplica migraciones sin borrar datos. `gestio:seed` carga una base vacía ya migrada; no es para ejecutarlo dos veces. El selector de identidades sintéticas solo aparece en desarrollo local. No introducir datos personales reales, especialmente de menores, salud o pagos.

El Worker verifica sesión en D1 en cada API; la cookie opaca nunca es un JWT. El navegador no recibe token hash, permisos globales ni credenciales DB. Los endpoints sensibles rechazan `Origin` ajeno. `GET /api/participants` aplica el scope dentro de SQL. La ruta de salud de prueba `/api/dev/policy/health` solo devuelve una decisión booleana y no almacena/expone datos sanitarios.

FASE 2A: servicios de aplicación y repositorios por dominio en `src/domains/`; la migración 0002 añade `audit_event`, incidente, hold y retención desactivada. `GET /api/audit/events` solo responde a un usuario con rol y grant explícito `audit.event.read`; filtro/cursor paginado máximo 50 y lectura auditada. Rutas administrativas sintéticas permiten roles/permisos, grants de salud, suspensión y hold. La UI sigue básica y no muestra estos controles. No hay endpoint HTTP de retención ni datos de salud reales. Véase [informe 2A](../docs/PHASE_2A_REPORT.md) y [ADR-008](../docs/adr/ADR-008-gestio-domain-audit-lifecycle.md).

El `database_id` del binding es ficticio y bloquea un despliegue válido. No ejecutar `wrangler deploy`, `d1 create`, `d1 execute --remote` ni `d1 migrations apply --remote` sin autorización expresa. Para una futura D1 real hace falta crearla **desde el inicio** con `--jurisdiction=eu`, comprobar su metadata y sustituir el placeholder mediante un cambio revisado. Declarar `jurisdiction` en `[[d1_databases]]` no sirve: Wrangler lo ignora.

`npm run gestio:deploy` está deliberadamente bloqueado. La guarda de CI también rechaza cambiar el fichero local a producción con el proveedor ficticio activado; el Worker falla cerrado en runtime. Un despliegue futuro requiere una configuración y revisión independientes.
