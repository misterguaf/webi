# FASE 3.5G.2A — Tresoreria operativa (Shell + Inici + Moviments + Classificació + Despeses)

Estado: **IMPLEMENTADA — LOCAL / SYNTHETIC ONLY — pendiente de revisión funcional y visual Borja/Atlas**.
Rama `phase/3.5g-treasury` desde `phase-3.5g1-complete` (`e1aa9f0`). Sin merge ni tag. No se ha empezado
G.2B. Pantallas: [TREASURY_HOME](design/screens/TREASURY_HOME.md), [TREASURY_MOVEMENTS](design/screens/TREASURY_MOVEMENTS.md),
[TREASURY_EXPENSES](design/screens/TREASURY_EXPENSES.md). Notas de implementación: [TREASURY.md §34.2](design/TREASURY.md).

## Qué hay

| Bloque | Resultado |
|---|---|
| Shell | Entrada **Tresoreria** (icono `bank`, en «Més» en móvil) solo con `treasury.read`, `readMovements` o `readExpenses`; pestañas Inici · Moviments · Despeses según capacidad; contador de navegación = pendientes + posibles duplicados. Sección, Secretaria y TECH_ADMIN no la ven ni llaman a `/api/finance`. |
| Inici | «Què necessita atenció ara?» (pendientes, parciales, posibles duplicados, propuestas no contadas), saldos por posición (tarjeta: pendiente de liquidar), movimientos y gastos reconocidos recientes, últimos lotes. Sin resultado, beneficio ni consumo de presupuesto. |
| Moviments | Lista Data/Posició/Descripció/Import/Estat/Acció con EUR con signo, estados humanos, filtros en servidor (estado, posición, fechas, sentido, búsqueda sobre la proyección saneada), paginación. Detalle con hechos, clasificación actual, historial, origen y duplicados. |
| Descripción original | Botón solo con `finance.bank_description.reveal` (nadie lo tiene por defecto); bajo demanda, auditada en cada consulta, sin caché ni listados. |
| Classificació | Solo tipos habilitados: ingrés, despesa nova, pagament de despesa existent, devolució, traspàs intern. Añade una parte al conjunto vigente; **Corregeix classificació** escribe un conjunto nuevo y conserva el historial. |
| Duplicats | Revisar candidatos; confirmar duplicado (queda anulado, nunca borrado, enlazado al original) o mantener como válido. |
| Despeses | Lista con filtros (estado, fechas, línea con subárbol, tercero), detalle (líneas con ruta, pagos y devoluciones con su movimiento, «Sense justificant adjunt», historial), alta manual (propuesta o reconocida), desde movimiento (una despesa reconocida + liquidación atómicas, cuenta una vez), reparto Total/Distribuït/Pendent que bloquea hasta cuadrar, selector jerárquico (solo hojas activas de la naturaleza correcta), terceros mínimos (Entitat/Persona, sin IBAN ni contacto), **Reconeix la despesa** con autoaprobación rechazada y explicada. |
| UX | Luminous Utility con los componentes de 3.5D; drawers con estado ocupado (sin doble envío), errores por campo y mensaje humano; toasts «Despesa creada», «Classificació actualitzada», «Moviment marcat com a duplicat», «Despesa reconeguda»; tarjetas en móvil, sin depender de hover. |

## Backend

- **Migración 0028** (aditiva): `finance_expense.concept`, `finance_expense_revision.previous_concept`.
- `GET /api/finance/summary`, `GET /api/finance/rounds/:id/assignable-lines?nature=`,
  `POST /api/finance/movements/:id/expense`; lista y detalle de movimientos y gastos enriquecidos
  (`read-models.js`: rutas de partidas, resúmenes de gastos y de imputaciones). Sin permisos nuevos: se usan
  exactamente las capacidades de G.1 (AUTHORIZATION_MODEL sin cambios).
- Todas las reglas siguen en el servidor y en D1 (exceso sobre el movimiento, naturaleza y hoja de la
  partida, dirección, método de pago, versiones). La UI solo las refleja.

## Demo, recuperación y tests

- Demo `buildTreasuryOperationsDemo()` (ids 22xxx) encima de la de G.1: lote sintético con un posible
  duplicado, pendientes, entrada parcial, despesa en dos líneas pagada por banco, despesa reconocida sin
  pagar, propuestas, tres terceros nuevos, partidas de tres niveles y conceptos. `demo:seed` la añade una
  sola vez. Cifras de la ronda demo: ingresos 250,00 €, gasto bruto 940,00 €, propuestas 70,00 €.
- Recuperación: `schema_version` 28 y 0028 en el manifiesto.
- `test/gestio-treasury-operations.test.js` (8): resumen y permisos por bloque; delegación financiera solo de
  lectura de movimientos; filtros y búsqueda sin descripción original; revelado denegado/permitido y
  auditado sin texto; clasificación (tipo no habilitado, exceso, cabecera, naturaleza, parcial, conflicto de
  versión, corrección con historial); duplicados; despesa desde movimiento (exceso, cabecera, naturaleza,
  versión, atómica, cuenta una vez, dirección, permisos); despeses (filtros, filas enriquecidas, propuesta no
  contada, reconocimiento único, revisión con concepto anterior, liquidación sin doble cómputo,
  autoaprobación, terceros sintéticos sin IBAN, selector sin importes).
- `test/gestio-treasury-ui.test.js` (9): formato EUR, etiquetas, pestañas por capacidad, opciones de
  clasificación (nunca tipos deshabilitados), filtros URL ⇄ API, textos de error, reparto, árbol, conjuntos
  de imputación y cableado de cada acción con su endpoint (Classifica, Crea i classifica, Reconeix,
  Corregeix classificació, Mostra descripció original, duplicat), sin almacenamiento local de la
  descripción, sin subida de ficheros, sin `innerHTML` ni estilos en línea.
- Actualizados: test de demo (cifras y 13 movimientos), test del shell (estado vacío de Tresoreria),
  recuperación.

## Revisión manual en navegador

Instancia aislada (copia de la base local en el scratchpad, puerto 8790; la base de Borja no se tocó
durante la revisión):

- **Tresoreria (seed-104):** Inici; lista; Classifica → És una despesa con reparto en dos partidas
  (bloqueado hasta cuadrar, selector jerárquico con búsqueda) → despesa creada y movimiento clasificado;
  Reconeix sobre una propuesta; confirmar duplicado; sobreasignación con el mensaje humano; Corregeix
  classificació con historial; sin botón de revelado por defecto; con el permiso concedido solo en la copia,
  revelado y ocultado.
- **Coordinació general (seed-101):** entra y opera.
- **Sin finanzas (seed-102):** sin entrada en la navegación; enlace directo → estado vacío; ninguna llamada a
  `/api/finance`.
- **Móvil (375×812):** tarjetas, filtros, pestañas y drawer a pantalla completa sin desbordamiento.

Corregido durante la revisión: bloques internos como `<section>` heredaban estilos antiguos del shell;
flecha de atención con `grid-area` ajeno; texto «null» en el detalle; superposición del símbolo €; filtros
ocultos y desbordamiento horizontal en móvil; errores de campo que no se limpiaban al editar.

## Pendiente / fuera de alcance

G.2B y siguientes: justificantes, reembolsos, extractos de tarjeta, ejecución presupuestaria, cierre, Quotes
dentro de Tresoreria, importación real. LEGAL DECISION REQUIRED: descripción bancaria original, ficheros
importados, justificantes. PENDING TREASURY INPUT: DEV.

## Extensió — Ingressos i conciliació bàsica

- **Migración 0029:** `finance_income` (+ `_revision`), `finance_allocation.income_id`, permisos
  `finance.income.read/manage` (Tresoreria y Coordinació general). Estado de conciliación derivado de las
  imputaciones vigentes; un ingreso cuenta una vez, al cobrarse.
- **API:** `GET/POST /api/finance/incomes`, `GET/PATCH /api/finance/incomes/:id`, `POST /incomes/:id/void`,
  `POST /movements/:id/income`; vincular usa `/movements/:id/allocations` con `incomeId`. Resumen con ingresos
  pendientes y entradas sin identificar.
- **UI:** pestaña **Ingressos** (lista, detalle, Nou ingrés, Concilia, Anul·la); en Moviments, «Crea un ingrés» y
  «Vincula a un ingrés existent»; «Devolució d’una despesa (proveïdor)» etiquetada sin ambigüedad.
- **Tests:** `gestio-treasury-incomes.test.js` (5) y ampliación de `gestio-treasury-ui.test.js`.
- **Revisión manual (copia aislada):** Nou ingrés 1.500 € pendiente; +1.500 € → Vincula → conciliado; +300 € →
  Crea ingrés «Venda loteria» → conciliado; Despeses/Moviments sin regresión; móvil sin desbordamiento.
