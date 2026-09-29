# Esborrany tècnic: altes i importació de participants

Estat: especificació inicial; cap endpoint ni importador implementat.

## Capacitat actual

Gestió exposa lectura de participants filtrada per permisos (`GET /api/participants` i detall). El servei de participants no ofereix alta individual ni importació. Les inscripcions i els pagaments poden referenciar participants existents, però no creen fitxes mestres.

## Alta individual

Definir primer els camps mínims, normalització, validacions de domini, permisos d'alta, auditoria i política de duplicats. Després crear un servei transaccional amb UUID intern i un endpoint protegit; `Nou participant` a la capçalera de Participants ha de reutilitzar aquest servei. Cal provar el filtre de secció i l'accés denegat amb els rols actuals.

## Importació inicial

Flux previst: Administració → Importació de participants → carregar CSV/XLSX → previsualitzar → validar → detectar possibles duplicats → revisió humana → dry run → confirmar. El fitxer no s'ha d'enviar a la base fins a la confirmació.

La validació ha de convertir cada fila al mateix model d'entrada que l'alta individual. UUID interns per a les fitxes noves; coincidències ambigües mai es fusionen automàticament. La vista prèvia ha de mostrar errors per fila i decisions pendents, sense exposar dades fora del perfil autoritzat. L'operació de confirmació necessita permisos restringits, idempotència, auditoria de fitxer/decisions/resultats i una transacció amb rollback raonable. El dry run ha d'usar les mateixes validacions sense escriptures definitives. L'operació normal de producció no ha de consistir en SQL manual directe.

En desenvolupament, només fitxers sintètics. Abans d'implementar, cal acordar esquema de fitxer, camps obligatoris, tractament de tutories/contactes, decisions de duplicat i límits de volum/retenció.
