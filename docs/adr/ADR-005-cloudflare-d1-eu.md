# ADR-005 — Cloudflare D1 con jurisdicción EU

## STATUS

Aceptado como destino; no se ha creado ninguna base remota.

## CONTEXT

La primera versión necesita persistencia relacional con coste objetivo de 0 €/mes. La decisión de proveedor exige residencia restringida y no acepta un simple location hint `weur` como sustituto.

## DECISION

Usar Cloudflare D1. Toda base, desde su creación, deberá usar `jurisdiction = "eu"` y verificarse por API/panel antes de introducir datos. Desarrollo y migraciones se prueban primero en local con fixtures sintéticos. El inventario conceptual de `infra/` no provisiona recursos.

## CONSEQUENCES

- SQLite/D1 condiciona migraciones, concurrencia y patrones de consulta.
- La CI rechaza bindings futuros sin `jurisdiction = "eu"`.
- Cambiar de proveedor exige documentar limitación, impacto, alternativa, coste e impacto jurídico/residencia.

## ALTERNATIVES

- PostgreSQL/Supabase/Neon/Firebase: no se introducen sin una limitación técnica concreta de D1.
- D1 con `location=weur`: descartado; no satisface la restricción de jurisdicción.

## OPEN QUESTIONS

- Validar límites efectivos del free tier con el modelo y carga esperados.
- Definir RPO/RTO, backup, restore y ventanas de migración antes de producción.
