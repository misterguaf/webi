# Family activities — deprecated

`family/` is **DEPRECATED / CANDIDATE_FOR_REMOVAL**. The definitive family
frontend is `portal/public/`; its Worker now calls the FASE 3A services.

Keep this tree for now as requested. Do not use `npm run dev:family:activities`
for family registration work. Its files can be considered for later removal
after the portal rollout is accepted.

## Audit 3.5 (2026-09-29)

Still **DEPRECATED / CANDIDATE_FOR_REMOVAL**. It imports `gestio/` services and binds its own local
D1/R2, which contradicts the portal isolation decision (ADR-009). Never run it outside localhost or
deploy it. Remove it once `portal/` is in production (the original condition); until then it is kept
for traceability only.
