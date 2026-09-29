# Cobros Bold desde la extensión

`POST /bold/jarvis/test` recibe ahora una solicitud real de cobro (ya no es un eco).
En esta primera versión el endpoint es público, según lo acordado para la integración de una sola empresa.

```json
{ "valor": "$15.000,00", "caja": "caja 1" }
```

El nombre debe coincidir con el guardado en el panel. Una caja inexistente o un nombre con varias asociaciones produce un error, sin enviar el cobro.

Configurar `BOLD_USER_EMAIL` con el correo del vendedor. La llave de identidad se toma de la integración Bold de la empresa asociada a la caja, no de la llave global.

El backend consulta los terminales de esa cuenta, obtiene el modelo del serial asociado y envía a `/payments/app-checkout` el total en COP, `taxes: []`, `tip: 0`, `payment_method: "POS"` y una referencia UUID. La respuesta incluye `reference` y `response` (respuesta de Bold).

Una respuesta exitosa indica que la solicitud fue enviada, no que el cliente ya pagó. No se implementa aquí la confirmación por webhook. No hay reintentos automáticos: si falla la conexión, verificar el datáfono antes de repetir el cobro.
