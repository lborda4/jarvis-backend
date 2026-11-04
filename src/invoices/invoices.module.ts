import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { CompanyModule } from '../company/company.module';
import { DianModule } from '../dian/dian.module';
import { ElectronicDocumentModule } from '../electronic-document/electronic-document.module';
import { JarvisModule } from '../integration/jarvis/jarvis.module';
import { SiigoModule } from '../integration/siigo/siigo.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PurchaseInvoiceImportSharedModule } from './purchase-invoice-import-shared.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PurchaseInvoiceImportWorkerService } from './services/purchase-invoice-import-worker.service';

/** La solicitud inicia el procesamiento en segundo plano, sin temporizadores. */
@Module({
  imports: [
    PurchaseInvoiceImportSharedModule,
    RealtimeModule,
    CommonModule,
    CompanyModule,
    DianModule,
    ElectronicDocumentModule,
    SiigoModule,
    JarvisModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, PurchaseInvoiceImportWorkerService],
})
export class InvoicesModule {}
