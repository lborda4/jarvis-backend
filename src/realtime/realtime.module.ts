import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PurchaseInvoiceImportSharedModule } from '../invoices/purchase-invoice-import-shared.module';
import { PurchaseInvoiceImportGateway } from './gateways/purchase-invoice-import.gateway';
import { PurchaseInvoiceImportNotifyListenerService } from './purchase-invoice-import-notify-listener.service';
import { PostgresNotifyService } from './postgres-notify.service';

/**
 * API y worker corren en el mismo proceso Nest (ver PurchaseInvoiceImportWorkerService,
 * registrado en InvoicesModule) — el puente LISTEN/NOTIFY sigue haciendo
 * falta igual: si la app escala a más de una instancia (varias réplicas
 * detrás de un load balancer, cada una con su propio worker in-process), el
 * lote que procesa la instancia A puede necesitar avisarle a un cliente
 * conectado por WebSocket a la instancia B. Postgres NOTIFY/LISTEN no le
 * importa si el publisher y el listener están en el mismo proceso o en
 * instancias separadas — funciona igual en ambos casos.
 */
@Module({
  imports: [AuthModule, PurchaseInvoiceImportSharedModule],
  providers: [
    PurchaseInvoiceImportGateway,
    PurchaseInvoiceImportNotifyListenerService,
    PostgresNotifyService,
  ],
  exports: [PurchaseInvoiceImportGateway, PostgresNotifyService],
})
export class RealtimeModule {}
