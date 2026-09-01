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

/**
 * PurchaseInvoiceImportWorkerService corre en el mismo proceso que la API
 * (registrado acá, no en un módulo/proceso aparte) — arranca solo al
 * levantar la app (OnApplicationBootstrap) y queda corriendo su loop de
 * polling en segundo plano, desacoplado de los endpoints HTTP: el
 * controller solo crea el job/filas y responde; el worker las descubre y
 * procesa por su cuenta. `npm run start`/`start:dev` alcanza para levantar
 * API + procesamiento en background — no hace falta un proceso aparte.
 */
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
