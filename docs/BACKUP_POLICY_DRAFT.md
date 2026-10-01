# Política de backup — borrador

**DRAFT — NOT APPROVED FOR PRODUCTION.** No establece un plazo legal de conservación. La aprobación de frecuencia, retención, acceso y supresión es `OPERATIONAL_AND_LEGAL_DECISION_REQUIRED`.

FASE 3.5G.1 local añade al dump D1 las rondas financieras, posiciones, movimientos (con su descripción bancaria original en tabla aparte), imputaciones, gastos, contrapartes y presupuesto, todo sintético. La retención de descripciones bancarias, ficheros importados y justificantes de gasto es LEGAL DECISION REQUIRED; no se ha activado ninguna purga.

FASE 3B local añade al dump D1 la ronda, obligaciones, descuento por agrupación explícita, pagos, allocations, fraccionamientos, incidencias y avisos ficticios. No añade los binarios de justificantes: siguen fuera de D1, bajo storage emulado, sin backup de objetos. El restore de cuota no debe interpretarse como validación bancaria ni aprobación de producción.

| Entorno | Datos | Mecanismo permitido ahora | Estado |
|---|---|---|---|
| Local | Solo fixtures sintéticos | `db:backup`, `db:backup:verify`, `db:restore` y drill en D1 local | IMPLEMENTED/TESTED; SQL sin cifrar, ignorado por Git |
| Staging | Solo fixtures sintéticos | Diseño: backup cifrado, prueba de restore y cuentas/roles separados | REQUIRES EXTERNAL CONFIGURATION; no creado |
| Producción futura | Personales, solo tras gates | D1 Time Travel más exportaciones cifradas independientes; R2 privado EU o copia separada; restore periódico | TECHNICAL RECOMMENDATION, **no diseño aprobado ni provisionado** |

## Política parametrizable pendiente

Definir en una única política operativa, sin plazos dispersos en código: frecuencia `daily/weekly/monthly`, número de copias por clase, expiración, excepción por incident hold, ubicación, cifrado, responsable, acceso de emergencia y frecuencia de restore drill. Ninguna de esas cadencias es todavía una obligación jurídica ni una configuración de producción. Valorar backup previo a cada migration y eventos de cambio de alto riesgo.

El acceso a backup **no equivale** al acceso normal a la aplicación: coordinadores, Treasury y TECH_ADMIN funcional no pueden descargar una copia. Usar credenciales específicas de backup y restore, mínimas y separadas; auditar `BACKUP_CREATED`, `BACKUP_VERIFIED`, `RESTORE_STARTED`, `RESTORE_SUCCEEDED` y `RESTORE_FAILED` en un registro administrativo externo a la DB que se está restaurando. El CLI local comunica esos resultados sin datos ni rutas; todavía no existe un registro administrativo duradero. Las copias no se incorporan al `audit_event` de negocio.

## Cifrado, residencia y resiliencia

Las copias reales necesitan cifrado antes de abandonar la frontera controlada, con clave gestionada fuera de la copia y separación de credenciales. **REQUIRES EXTERNAL CONFIGURATION**: KMS, rotación, recovery de claves, permisos, auditoría e inventario. No hay claves hardcodeadas ni junto al dump. No se ha implementado cifrado local porque una clave de prueba embebida daría una falsa protección.

Cloudflare D1 Time Travel facilita recuperar cambios recientes, pero una restauración in-place en la misma cuenta no sustituye una copia independiente y no cubre compromiso de cuenta. En Free el historial documentado llega hasta 7 días; diseñar exportaciones independientes antes de producción. Si se usa R2 con documentos o copias personales, **crear cada bucket con `jurisdiction = "eu"`**, nunca confiar solo en el hint `weur`; verificar metadata y bindings. Un bucket en la misma cuenta Cloudflare conserva un dominio de fallo común: evaluar una copia cifrada en cuenta separada o medio independiente, siempre tras evaluación jurídica/residencia. No se ha creado D1/R2 remoto.

El objetivo 0 €/mes parece plausible para un grupo pequeño **solo si** tamaños, lecturas/escrituras D1, almacenamiento/operaciones R2, Workers y retención permanecen bajo los límites Free vigentes. Vigilar tamaño DB y export, operaciones, crecimiento de audit log, número/tamaño de copias, cuota de Time Travel, egress y alertas. No es garantía económica ni consentimiento a ampliar el proveedor.

## Supresión, bloqueo y restauración antigua

Una supresión operativa no borra instantáneamente copias históricas. La expiración programada limita su persistencia; un incident hold puede exigir conservación separada y acceso restringido. Antes de reabrir una base restaurada se debe comparar contra un **deletion ledger/tombstone** externo a la copia restaurada, re-aplicar supresiones/bloqueos y documentar las excepciones jurídicas. Un ledger guardado solo en la D1 antigua también se perdería al restaurar una copia anterior. Su forma, contenido mínimo, responsable y plazo dependen de validación jurídica; **no implementado**. Hasta entonces, no usar este procedimiento para datos reales con supresiones pendientes.

Fuentes oficiales: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [límites D1](https://developers.cloudflare.com/d1/platform/limits/), [jurisdicción R2](https://developers.cloudflare.com/r2/reference/data-location/), [precios R2](https://developers.cloudflare.com/r2/pricing/).
