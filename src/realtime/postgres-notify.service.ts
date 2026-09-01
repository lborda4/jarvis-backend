import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL,
  PurchaseInvoiceImportNotifyEvent,
} from './interfaces/purchase-invoice-import-notify-event.interface';

/**
 * Lado "publisher" del puente Postgres LISTEN/NOTIFY — lo usa
 * PurchaseInvoiceImportWorkerService para avisar que hay progreso nuevo
 * para reenviar por WebSocket. Sigue haciendo falta con API y worker en el
 * mismo proceso: si la app escala a varias instancias, el cliente puede
 * estar conectado por WebSocket a una instancia distinta de la que procesó
 * el lote. `pg_notify` es una función normal de Postgres, no necesita una
 * conexión dedicada (a diferencia de LISTEN, que sí la necesita del lado
 * receptor — ver PurchaseInvoiceImportNotifyListenerService).
 */
@Injectable()
export class PostgresNotifyService {
  private readonly logger = new Logger(PostgresNotifyService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async publish(event: PurchaseInvoiceImportNotifyEvent): Promise<void> {
    try {
      await this.dataSource.query('SELECT pg_notify($1, $2)', [
        PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL,
        JSON.stringify(event),
      ]);
    } catch (error) {
      // Un fallo acá no debe tumbar el procesamiento del lote — en el peor
      // caso el usuario no ve la actualización en vivo, pero el estado en
      // Postgres (la fuente de verdad) sigue correcto y el REST/consulta
      // de estado lo refleja igual.
      this.logger.warn(
        `No se pudo publicar el evento '${event.event}' por NOTIFY: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
