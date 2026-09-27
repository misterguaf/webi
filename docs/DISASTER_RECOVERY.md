# Recuperación ante desastres — `gestio`

Estado: diseño operativo **provisional**, drill **local/sintético** probado. Nada de esto autoriza datos reales ni aprovisionamiento remoto.

FASE 3B: las copias D1 locales incluyen configuración de ronda, grupos explícitos, obligaciones, transferencias, allocations, planes de dos partes, incidencias y outbox de cuota; el test 3B restaura estos datos con FK. Los binarios de justificantes de cuota y actividad permanecen **fuera** de D1 y requieren respaldo/restauración independientes por clave/hash. La reapertura no debe confirmar pagos sin cotejo bancario; un backup antiguo puede resucitar asignaciones o datos suprimidos, por lo que el ledger externo pendiente sigue siendo bloqueante.

## Objetivos propuestos

- **RPO: 24 horas — `PROVISIONAL_OPERATIONAL_DECISION`.** Proponer una exportación diaria verificable limita la pérdida desde la última copia independiente a un día. D1 Time Travel puede reducirla para incidentes recientes si está disponible, pero no es una copia independiente. La cadencia diaria y los datos incluidos deberán aprobarse.
- **RTO: 8 horas — `PROVISIONAL_OPERATIONAL_DECISION`.** Para ~100 educandos y pocos usuarios internos, una interrupción temporal es moderadamente tolerable, pero hay que reservar tiempo humano para detectar, elegir copia, restaurar, verificar permisos/auditoría, reconfigurar y aprobar reapertura. El drill local mide segundos y **no** demuestra 8 horas en Cloudflare ni disponibilidad de responsables.

La confidencialidad e integridad tienen prioridad sobre una reapertura apresurada. Ante sospecha de compromiso, mantener el sistema cerrado aunque se supere el RTO. Los valores no están aprobados.

## Orden de recuperación

1. Declarar incidente, detener escrituras/egress, identificar último estado confiable y preservar evidencia mínima.
2. Comprobar acceso a Git, inventario de configuración, credenciales de recuperación y claves fuera del backup; si se perdieron secrets, rotarlos/recrear antes de abrir.
3. Elegir copia verificada y contrastar edad con RPO y ledger de supresión/bloqueo externo (pendiente).
4. Restaurar en destino aislado; verificar hash, schema, FK, migraciones, recuentos, roles/scopes, sesiones, auditoría, holds y escritura posterior.
5. Reaplicar supresiones/holds válidos y revocar sesiones si hay compromiso; verificar configuración Access/Worker/R2/DNS y ausencia de egress no autorizado.
6. Obtener aprobación de reapertura de responsables designados, cambiar binding/ruta, observar y registrar cierre. Los responsables titular/suplente aún deben designarse.

## Dominios de fallo

| Escenario | Recupera el backup | No recupera / dependencia adicional |
|---|---|---|
| D1 borrada por error | Schema y filas hasta la copia | Escrituras posteriores; crear D1 `eu`, binding, credenciales, verificación; Time Travel si disponible |
| Migration defectuosa | Estado pre-migration si copia verificada | Cambios posteriores; rollback de binding/Worker y aprobación de pérdida |
| Operador elimina filas | Filas anteriores y audit/holds existentes | Supresiones válidas posteriores; ledger externo pendiente |
| Cuenta interna comprometida | Estado previo | Revocación de sesiones/IdP, investigación y credenciales; la copia puede contener cambios maliciosos |
| Cuenta Cloudflare comprometida | Solo copia **externa e inaccesible al atacante** | Workers, Access, DNS, D1/R2, secrets, keys; un R2 de la misma cuenta puede perderse también |
| Ransomware en dispositivo desarrollador | Copia aislada fuera del dispositivo | Git/config/keys independientes; las copias locales del dispositivo no bastan |
| Backup corrupto | Otra copia verificada / Time Travel | Si todas fallan, no hay recuperación garantizada; drills y redundancia |
| Backup demasiado antiguo | Estado hasta su fecha | Reconstrucción manual, pérdida superior al RPO; monitor de antigüedad y rotación |
| Configuración perdida | Datos D1 | Wrangler/config Git, Access policies, DNS, R2 y reglas externas documentadas |
| Secrets perdidos | Filas (hashes de sesión, no tokens) | IdP, Access, HMAC, cifrado/KMS, rotación y recuperación de claves separada |

## Configuración fuera de D1

Recuperar por separado: Git/commit, Wrangler y variables de Worker, Cloudflare account/roles, Access policies e IdP/MFA, secrets y KMS, DNS, bindings de D1, futuras configuraciones/buckets R2 (con `jurisdiction = "eu"`), Turnstile, alertas y configuración de logging. `wrangler.toml`, manifests, ADR y scripts reducen trabajo manual, pero no reconstruyen por sí solos paneles ni secrets. No introducir Terraform solo por esta fase.

## Prerrequisitos de producción

Definir titular/suplente y autoridad de restauración; aprobar RPO/RTO y retención jurídica; configurar cifrado y copia independiente con permisos separados; asegurar jurisdicción EU; establecer ledger de supresión; ensayar restore remoto con datos ficticios y luego validación controlada; monitorizar antigüedad y éxito de backups; documentar configuración de Access/DNS/secret recovery; verificar coste/free tier; ejecutar simulacro de fallo de cuenta y migration. Hasta cumplirlos: **NOT PRODUCTION READY**.

El drill local reproducible y los comandos exactos están en [runbook](runbooks/BACKUP_RESTORE.md).
