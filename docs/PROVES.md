# Gestió «proves» — gestioproves.grupscoutparpallo.com

Entorno de pruebas de Gestió en Cloudflare: funciona sin ningún ordenador encendido, solo con datos ficticios
de la demo (104 educands), y solo pueden entrar los correos que autorices en Cloudflare Access.

## Cómo funciona

| Pieza | Qué hace |
|---|---|
| Worker `parpallo-gestio-proves` | La app Gestió (mismo código que local) servida en el dominio propio. Sin `workers.dev` ni URLs de preview. |
| Cloudflare Access | Antes de llegar a la app, pide el correo y envía un código de un solo uso. Solo pasan los correos de tu lista. |
| Doble comprobación | El Worker vuelve a verificar el token de Access en **cada** petición; sin token válido responde 403. |
| Selector de rol | Tras pasar Access, cada persona elige una identidad de la demo (Tresoreria, Coordinació Tropa…). En producción real este selector no existe. |
| D1 `parpallo-gestio-proves` | Base pequeña (UE) solo con la demo: ~1.600 filas. No se guardan correos de quien prueba. |
| Sin R2 | Los justificantes se validan y se descartan; «Veure justificant» muestra siempre un PDF/imagen ficticio. |
| Reinicio nocturno | Cada noche desde las 02:00 UTC (03:00/04:00 en Gandia) el Worker vuelve a dejar la demo intacta, un lote por minuto (~16 min). Si nadie ha entrado desde el último reinicio, no hace nada. Mientras dura, la app responde «s’està reiniciant». |

Coste esperado: 0 € (plan gratuito: Workers, D1 y Access hasta 50 usuarios). Cada reinicio escribe unas pocas
miles de filas de las 100.000 diarias gratuitas.

No incluye: portal de familias, envío de correos, salud ni datos reales (`DATA_MODE = SYNTHETIC_ONLY`).

## Puesta en marcha (una vez)

### 1. Borja: sesión de Cloudflare en el terminal

```bash
npx wrangler login
```

### 2. Borja: Cloudflare Access

En el panel de Cloudflare → **Zero Trust** (plan Free; puede pedir tarjeta aunque cueste 0 €):

1. **Settings → Authentication → Login methods**: deja activado **One-time PIN**.
2. **Access → Applications → Add an application → Self-hosted**:
   - Nombre: `Gestió proves`; duración de sesión: 24 h.
   - Dominio: `gestioproves.grupscoutparpallo.com` (sin ruta).
   - Login methods: solo **One-time PIN**.
3. **Política**: nombre `Correus autoritzats`, acción **Allow**, regla **Include → Emails**: los correos que quieras.
4. Copia dos datos y pásalos:
   - **Team domain**: `<equip>.cloudflareaccess.com` (Settings → Custom pages / Team name).
   - **Application Audience (AUD) Tag** de la aplicación (64 caracteres hexadecimales).

### 3. Crear la base, completar la configuración y publicar

```bash
npx wrangler d1 create parpallo-gestio-proves --jurisdiction eu
```

Rellenar en `gestio/wrangler.proves.toml`: `ACCESS_ISSUER`, `ACCESS_AUDIENCE` y `database_id`; commitear y:

```bash
npm run proves:deploy -- --reset
```

`proves:deploy` se niega si falta algún valor, si hay R2, si aparece el proveedor local, si la ruta no es
exactamente el dominio de proves o si hay cambios sin commitear en `gestio/`. Construye la demo, aplica las
migraciones remotas, publica el Worker y (con `--reset`) carga la demo.

## Uso diario

- **Dar o quitar acceso**: Zero Trust → Access → Applications → Gestió proves → política → lista de correos.
- **Publicar una versión nueva**: `npm run proves:deploy` (las migraciones nuevas se aplican solas; la noche
  siguiente el reinicio usa la demo nueva). Con `-- --reset` la demo se recarga al momento.
- **Reiniciar ya la demo**: `npm run proves:reset`.
- **Comprobar configuración y sesión**: `npm run proves:check`.
- **Ver errores**: panel de Cloudflare → Workers → parpallo-gestio-proves → Logs.

## Retirarlo

```bash
npx wrangler delete parpallo-gestio-proves
npx wrangler d1 delete parpallo-gestio-proves
```

Y borrar la aplicación de Access.
