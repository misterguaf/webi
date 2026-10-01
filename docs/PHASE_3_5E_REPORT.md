# FASE 3.5E — Participants: informe de implementación

Fecha: **2026-10-01**
Especificación: [`design/screens/PARTICIPANTS.md`](design/screens/PARTICIPANTS.md) v0.5
Rama de trabajo: `phase/3.5e-participants` (desde `phase-3.5d-complete`, `a99d851`). Sin merge a
`phase/3.5-design` ni a `main`, sin tag.
Estado: **implementada, pendiente de revisión de Borja/Atlas. No declarada v1-ready.**
**LOCAL / SYNTHETIC ONLY; NOT PRODUCTION READY.**

## Commits

| Commit | Contenido |
|---|---|
| `f84dd3c` | Especificación v0.4 aprobada |
| `922b8c3` | Batch 1 — dominio y autorización (migración 0015) |
| `b61a7a0` | Batch 2 — lista y ficha |
| `9d6d33e` | Batch 6 — duración de delegaciones |
| `c60488a` | Batch 3 — alta provisional, edición, cambio de sección, baja |
| `018d514` | Batch 4 — tutores, contactos, representación y revisión (migración 0016) |
| `1b50c78` | Batch 4b — pestaña Família y cola de revisión |
| `fa1747e` | Batch 5 — seguimiento en Inici |
| `9523c3e` | Batch 9 — dataset demo |
| cierre técnico | Episodios de relación tutor–participante (migración 0017) y documentación |

## Qué entrega

| Bloque | Resultado | Evidencia |
|---|---|---|
| Permisos | `participants.profile.manage`, `.contact.read`, `.contact.manage`, `.guardian.manage` (SCOPED, delegables); `.representation.accredit`, `.review.manage` (GLOBAL). Todo server-side; fuera de alcance → 404 sin distinguir | `test/gestio-participants.test.js` |
| `CRM_MANAGER` | Retirado **solo en el servicio** (`role_retired`, 409); sin trigger; asignaciones históricas inertes y no asignables; migraciones históricas intactas | `test/gestio-governance.test.js`, `test/gestio-participants.test.js` |
| Dominio | `participant.version` (concurrencia optimista), metadatos y procedencia; completitud por edad derivada en servidor | `test/gestio-participants.test.js` |
| Altas provisionales | Ficha provisional sin fecha de nacimiento; duplicados en alcance visibles, fuera de alcance → revisión de Secretaría sin revelar nada | ídem |
| Tutores y contactos | Família con consulta auditada de contactos (sin valores en logs); tutor compartido → solicitud a Secretaría | `test/gestio-participants-family.test.js` |
| Representación | `comunicat` / `acreditat` con historial append-only; solo Secretaría/coordinación acreditan | ídem |
| Revisión administrativa | Cola de Secretaría: vista, incidencia, escalada, resolución, aplicar/rechazar solicitudes | ídem |
| Episodios de relación | Varias relaciones en el tiempo entre el mismo participante y tutor (ver abajo) | `test/gestio-participants-episodes.test.js`, `test/gestio-recovery.test.js` |
| Inici | Fichas pendientes y revisiones, contadas con alcance | `test/gestio-dashboard.test.js` |
| Delegaciones | 90 días por defecto, máximo 365, siempre con caducidad | `test/gestio-governance.test.js` |
| Demo | Tutores, contactos, representación, revisiones y tutor compartido Tropa/Escolta | `test/gestio-demo.test.js` |

## Cierre técnico: episodios de relación tutor–participante

**Problema.** `participant_guardian` (0011) tenía clave primaria `(participant_id, guardian_id)`: una
relación terminada impedía crear otra entre las mismas personas.

**Solución (migración `0017_guardian_relationship_episodes.sql`).** SQLite no permite cambiar una clave
primaria, así que la tabla se reconstruye con el **mismo nombre** y un identificador propio por episodio:

- todas las filas existentes se copian sin cambios como primer episodio (ninguna se borra);
  `created_by` se rellena con el `recorded_by` conocido;
- columnas nuevas: `id` (UUID), `created_by`, `ended_by`;
- índice único parcial: como mucho **una relación vigente** por pareja (`ended_at IS NULL`);
- triggers: un episodio terminado es **inmutable** (no se reabre ni se edita), ningún episodio se
  **borra**, el par, el inicio y el autor de un episodio no cambian, y un episodio nuevo no puede
  empezar antes de que termine el anterior;
- ninguna otra tabla referencia `participant_guardian`, así que no se toca ninguna clave foránea.

**Servicio.** Finalizar cierra el episodio vigente (registra quién y cuándo). Vincular de nuevo al mismo
tutor crea un episodio nuevo que empieza de cero: tipo de relación elegido de nuevo y representación
`comunicat` si se marca (nunca heredada), con su propia revisión. Una revisión de un episodio anterior no
marca como revisado el nuevo. La auditoría identifica cada episodio por su id.

**Alcance.** Un tutor solo se puede volver a vincular a **ese mismo participante** (que ya tenía la
relación) o, como antes, si es visible por otro participante en alcance. Un episodio anterior nunca da
acceso a los otros participantes del tutor, y la regla de tutor compartido se aplica igual al episodio
nuevo.

**Interfaz.** `Relacions anteriors` muestra el periodo de cada episodio terminado y ofrece
`Torna a vincular` (solo con gestión de tutores sobre ese participante y sin relación vigente).

**Backup/restore.** La tabla conserva su nombre; los objetos nuevos (índice y triggers) forman parte de
los objetos requeridos del verificador. La regresión crea dos episodios, hace backup, restaura y
comprueba los dos episodios, sus autores y que la base restaurada sigue rechazando borrar historial.

## Gaps conocidos (fuera de 3.5E)

- Detección automática de tutor duplicado (`POSSIBLE_DUPLICATE_GUARDIAN`): el tipo existe, pero no se
  genera automáticamente.
- Línea temporal visual completa de la representación (hay historial y endpoint; la ficha muestra el
  estado vigente).
- Interfaz de delegaciones (3.5H), import/export masivo, consentimientos, pas de secció, rediseño
  artístico.

## Revisión humana pendiente

- Densidad y textos de la pestaña Família, incluidos `Relacions anteriors` y `Torna a vincular`.
- Textos y flujos de la cola de revisión, y el mensaje neutro de tutor compartido.
- Ubicación de los elementos de seguimiento en Inici.
