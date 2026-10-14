# Fase 3.5J — Cobertura de Iris

Fecha de comprobación: 14 de octubre de 2026. Aceptación visual del usuario: **PENDIENTE**.
La fase no se cierra formalmente con esta validación técnica.

## Implementación conservada

La rama `phase/3.5j-iris` parte de `release/3.5i-candidate` (`2e5ea6b`) y conserva los dos commits de Claude
`d409775` y `5f40863`. El diff de J añade presentación, no migraciones. No modifica las reglas contables,
las autorizaciones ni los endpoints de fase I. En servidor, el único cambio de J en `gestio/src/` son las
etiquetas y agrupación de permisos de tareas en `access-model.js`.

La comparación autenticada con el Worker activo de Proves, versión
`3a76036b-5e03-44ab-a7ad-af151a853259` del 13 de octubre, encontró **67 módulos compilados idénticos** a la
base de Iris. El snapshot de demostración difiere; la ruta de la dependencia fflate es relativa a otro
checkout. Proves tiene las 51 migraciones y 104 educands. La versión antigua no anota el SHA Git: no se
deduce su SHA exacto de una rama local. Esto verifica la conservación del catálogo funcional, no afirma
que cada interacción visual sea idéntica: J reorganiza la UI y corrige la proyección de fechas del calendario.

## Pantallas y componentes

| Área | Implementado y comprobado |
| --- | --- |
| Shell | Navegación, búsqueda ⌘K, perfil/tema, cuenta/sesiones, barra móvil y Més |
| Login | Escena original Capvespre al prat, selector sintético, entrada y vuelta al login sin sesión |
| Inici | Atención, actividades próximas, resumen de cuotas, calendario y tareas |
| Calendario | Mes/semana/día/lista, filtros, tarea personal recurrente, completar/archivar, cancelación y 409 |
| Participants | Lista/filtros, ficha, familia, editor, información pendiente y conservación de valores ante 409 |
| Activitats | Lista y filtros, estados, ficha y controles existentes |
| Inscripcions | Cola y justificante con zonas de importe, documento y revisión; visor móvil |
| Quotes | Resumen y listado; herramientas y listas largas mantienen desplazamiento interno |
| Tresoreria | Inici, movimientos, ingreso/gasto, familias, presupuesto y ronda |
| Movimientos | Lista + detalle, ingreso/gasto clasificados, contadores y lista actualizados; detalle correcto al cambiar de movimiento |
| Presupuesto XLSX | Preview de 65 categorías, avisos, importes y confirmación en una ronda ficticia aislada |
| C43 | Preview de archivo sintético, importación, reimportación sin duplicados y elección de cuenta validada |
| Administració | Cuenta, usuarios, roles/permisos, delegaciones, ratificaciones y sesiones con los componentes existentes |
| Incidències | Reportar, consultar y resolver; errores y estados originales conservados |

Los bloques comunes son `shell.css`, `iris.css`, `ui.js` y los SVG locales. Los módulos mantienen sus
controladores, drawers, diálogos y validadores. Las tablas presupuestarias usan `.data-table`; la vista
dividida utiliza el mismo listado y detalle de movimientos, no una implementación financiera paralela.

## Evidencia de comprobación

- Barrido de 12 rutas a **375, 768 y 1440 px**, claro y oscuro: 72 estados, sin desbordamiento de la página,
  sin errores JavaScript observados y esperando a que desaparecieran los estados de carga.
- Cinco perfiles: coordinación general, coordinación de sección, tesorería, secretaría y administración
  técnica. La coordinación de sección no obtiene movimientos; la administración técnica no obtiene
  participantes ni contenido financiero. Tesorería mantiene su acceso financiero sin ficha de participante.
- Login y diálogo de tarea en las seis combinaciones de tamaño/tema, movimiento reducido, foco por
  teclado y cierre con Esc. Búsqueda ⌘K, perfil y navegación móvil ejercitados con acciones reales.
- Error de red y reintento del calendario; conflicto de tarea 409 real; conflicto visual 409 de participante
  inyectado, complementado por las regresiones backend de concurrencia del repositorio.
- Regresiones nuevas: fechas snake_case/Europe-Madrid, actividad de varios días/cambio de hora, actualización
  del listado y contador tras confirmar un movimiento, detalle de otro movimiento y contraste de tokens.
- Capturas representativas en `docs/reviews/assets/iris/`. Las capturas de flujos muestran exclusivamente
  datos sintéticos de la copia temporal; se restauró después esa copia a 104 educands, 15 movimientos,
  cero tareas de prueba y cero incidencias de prueba. No se restauró la base compartida ni Proves.

## Correcciones de finalización

1. Calendario a 375 px: contenedor mínimo, periodo con salto de línea y selector de fecha sin compresión.
2. Hover destructivo oscuro: `#D04C5A` → `#C94755`, texto blanco 4,32:1 → 4,65:1.
3. Proyección de actividad extraída al modelo para una regresión ejecutable; no cambia su semántica de J.
4. Exclusión Git de `node_modules` válida también para el enlace simbólico local ya existente.
5. Publicación Proves: anota SHA Git completo y evita ejecutar migraciones cuando la última aplicada ya
   coincide con el snapshot. No cambia la app, las rutas ni los recursos de producción.

## Excepciones y límites

- **Heredado y sin ampliar permisos:** el catálogo considera delegables `tasks.section.read/manage`, pero
  la lista permitida de `delegation-service.js` los rechaza con 400. Se comprobó la creación de una
  delegación admitida (`participants.profile.read`). No se ha introducido una nueva autoridad en Iris.
- Proves utiliza almacenamiento de justificantes de demostración, **sin R2 real**. Las subidas se descartan
  y las descargas son placeholders; esto también limita la recuperación del XLSX original en Proves.
  El importador completo con R2 se verificó en el entorno local aislado. J conserva este límite de Proves.
- Los colores de sección siguen siendo provisionales, como en la dirección visual existente.
- Las comprobaciones de accesibilidad cubren contraste de tokens, foco, teclado, diálogos y movimiento
  reducido; no son una certificación WCAG ni una prueba exhaustiva con lectores de pantalla.
- La aceptación estética del usuario permanece pendiente. Salud no recibe una nueva pantalla ni permisos.
- El primer `npm run ci` tuvo 489 PASS y un timeout de recuperación (240 s). La repetición aislada pasó
  en 158 s con el límite original. El resultado de la segunda suite y el CI del SHA publicado se registran
  en el informe de entrega; no se convierten retrospectivamente los timeouts en PASS.

## Reversión preparada

El respaldo anterior a Iris se exportó de la D1 de Proves y se cargó en SQLite aislado: 104 educands,
51 migraciones, integridad OK y sin violaciones FK. Está excluido de Git en
`.local-backups/iris-proves-2026-10-14/`, con su verificación y hash.
Como J no añade migraciones ni cambia datos, la reversión ordinaria es el Worker anterior:

```sh
node_modules/.bin/wrangler rollback 3a76036b-5e03-44ab-a7ad-af151a853259 --config gestio/wrangler.proves.toml
```

No se ejecutó esa reversión ni se restauró D1. Una restauración remota de datos sería una intervención
distinta, en mantenimiento y con verificación; no forma parte de publicar este rediseño.
