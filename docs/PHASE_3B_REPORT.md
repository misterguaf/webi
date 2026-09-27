# FASE 3B — cuota anual y Tesorería

Estado: **LOCAL / SYNTHETIC ONLY — NOT PRODUCTION READY**. Rama `phase/3b-annual-fees`, base inmutable `3690bca` / `phase-3a-ci-stable`. Sin recursos remotos, datos reales, email real, commit, tag ni push de esta fase.

## Pre-flight y frontera

Antes de editar: rama correcta, HEAD en `3690bca`, árbol limpio y `npm run ci` **93/93 PASS**. Se revisaron los documentos de estado, arquitectura, modelo, autorización, seguridad, trazabilidad, plan, informe 3A y recuperación. `portal/` continúa como única superficie familiar canónica y conserva su diseño/sesión/cookie/CSRF/Origin; `gestio/` es la plataforma interna; `family/` permanece deprecated. Actividades 3A no cambian de backend.

## Modelo y cálculo

`0006_annual_fees.sql` añade ronda con cuota base, deadline orientativo opcional, titular, IBAN, concepto y una sola ronda abierta. El seed ficticio `2026/2027` usa 100 € y desde el tercer hermano 50 %. Se pueden crear y modificar rondas desde Gestió sin cambiar código. El vencimiento **no** bloquea envíos; no hay prorrateo por incorporación tardía ni refunds automáticos. La obligación registra una instantánea de base, descuento, ordinal e importe debido; un cambio posterior de cuota no altera obligaciones previas sin corrección manual auditada.

El vínculo de hermanos es **explícito y por ronda**: un usuario autorizado ordena los educandos de un grupo familiar; se valida que estén activos, que no figuren en otro grupo y que aún no tengan obligación creada. No se infiere parentesco de apellido, domicilio, email o teléfono. El descuento se registra con `FEE_DISCOUNT_APPLIED`. Las obligaciones derivan `PENDING`, `PARTIAL`, `PAID` o `ISSUE` desde importes verificados/asignados e incidencias abiertas.

`annual_fee_payment` representa el envío/transferencia; `annual_fee_allocation` reparte un pago entre obligaciones distintas. `declared_amount_cents` es solo informativo. Una persona autorizada introduce `verified_amount_cents` después de consultar el banco y asigna importes; el backend exige coincidencias resueltas, misma ronda/persona, importes positivos y `SUM(allocations) <= verified_amount`. El exceso sobre **una obligación** queda `ISSUE` y no se absorbe automáticamente. Una corrección posterior de allocations exige la ruta autorizada, transacción y auditoría; la suma sigue limitada y una ISSUE abierta requiere resolución humana. Los cambios de base/deadline, amount due y allocations conservan importes/fechas anteriores y nuevos en tablas de revisión D1, además de acciones de auditoría sin IBAN ni motivos familiares. Ningún justificante marca pago como verificado.

El fraccionamiento requiere permiso efectivo **y** rol vigente `TREASURY` o `GROUP_COORDINATOR`; consta de dos importes positivos que suman la deuda y fechas objetivo opcionales, no bloqueantes. No se admite motivo económico en el payload/esquema.

### Correcciones de blockers antes del checkpoint

`0007_annual_fee_integrity.sql` conserva 0001–0006 y hace que una incidencia abierta que afecta a una transferencia se refleje como `ISSUE` en todas sus obligaciones financiadas. Una incidencia ligada solo a una obligación afecta a esa obligación. Resolverla conserva la fila y devuelve el estado derivado de importes verificados y asignaciones; las confirmaciones en cola no se entregan mientras exista una incidencia abierta relacionada. No se añade un estado nuevo ni se borra el historial.

`PATCH /api/fees/groups/:id` sustituye explícitamente el orden de miembros con permiso global `finance.fee.manage`. `POST /api/fees/groups` también puede constituir el primer grupo después de crear obligaciones, con la misma corrección atómica. La revisión registra para cada miembro el grupo, ordinal, descuento e importe anterior y nuevo, y recalcula obligaciones en una transacción. Si el nuevo importe cae por debajo de lo ya asignado, rechaza todo con conflicto; si cambia un importe con asignaciones compatibles, abre `DISCREPANCY` para revisión humana. Un plan de fraccionamiento o un override cuyo descuento cambiaría exige revisión previa, sin reescritura silenciosa. `GET /api/fees/groups/:id/revisions` expone el historial a personal con permiso global de lectura financiera.

La migración 0007 también impide anular un importe verificado con asignaciones y representa las dos partes de un plan cerrado en una sola fila, con triggers que exigen su suma exacta; la vista `annual_fee_installment_part` mantiene la lectura existente. La actualización de ronda aborta con conflicto si pierde la versión, sin revisión o auditoría ficticia. Un reenvío idéntico conserva su referencia tras cerrar la ronda; los envíos nuevos siguen rechazados. Las pruebas de integración D1/Workers se ejecutan secuencialmente para evitar la contención que agotó el timeout del test D1 al correr en paralelo.

## Portal y matching

`portal/public/` mantiene el flujo visual bilingüe. La cuota nueva muestra instrucciones bancarias desde D1, acepta uno o varios educandos, nombre de quien envía, correo de recibo obligatorio, teléfono opcional, importe declarado opcional y justificante obligatorio. DOB, nombre y sección se usan para matching server-side. CLEAR vincula el participante; AMBIGUOUS/NONE pasan a revisión sin candidatos en la respuesta familiar. No se crean participantes ni se alteran fichas/contactos maestros o relaciones de tutela. La fecha declarada solo permanece en los pendientes; una vinculación o rechazo la elimina. El digest de idempotencia liga la fecha sin guardar una copia clara redundante. La respuesta familiar de recepción es neutral y **no** confirma ingreso ni deuda. El portal no ofrece login individual, consulta de cuotas ni autoservicio de cambios.

El Worker del portal aplica la sesión previa, Origin exacto/fail-closed, CSRF, JSON, límite de cuerpo, allowlist, honeypot y límite de envíos. El servicio valida 4 MiB, MIME/firma/extensión, nombre sin rutas, hash y marcador `synthetic`; metadata en D1 y binario solo en `EVIDENCE_STORAGE` emulado. No hay R2 remoto ni análisis antimalware. La privacidad se registra como acuse de lectura con versión `DEMO-3B-PRIVACY-NOTICE-V1`; no se modela como consentimiento RGPD. Textos/versiones reales requieren aprobación jurídica.

## Tesorería, permisos y auditoría

`gestio/public/` contiene controles funcionales en valenciano: ronda/configuración, métricas, búsqueda y agrupación explícita, obligación/detalle/fraccionamiento, pagos/justificantes, matching humano, verified amount, allocations, corrección de allocations e incidencias. No es el diseño final 3.5. `annual-fee-metrics.js` sirve totales y desglose por sección/estado sin acoplarse a la UI.

Permisos: `finance.fee.read/manage/payment.review/installment.authorize/config.manage`. Payment review es delegable con autorización/provisión separadas, referencia, ratificación, plazo/revocación y scope de sección; una transferencia multisección no es visible parcialmente. Un revisor delegado obtiene solo ID/código de ronda, candidatos de **la sección del envío autorizado** y obligaciones vinculables de **su pago**, no el panel financiero general. `TECH_ADMIN` no recibe permisos financieros. Todas las operaciones relevantes generan acciones cerradas en `audit_event`, sin binarios, IBAN completo, motivos familiares ni secretos.

El outbox 3B conserva los mismos principios de 3A pero usa tablas fee específicas porque `notification_outbox` 3A exige `registration_id`. El adaptador fake común drena ambos; no envía correo. Eventos: `FEE_SUBMISSION_RECEIVED`, `FEE_PAYMENT_CONFIRMED` y `FEE_PAYMENT_ISSUE`; la comunicación de incidencia es genérica en valenciano/castellano, sin cifras familiares sensibles.

## Legacy y riesgo remoto

`portal/worker.js` ya no importa `handleQuota`, `SHEETS_WEBHOOK_URL` ni `SHEETS_SHARED_SECRET`, ni escribe nuevas cuotas en Sheets/Drive. No hay dual-write. Inventario de cuota legacy preservada, candidata a retirada **en otro cambio**:

- backend/calculadora/config: `api/_lib/handler-quota.js`, `api/_lib/quota.js`, `api/_lib/cuotes.js`, `data/cuotes.json`, `data/cuotes.schema.json`;
- ruta remota antigua en `scripts/google-apps-script.gs` (`tipus === "quota"`, hojas, Drive y MailApp), más dependencia compartida `api/_lib/sheets.js` usada por alta/reserva; **no** eliminar el script entero mientras alta/reserva dependan de él;
- tests legacy: `test/quota.test.js`, `test/quota-handler.test.js`, `test/quota-signature.test.js`, `test/apps-script-boundary.test.js`; `test/portal-worker.test.js` también conserva pruebas de las guardas generales;
- configuración/documentación histórica: `data/cuotes.json`, `.env.example`, README, `docs/PORTAL-PRIVAT.md`, referencias a `SHEETS_*` y scripts locales de integración. Revisar dependencias antes de retirar nada.

No se consultó ni modificó un Apps Script remoto. Si existe un despliegue anterior, podría seguir aceptando cuotas por una ruta distinta: **PRODUCTION_BLOCKER / MIGRATION_CHECK**. Antes de datos reales se debe inventariar y desactivar/aislar ese endpoint con autorización, y comprobar que no quedan enlaces o clientes antiguos. Alta/reserva públicas siguen siendo legacy.

## Backup, tests y límites

`gestio/scripts/recovery.js` incluye tablas 3B, índices/triggers/vista, recuentos, FK e invariantes de asignación. El drill poblado 3B restaura ronda, grupo, obligaciones, pagos, allocations, historiales de cambios, fraccionamientos, ISSUE y outbox. El dump D1 **no** incluye binarios de justificantes; la restauración funcional de descargas exige backup separado de objetos y cotejo clave/hash. El backup local no está cifrado y no admite datos reales.

La prueba integral `test/gestio-3b.test.js` parte de D1 vacía y cubre cinco hermanos, ronda futura, deadline vencido, fraccionamiento 50/50 y 30/70, roles/scope/delegación ratificada y revocada, CSRF/Origin, justificante, matching, idempotencia, verified amount distinto del declarado, pago de varios educandos, PAID 100/100, PARTIAL 50/100 e ISSUE 110/100, over-allocation rechazado, corrección, outbox fake y restore. `test/gestio-3a.test.js` conserva su escenario histórico de cuota cerrada mediante fixture explícito y prueba además nombres de archivo sin rutas. Los tests legacy no se rebajan.

En la implementación inicial de 3B, `npm run ci` obtuvo **94/94 PASS**. El drill 3B específico pasó tres ejecuciones consecutivas tras aislar el uso del CLI de D1: durante la vida del Worker, la prueba consulta por API; verifica el SQL directamente solo después de detenerlo. Las correcciones de blockers posteriores se validan y reportan por separado. No equivale a producción.

### Segundo endurecimiento de 3B (0008)

La resolución de una incidencia de pago exige permiso efectivo de revisión sobre el pago y sobre **todas** las obligaciones que financia, usando la sección actual de cada participante. Si la incidencia enlaza pago y obligación, debe existir una allocation entre ambos. La corrección de allocations recibe `expectedVersion`; D1 compara e incrementa esa versión dentro de la transacción y una versión obsoleta no crea historial ni auditoría.

Una allocation solo puede escribirse durante una revisión ya identificada (`ISSUE` transitorio con revisor, fecha e importe verificado); el servicio termina la misma transacción en `VERIFIED`. La vista de obligaciones solo cuenta allocations de pagos `VERIFIED`. El saldo verificado sin asignar aparece en `annual_fee_payment_balance`, genera una incidencia `ALLOCATION_UNCLEAR`, bloquea su resolución mientras persista y retiene la confirmación. No se autoasigna ni se considera refund. La migración 0008 convierte saldos residuales válidos de 0007 en incidencias con aviso y rechaza snapshots antiguos con allocations sin revisión bancaria o familias ya inconsistentes.

`collectedPercent` significa **importe asignado de pagos verificados sin impugnación bancaria abierta / importe esperado de obligaciones**. `verifiedAllocatedCents` conserva el total contable asignado, `disputedAllocatedCents` separa el dinero impugnado y `unallocatedVerifiedCents` muestra el saldo verificado sin asignar. La interfaz distingue los tres importes. No se mezclan saldos sin asignar con importes de obligaciones.

Los avisos de incidencia nuevos se guardan por `(issue_id,payment_id)`: un mismo issue no duplica aviso y otro issue posterior sí puede enviarlo. Una corrección familiar que abre `DISCREPANCY` avisa una vez a cada pago que financia la obligación; una incidencia de obligación sin pago asociado queda **solo interna**, porque no hay destinatario financiero fiable. La tabla de avisos anterior conserva su historial. El servicio usa la compuerta de corrección familiar dentro de su transacción; 0009 añade integridad estructural que impide dejar obligaciones incoherentes aunque se manipule la compuerta por SQL directo. Recovery comprueba que no quede ninguna compuerta abierta.

### Corrección de los dos blockers finales (0009)

La autorización de pagos usa la sección **actual** de cada participante vinculado y de todas las obligaciones financiadas; una operación conjunta se deniega completa si falta scope sobre cualquiera de ellas. La sección guardada en el envío permanece como dato histórico para un registro todavía sin match. La lista de pagos aplica el mismo filtro sin mostrar filas parciales. Las pruebas cubren traslado Tropa→Escolta, acceso posterior con scope válido y denegación de una revisión de allocations multisección sin alterar el historial.

`0009_annual_fee_final_integrity.sql` añade una FK diferible desde cada obligación agrupada a su membership exacta (grupo, ronda, participante y ordinal), mediante claves generadas, y guards para la dirección inversa cuando ya existe una obligación. La antigua gate ya no puede permitir confirmar una relación rota. La corrección legítima borra los miembros anteriores, actualiza las obligaciones e inserta los miembros finales en una sola transacción. Recovery ordena el índice único antes de las filas en el dump de Wrangler para que el restore D1 compruebe la FK desde la primera inserción.

Riesgos abiertos: control de acceso real mediante Access/MFA; Turnstile/rate limit distribuido; bucket R2 `eu` privado, cuarentena y backup de objetos; email real con autorización de contacto; dominio HTTPS exacto para Origin y decisión HSTS includeSubDomains; retención/supresión y textos jurídicos; conciliación bancaría real; Apps Script remoto; costes/free tiers y observabilidad. No hay autorización para provisioning o datos personales reales.
