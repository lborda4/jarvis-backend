# Cobros Bold desde la extensión

`POST /bold/jarvis/test` recibe ahora una solicitud real de cobro (ya no es un eco).
En esta primera versión el endpoint es público, según lo acordado para la integración de una sola empresa.

```json
{ "valor": "$15.000,00", "caja": "caja 1" }
```

El nombre debe coincidir con el guardado en el panel. Una caja inexistente o un nombre con varias asociaciones produce un error, sin enviar el cobro.

El cobro usa el correo del vendedor fijo de esta primera integración. La llave de identidad se toma de la integración Bold de la empresa asociada a la caja, no de la llave global.

El backend consulta los terminales de esa cuenta, obtiene el modelo del serial asociado y arma el body de `/payments/app-checkout` con `total_amount` en COP, `taxes: []`, `tip_amount: 0`, `payment_method: "POS"` y una referencia UUID. El POST a Bold está comentado: solo se imprime el body.

Una respuesta exitosa indica que la solicitud fue enviada, no que el cliente ya pagó. No se implementa aquí la confirmación por webhook. No hay reintentos automáticos: si falla la conexión, verificar el datáfono antes de repetir el cobro.
