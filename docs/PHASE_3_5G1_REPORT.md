# FASE 3.5G.1 — Fundación financiera

Estado: **IMPLEMENTADA — LOCAL / SYNTHETIC ONLY — pendiente de revisión Borja/Atlas**. Rama
`phase/3.5g-treasury` desde `phase-3.5g1a-complete` (`ca9232c`). Sin merge ni tag de G.1. Especificación:
[TREASURY.md](design/TREASURY.md). No se ha empezado G.2 (operativa diaria ni pantallas).

## Modelo

| Bloque | Tablas | Reglas en D1 |
|---|---|---|
| Rondas (0023) | `finance_round`, `finance_round_close`, `finance_post_close_adjustment` | DRAFT → OPEN ⇄ CLOSING → CLOSED; una OPEN y una CLOSING como máximo; periodos sin solape; código y periodo solo en DRAFT; CLOSED exige foto oficial y no cambia; ajustes posteriores append-only con arrastre a la ronda OPEN o pendiente |
| Posiciones (0023) | `finance_position`, `finance_opening_balance`, `finance_reserve_opening` | BANK/CARD/CASH del grupo, varias por tipo, sin IBAN (como mucho 4 dígitos); saldos iniciales y reservas por ronda en revisiones contiguas e inmutables; INITIALISATION solo mientras no haya ninguna ronda cerrada |
| Movimientos (0024) | `finance_import_batch`, `finance_movement`, `finance_movement_description` | Sin ronda; inmutables (solo anulación de duplicado, quitar la marca de revisión y la versión del conjunto); hash de fichero y huella únicos; nunca DELETE; descripción original aparte |
| Contrapartes y presupuesto (0025) | `finance_counterparty(+_revision)`, `finance_budget`, `finance_budget_line(+_revision)`, `finance_budget_revision` | Contraparte PERSON/ORGANIZATION mínima, vínculo de usuario único; presupuesto DRAFT → PROPOSED → APPROVED → CLOSED; árbol de N niveles por ronda y naturaleza, importes solo en hojas, sin ciclos, sin borrado; inicial congelado al aprobar; vigente = inicial + revisiones aprobadas, nunca negativo |
| Gastos e imputaciones (0026) | `finance_expense(+_line, _revision, _evidence)`, `finance_allocation`, preparados `finance_reimbursement`, `finance_card_statement`, `finance_overpayment` | Gasto PROPOSED/RECOGNISED/REJECTED/VOID; reconocido ⇒ líneas = total; nadie reconoce lo que adelantó; líneas versionadas en hojas de gasto de su ronda; imputación con un único destino tipado con clave foránea; conjuntos versionados; nunca por encima del movimiento; dirección; liquidaciones desde la posición del método de pago y nunca por encima del total; transferencias internas completas, de signo opuesto, entre posiciones distintas y recíprocas |
| Permisos (0027) | — | 12 permisos GLOBAL (ver AUTHORIZATION_MODEL) |

Vistas: `finance_opening_balance_current`, `finance_allocation_current`, `finance_movement_allocation_balance`
(pendiente de imputar), `finance_round_economics` (ingresos, gastos brutos, devoluciones, propuestos) y
`finance_budget_line_amount` (inicial y vigente de cada partida y su subárbol).

Tipos de imputación habilitados en G.1: `INCOME`, `EXPENSE_SETTLEMENT`, `EXPENSE_REFUND`,
`INTERNAL_TRANSFER`. El resto (`CARD_SETTLEMENT`, `REIMBURSEMENT_SETTLEMENT`, `FEE_PAYMENT`,
`ACTIVITY_PAYMENT`, `FAMILY_OVERPAYMENT`, `FAMILY_REFUND`, `RESERVED_CREDIT`) existe en el esquema y se
rechaza con `allocation_kind_not_enabled` hasta su fase.

## Servicios y API

`gestio/src/domains/finance/`: `rounds.js`, `movements.js`, `expenses.js`, `budget.js`, `shared.js`,
`routes.js` (montado en `worker.js` bajo `/api/finance/`). Rondas (listar, crear, editar en DRAFT, abrir,
iniciar y cancelar cierre, detalle con saldos, reservas y cifras), posiciones (saldo derivado por ronda,
deuda de tarjeta), saldos iniciales y reservas, importación sintética, movimientos manuales, listado y
detalle, revelación auditada de la descripción, anulación de duplicados, quitar marca de coincidencia,
imputación y transferencia interna, contrapartes, gastos (crear, revisar, reconocer, rechazar, anular),
presupuesto (crear, partidas, proponer, devolver, aprobar con metadatos externos, revisiones). Todas las
mutaciones concurrentes llevan `expectedVersion`/`expectedRevision`; los conflictos de dominio son 409
con su código; el cuerpo admite 16 KiB (300 KiB para importar).

Importación: formato `SYNTHETIC_CSV_V1` con primera línea `# synthetic`; máximo 500 filas. Huella =
posición, fechas, importe, referencia, resumen de la descripción normalizada (NFKC, minúsculas, espacios)
y ordinal entre filas idénticas del fichero; el saldo bancario nunca forma parte de la identidad. Un
fichero repetido se rechaza; filas conocidas se omiten; una coincidencia cercana (misma posición, fecha e
importe) entra marcada para revisión.

## Auditoría

Nuevos eventos: `TREASURY_ROUND_CREATED/UPDATED/OPENED/CLOSING_STARTED/CLOSING_CANCELLED`,
`FINANCIAL_POSITION_CREATED/UPDATED`, `OPENING_BALANCE_RECORDED`, `RESERVES_RECORDED`,
`BANK_IMPORT_CREATED`, `MOVEMENT_IMPORTED` (con recuento), `MOVEMENT_CREATED_MANUAL`,
`MOVEMENT_VOIDED_DUPLICATE`, `MOVEMENT_NEAR_MATCH_CLEARED`, `MOVEMENT_CLASSIFIED/RECLASSIFIED`,
`BANK_DESCRIPTION_REVEALED`, `COUNTERPARTY_CREATED/REVISED/USER_LINKED/USER_UNLINKED`,
`EXPENSE_PROPOSED/RECOGNISED/REVISED/REJECTED/VOIDED`, `BUDGET_CREATED/PROPOSED/RETURNED_TO_DRAFT/APPROVED`,
`BUDGET_LINE_CREATED/REVISED/DEACTIVATED`, `BUDGET_REVISION_PROPOSED/APPROVED/REJECTED`. Solo
identificadores y códigos: nunca descripciones bancarias, nombres, correos, teléfonos ni IBAN.

## Demo, recuperación y tests

- Demo (`demo/data.js` `buildTreasuryDemo`, aplicada por `demo:seed` también sobre una base ya sembrada):
  ronda 2026/27 abierta y enlazada con la de cuotas, Banco/Targeta/Caixa, saldos y reservas, presupuesto de
  tres niveles aprobado con una revisión, un ingreso imputado, ciclo banco → caixa → banco, gasto en
  efectivo y gasto con tarjeta liquidados, y un gasto adelantado por un scouter todavía propuesto.
- `scripts/recovery.js`: 23 tablas, objetos obligatorios e invariantes financieras tras restaurar; el
  drill restaura datos financieros reales del API y comprueba cifras.
- `test/gestio-finance-foundation.test.js` (10): rondas y posiciones, permisos, importación e
  idempotencia, imputaciones y concurrencia, transferencias internas, gastos y contrapartes, presupuesto,
  delegación financiera de las nuevas capacidades, migración 0027 y demo. Ajustados: recuperación (esquema
  27 y drill financiero) y demo.

## Deuda que pasa a otras fases

- G.2: pantallas de Tresoreria; subida de justificantes de gasto a R2; flujo de reembolsos (aprobación sin
  autoaprobación), extractos de tarjeta, caja (en tránsito, arqueo); clasificar un movimiento creando el
  gasto en un paso; correcciones guiadas.
- G.3: cuotas y actividades (habilitar `FEE_PAYMENT`, `ACTIVITY_PAYMENT`, sobrepagos, devoluciones a
  familias, `finance.reconcile`), política de hermanos y planes de N plazos, gap de `ALLOCATION_UNCLEAR`.
- G.4: presupuesto frente a real completo, cierre de ronda (foto oficial, ajustes posteriores, reservas
  derivadas), informes y Excel.
- Legal: descripción bancaria (proyección y purga), ficheros importados, justificantes y su retención.
- Formato real del banco: adaptador pendiente hasta conocer la exportación (antes de producción).
