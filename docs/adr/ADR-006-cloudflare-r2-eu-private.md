# ADR-006 — Cloudflare R2 privado con jurisdicción EU

## STATUS

Aceptado como destino; no se ha creado ningún bucket remoto.

## CONTEXT

Los justificantes, documentos y otros binarios personales no deben permanecer en Drive como diseño objetivo ni exponerse mediante URLs públicas.

## DECISION

Usar R2 Standard privado para objetos personales/documentales. Cada bucket deberá crearse con jurisdicción `eu`, declarar `jurisdiction = "eu"` en su binding y verificarse antes de uso. No se habilitará `r2.dev` ni dominio público. D1 conservará solo metadatos minimizados y la clave del objeto.

## CONSEQUENCES

- La descarga requerirá autorización backend y URL de vida breve o streaming controlado.
- Son obligatorios cuarentena, validación, escaneo y lifecycle antes de datos reales.
- La CI rechaza futuros bindings personales sin jurisdicción EU.

## ALTERNATIVES

- Google Drive operativo: solo transición, no arquitectura objetivo.
- Bucket público: descartado.
- Otro proveedor: sujeto al gate de excepción de ADR-001.

## OPEN QUESTIONS

- Elegir mecanismo de escaneo compatible con el presupuesto y el riesgo.
- Aprobar tamaños, tipos, conservación, cuarentena y política de borrado.
