# Historial de eventos RADIAN

Antes del despliegue, ejecutar la migración `1792000000000-CreateJarvisRadianEvents`.
El registro se separa por empresa, CUFE y evento. No se ejecutó la migración sobre
una base de datos compartida durante la implementación.

Se guardan CUDE, código y mensaje DIAN, respuesta completa sin el token,
motivo de reclamo, identificador del intento y fechas. El historial JSON conserva
las respuestas de emisión y reconciliación. Los endpoints públicos no exponen
la respuesta cruda ni las credenciales.

Una transacción con bloqueo por empresa y factura reserva el evento antes de
enviarlo. El bloqueo termina antes de la petición HTTP. Un estado `processing`
que quede tras un reinicio se presenta como `unknown` y no se vuelve a emitir.
Los eventos finales opuestos se excluyen incluso entre varias instancias.
Una respuesta tardía de otro intento no puede sobrescribir el intento actual;
una reconciliación incierta no puede degradar un evento ya confirmado.

## API

- `POST /integrations/jarvis/radian/events`: registra o devuelve el resultado ya
  guardado. Incluye `cude`, `dianCode` y `message` cuando están disponibles.
- `GET /integrations/jarvis/radian/invoices/:cufe/events`: historial resumido
  de la empresa autenticada.
- `POST /integrations/jarvis/radian/invoices/:cufe/events/reconcile`: consulta
  `/status/document/{cude}` para los eventos guardados no confirmados con CUDE.
  No emite eventos. La pantalla lo consume mediante «Consultar estados DIAN».

Un duplicado informado por NextPyme con CUDE se consulta antes de declararlo
aceptado. `success: true` o un CUDE aislado no bastan: se comprueba la validación
DIAN. Un HTTP 404/402/500 en la consulta no significa rechazo del evento.

## Límites de recuperación

Si un timeout impide recibir el CUDE, no se puede consultar ese evento por UUID.
Se mantiene bloqueado y requiere verificar el resultado con NextPyme/DIAN;
no se habilita un reenvío automático. El historial nuevo no importa eventos
registrados antes de esta migración ni desde otras aplicaciones. Tampoco
convierte la aceptación tácita en un envío manual.

La asignación y el consumo de cupos de NextPyme no se modifican. Las verificaciones
usan mocks; no se emitieron eventos reales ni se comprobó la política de cobro.
