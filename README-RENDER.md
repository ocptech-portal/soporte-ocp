# jabberguestnew - Render (seguro)

Esta versión conserva el frontend original de `jabberguestnew` y añade un backend Express en el mismo servicio Render.

## Seguridad
Las credenciales de la Webex Service App NO están en `public/js/app.js`.
El backend usa variables de entorno:

- `WEBEX_CLIENT_ID`
- `WEBEX_CLIENT_SECRET`
- `WEBEX_REFRESH_TOKEN`
- `WEBEX_CALL_TOKEN_PATH` (opcional; por defecto `/v1/telephony/click2call/callToken`)
- `WEBEX_GUEST_NAME` (opcional)
- `CLICK_TO_CALL_CALLED_NUMBER` (opcional; por defecto `9605`)

## Render
Tipo: Web Service

Root Directory: dejar vacío
Build Command:

    npm install --prefix server

Start Command:

    npm start --prefix server

Health Check Path:

    /health

## Antes de producción
Las credenciales que estaban en la versión original de GitHub deben revocarse/rotarse, porque fueron expuestas en JavaScript público.
