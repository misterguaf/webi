# ADR-002 — Desarrollo local exclusivamente sintético

## STATUS

Aceptado e implementado en FASE 0B-A.

## CONTEXT

El servidor público local cargaba `.env` y podía escribir en el webhook real con el comando ordinario. Un error de operador podía mezclar pruebas y datos reales.

## DECISION

`npm run dev`, `npm run dev:site` y `npm run dev:portal` usan datos sintéticos y egress simulado. El modo de integración es un comando distinto, `npm run dev:site:integration`, y exige a la vez `ALLOW_REAL_EGRESS=true` y que el origen exacto figure en `DEV_EGRESS_ALLOWLIST`. La guarda vive también junto al adaptador de salida, no solo en el launcher.

## CONSEQUENCES

- Una ejecución local ordinaria no escribe fuera.
- Un `.env` antiguo no activa egress por sí solo.
- Las integraciones reales locales requieren una acción consciente y dejan un aviso visible.
- Staging deberá conservar `dataPolicy=synthetic-only`.

## ALTERNATIVES

- Confiar solo en nombres de comandos: descartado; no protege llamadas directas.
- Eliminar toda integración real local: descartado porque impide pruebas controladas.

## OPEN QUESTIONS

- Decidir si las integraciones reales se permiten únicamente contra un Apps Script de staging.
- Definir quién puede aprobar y ejecutar esas pruebas.
