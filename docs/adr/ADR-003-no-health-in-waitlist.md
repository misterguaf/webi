# ADR-003 — La lista de espera no recoge datos de salud

## STATUS

Aceptado e implementado en FASE 0B-A.

## CONTEXT

El formulario público incluía un textarea de alergias/necesidades y lo enviaba a una columna general de Sheets. La lista de espera no tiene autorización sanitaria granular ni una decisión jurídica cerrada para categoría especial.

## DECISION

Eliminar el campo abierto de interfaz, validador y payload. El backend rechaza explícitamente el antiguo `notes` y nombres sanitarios equivalentes. Apps Script mantiene vacía la columna histórica con la marca `LEGACY_FIELD_PENDING_MIGRATION`; esta fase no modifica ni borra la Sheet remota.

## CONSEQUENCES

- La lista de espera solo contiene identidad mínima y contacto.
- Clientes antiguos no pueden reintroducir salud mediante el payload.
- El canal sanitario futuro queda separado y bloqueado hasta decisión jurídica, modelo y permisos propios.

## ALTERNATIVES

- Mantener un campo libre con advertencia: descartado; seguiría permitiendo salud.
- Cifrar el textarea actual: descartado; no resuelve minimización, finalidad ni autorización.

## OPEN QUESTIONS

- Definir si existe necesidad real de un canal sanitario y en qué momento del alta.
- Aprobar base jurídica, campos mínimos, conservación y responsables de acceso antes de implementarlo.
