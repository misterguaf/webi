# FASE 3A — actividades, inscripciones y revisión de pagos

Nota de vigencia: este informe documenta el checkpoint 3A. La cuota anual, descrita aquí como legacy, se enruta a servicios 3B **solo para envíos nuevos desde `portal/`** en la rama 3B; véase [PHASE_3B_REPORT](PHASE_3B_REPORT.md). No se ha modificado el tag estable 3A.

Fecha del informe original: 2026-09-23. Resultado original: **PASS en el alcance local y sintético; NOT PRODUCTION READY**. La implementación inicial estaba en `gestio/` y en un Worker `family/` separado. La consolidación posterior descrita a continuación sustituye esa topología familiar para actividades. No creó ni usó D1/R2 remotos ni datos reales.

## Consolidación familiar — 2026-09-24

Estado: integración local/sintética. `portal/public/` conserva el frontend, diseño, CSS, responsive, bilingüismo, sesión/cookie, CSRF, Origin checks, límites y flujo guiado. `portal/worker.js` pasa a ser la única entrada familiar mantenida para actividades y conecta con catálogo publicado de D1, inscripción 3A, matching, revisión de pagos, abstracción de storage y notification outbox. `gestio/` permanece como plataforma interna. `family/` no se elimina: queda **DEPRECATED / CANDIDATE_FOR_REMOVAL**.

Las inscripciones de actividades ya no usan `data/activitats.json`, Sheets ni Drive, ni envían correo directamente. El importe y las opciones válidas se calculan en servidor. Actividad gratuita no requiere justificante; actividad con importe positivo lo exige junto al envío. La respuesta a la familia es neutral para match claro, ambiguo o inexistente. Matching usa nombre normalizado, sección y fecha de nacimiento como factor auxiliar, nunca como clave primaria. Un match inequívoco enlaza el participante existente, no altera su ficha y no conserva una copia de `submitted_birth_date`; los casos pendientes la guardan temporalmente y matching/rechazo la borran. Nombre de quien envía (`submitted_by_name`), email requerido de recibo (`receipt_email`) y teléfono opcional (`contact_phone`) son datos de envío, no crean ni actualizan `guardian`/relaciones/contactos maestros.

El formulario ordinario no incluye DNI/NIE, salud, alergias, medicación, diagnósticos ni observaciones libres sanitarias. La fecha de nacimiento y el teléfono se mantienen con el alcance anterior; no se modifica la funcionalidad de cuota anual. La revisión posterior corrigió la falta de restricción POST y la deduplicación indebida de pendientes con fecha declarada diferente. La autorización de imagen se retiró. Participación obligatoria y acuse de lectura de privacidad obligatorio se registran por separado con versión y hora del servidor (`0005_registration_authorizations.sql`); el acuse no es consentimiento RGPD. `consent_version` queda deprecated: las filas anteriores permanecen sin inferir aceptación específica, las nuevas llevan el marcador `DEPRECATED`. Versiones `DEMO-3A-*` exclusivamente sintéticas, sin texto jurídico aprobado. Esto sigue **NOT PRODUCTION READY**.

## Modelos y flujos

- `0003_activities_registrations.sql` añade `activity`, `activity_section`, `activity_transport_option`, `participant_contact`, `delegated_permission`, `activity_registration`, `payment_evidence`, `notification_outbox` y `notification_capture`; `0004_submission_matching_data.sql` añade datos de envío y matching auxiliar; `0005_registration_authorizations.sql` añade trazabilidad específica de participación y lectura de privacidad. La cadena desde D1 vacía es migrations → seed ficticio → Workers locales.
- Actividad: **DRAFT → PUBLISHED → CLOSED**, sin hard delete. Creación/edición/publicación/cierre se auditan. El permiso por secciones exige autoridad sobre todas las secciones seleccionadas; GENERAL usa `activities.general.manage`. Se permite editar información no económica después de la primera inscripción; precio, fechas, secciones y transporte quedan bloqueados. El catálogo familiar muestra campos mínimos de actividades publicadas.
- Inscripción: POST anónimo local, sin lectura familiar de expedientes. El backend valida plazo, sección, transporte, autorización de participación, acuse de lectura del aviso y precio calculado en D1. La solicitud gratuita con match único pasa a **CONFIRMED**; la pagada con justificante pasa a **AWAITING_PAYMENT_REVIEW**; match ambiguo/inexistente pasa a **NEEDS_PARTICIPANT_REVIEW**. Un revisor autorizado enlaza a un participante ya existente o rechaza; no se crean participantes ni se admiten externos. La respuesta HTTP es igual para los tres resultados de matching.
- Matching: normalización Unicode de nombre y comprobación de sección, con hasta 1000 participantes activos; más volumen falla hacia revisión humana. No se expone búsqueda pública ni candidatos. `idempotency_key` y dos índices únicos evitan replay y duplicados conocidos; payload distinto con la misma clave produce conflicto.
- Pago: justificante en el mismo POST que la inscripción, exigido si el importe calculado es positivo. Metadata (clave, SHA-256, tamaño, MIME y revisión) en D1; binario en R2 **emulado local**. Se comprueban tamaño 4 MiB, firma inicial, MIME/extensión y marcador `synthetic`. Esto no sustituye un escáner antimalware. Revisión **PENDING_REVIEW → ISSUE → VERIFIED** o **PENDING_REVIEW → VERIFIED**; solo VERIFIED confirma. No hay tarjeta ni credenciales bancarias.
- Delegación: `authorized_by`, `provisioned_by`, referencia, sección y vencimiento separados. El provisionador no puede autoconceder autoridad ajena; se exige ratificación por permiso distinto antes del efecto. Revocación/caducidad niegan de nuevo. Solo `activities.registration.review` y `finance.payment.verify` son delegables aquí.
- Notificaciones: outbox transaccional para recibido, pendiente de pago, confirmación e incidencia. Procesador **fake** con fallo/reintento y captura `.test`; no llama a proveedor de email. El audit almacena IDs/acciones, nunca el cuerpo del correo, nombre, email ni fichero.
- Concurrencia: índices de unicidad y batches D1; triggers SQL abortan revisiones de actividad, matching, pago, delegación u outbox basadas en estado obsoleto, evitando audit de éxito tras un no-op. El flujo de duplicado concurrente se reconcilia a respuesta neutral. No se afirma equivalencia con carga real de producción.

## Superficies e interfaces

El informe original describía `family/worker.js` como canal separado. Tras la consolidación, `portal/worker.js` sirve catálogo e inscripción de actividades; `family/` queda deprecated y su antiguo payload `consentVersion` ya no es compatible con el servicio de inscripción saneado, por lo que no debe usarse como segundo canal. `gestio/public/` ofrece interfaz interna en valenciano para actividades, matching y pagos. La revisión interna muestra la fecha temporal de envío y la fecha maestra candidata solo a usuarios autorizados. Solo arrancar tras migrations/seed; `gestio:reset` destruye estado local y no debe ejecutarse sobre trabajo que se quiera conservar.

## Backup y restore

`gestio/scripts/recovery.js` incorpora tablas, índices, triggers e invariantes 3A. El test 3A crea actividad, inscripciones, pago, delegación y outbox, genera backup y restaura a **otro** estado D1; compara recuentos. La suite 2B sigue verificando esquema, FK, autorización y auditoría. **El SQL de D1 no incluye objetos R2 emulados**: el justificante recién subido no es recuperable solo con este backup. Para producción hace falta backup independiente de binarios, cotejo clave/hash y política de restauración; no se habilita recuperación funcional de ficheros con el drill actual.

## Pruebas y resultados

`test/gestio-3a.test.js` parte de una D1 aislada vacía, aplica migrations y seed, arranca `gestio/` y `portal/`, y ejercita actividad gratuita/pagada, scopes, matching con DOB auxiliar, revisión humana, evidencia, outbox fake, backup y restore. Pruebas negativas: enumeración, CSRF/Origin, otra sección, precio/estado falsificados, actividad cerrada, fecha vencida, justificante inválido, idempotencia conflictiva, revisión no autorizada y transición SQL obsoleta. Las migraciones anteriores no se reescribieron.

## Riesgos y decisiones abiertas

**NOT PRODUCTION READY.** Faltan D1/R2 remotos creados con jurisdicción `eu` y verificados, Access/MFA real, Turnstile y rate limiting distribuido, protección contra malware/cuarentena y URLs/descargas seguras, correo transaccional real, backups de objetos, cifrado/retención/IAM/restore remoto, observabilidad y controles de despliegue. La dirección de email del solicitante es de prueba y no autentica parentesco; antes de datos reales debe decidirse cómo verificar autorización familiar y contacto de notificación. Los plazos de inscripción, justificante y outbox son **LEGAL_DECISION_REQUIRED**. FASE 3A no migra la cuota anual, que sigue legacy; no incluye salud, plazas/waitlist, autoservicio de cancelación ni diseño final. El límite de matching lineal requiere diseño/índice si el conjunto crece. Las versiones sintéticas `DEMO-3A-*` no son texto jurídico aprobado; URL y versiones finales requieren validación jurídica.

Se necesitan decisiones del grupo sobre: responsables que autorizan y ratifican delegaciones, criterio de contacto familiar/representación, retención y supresión, canal/plantillas de email, estrategia de objetos y cuarentena, y autorización separada para cualquier infraestructura remota. El RPO 24 h y RTO 8 h de 2B siguen **PROVISIONAL_OPERATIONAL_DECISION**, sin aprobación.

## Preparación para la siguiente fase

**FASE 3B (cuota anual):** sí para trabajo **local/sintético** si se conserva la separación conceptual de actividades y cuota; no para cobros o datos reales. La política de importes/descuentos y la autorización familiar siguen sin aprobar.

**FASE 3.5 (UX/UI gestio):** sí para diseño funcional local/sintético sobre la UI 3A; no para producción ni para añadir acceso funcional a TECH_ADMIN. Ninguna fase se inicia automáticamente.

## Verificación de la consolidación — 2026-09-24

En la copia aislada y el checkout real tras el saneamiento: `npm run ci` **PASS**, 86/86 tests, lint, typecheck, schemas, guardas y `npm audit` (0 vulnerabilidades altas). `npm run gestio:3a:test`: **2/2 PASS** en copia aislada. El restore/disaster drill 2B pasó dentro de la CI con manifest de cinco migraciones. Ninguna de estas pruebas equivale a aceptación de producción.
