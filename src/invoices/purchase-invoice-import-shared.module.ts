import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceImportJob } from './entities/purchase-invoice-import-job.entity';
import { PurchaseInvoiceImportJobRow } from './entities/purchase-invoice-import-job-row.entity';
import { PurchaseInvoiceImportJobsRepository } from './repositories/purchase-invoice-import-jobs.repository';
import { PurchaseInvoiceImportJobRowsRepository } from './repositories/purchase-invoice-import-job-rows.repository';
import { PurchaseInvoiceImportStatusService } from './services/purchase-invoice-import-status.service';

/**
 * Piezas de la importación de Factura de compra que necesitan tanto
 * InvoicesModule (procesamiento) como RealtimeModule (snapshot de estado al
 * suscribirse por WebSocket) — separado en su propio módulo para que
 * ninguno de los dos tenga que importar al otro completo (evita un ciclo).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseInvoiceImportJob,
      PurchaseInvoiceImportJobRow,
    ]),
  ],
  providers: [
    PurchaseInvoiceImportJobsRepository,
    PurchaseInvoiceImportJobRowsRepository,
    PurchaseInvoiceImportStatusService,
  ],
  exports: [
    PurchaseInvoiceImportJobsRepository,
    PurchaseInvoiceImportJobRowsRepository,
    PurchaseInvoiceImportStatusService,
  ],
})
export class PurchaseInvoiceImportSharedModule {}
