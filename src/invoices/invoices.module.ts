import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { DianModule } from '../dian/dian.module';
import { ElectronicDocumentModule } from '../electronic-document/electronic-document.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [CommonModule, DianModule, ElectronicDocumentModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
