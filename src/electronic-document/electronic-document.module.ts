import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyModule } from '../company/company.module';
import { IntegrationModule } from '../integration/integration.module';
import { ElectronicDocumentController } from './electronic-document.controller';
import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocument } from './entities/electronic-document.entity';
import { ElectronicDocumentsRepository } from './repositories/electronic-documents.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ElectronicDocument]), CompanyModule, IntegrationModule],
  controllers: [ElectronicDocumentController],
  providers: [ElectronicDocumentsRepository, ElectronicDocumentService],
  exports: [ElectronicDocumentService, ElectronicDocumentsRepository, TypeOrmModule],
})
export class ElectronicDocumentModule {}
