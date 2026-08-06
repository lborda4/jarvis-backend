import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { DianModule } from '../dian/dian.module';
import { ElectronicDocumentModule } from '../electronic-document/electronic-document.module';
import { JarvisModule } from '../integration/jarvis/jarvis.module';
import { SiigoModule } from '../integration/siigo/siigo.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [
    CommonModule,
    DianModule,
    ElectronicDocumentModule,
    SiigoModule,
    JarvisModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
