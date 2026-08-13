import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyModule } from '../company/company.module';
import { IntegrationModule } from '../integration/integration.module';
import { JarvisModule } from '../integration/jarvis/jarvis.module';
import { SiigoModule } from '../integration/siigo/siigo.module';
import { PlanModule } from '../plan/plan.module';
import { ElectronicDocumentController } from './electronic-document.controller';
import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocument } from './entities/electronic-document.entity';
import { ElectronicDocumentsRepository } from './repositories/electronic-documents.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([ElectronicDocument]),
    CompanyModule,
    IntegrationModule,
    PlanModule,
    forwardRef(() => JarvisModule),
    forwardRef(() => SiigoModule),
  ],
  controllers: [ElectronicDocumentController],
  providers: [ElectronicDocumentsRepository, ElectronicDocumentService],
  exports: [ElectronicDocumentService, ElectronicDocumentsRepository, TypeOrmModule],
})
export class ElectronicDocumentModule {}
