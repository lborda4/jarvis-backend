import { PurchaseInvoiceImportStatusResponseDto } from '../../invoices/dto/purchase-invoice-import-job.dto';
import {
  PurchaseInvoiceImportProgressEvent,
  PurchaseInvoiceImportRowResultEvent,
} from '../../invoices/interfaces/purchase-invoice-import-ws-events.interface';

export const PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL =
  'purchase_invoice_import_events';

/**
 * Puente entre el worker (que procesa las filas) y el gateway de WebSocket
 * — hace falta aun con API y worker en el mismo proceso Nest, porque si la
 * app escala a varias instancias, el worker de la instancia A que procesó
 * el lote puede necesitar avisarle a un cliente conectado por WebSocket a
 * la instancia B. El worker hace `pg_notify` con uno de estos payloads,
 * cada instancia lo recibe por `LISTEN` y llama al método correspondiente
 * de su propio gateway. Los payloads son chicos a propósito: Postgres
 * limita NOTIFY a 8000 bytes.
 */
export type PurchaseInvoiceImportNotifyEvent =
  | {
      event: 'progress';
      companyId: string;
      payload: PurchaseInvoiceImportProgressEvent;
    }
  | {
      event: 'row';
      companyId: string;
      payload: PurchaseInvoiceImportRowResultEvent;
    }
  | {
      event: 'completed';
      companyId: string;
      payload: PurchaseInvoiceImportStatusResponseDto;
    };
