import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module';
import { CompanyModule } from '../../company/company.module';
import { ElectronicDocumentModule } from '../../electronic-document/electronic-document.module';
import { PlanModule } from '../../plan/plan.module';
import { IntegrationModule } from '../integration.module';
import { JarvisTercero } from './entities/jarvis-tercero.entity';
import { JarvisController } from './jarvis.controller';
import { JarvisDocumentPreparationService } from './jarvis-document-preparation.service';
import { JarvisInvoiceSendService } from './jarvis-invoice-send.service';
import { JarvisResolutionParserService } from './jarvis-resolution-parser.service';
import { JarvisSetupService } from './jarvis-setup.service';
import { JarvisSupportDocumentSendService } from './jarvis-support-document-send.service';
import { JarvisTercerosService } from './jarvis-terceros.service';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';

@Module({
  imports: [
    HttpModule,
    AppConfigModule,
    PlanModule,
    IntegrationModule,
    CompanyModule,
    forwardRef(() => ElectronicDocumentModule),
    TypeOrmModule.forFeature([JarvisTercero]),
  ],
  controllers: [JarvisController],
  providers: [
    JarvisSetupService,
    JarvisTercerosService,
    JarvisDocumentPreparationService,
    JarvisSupportDocumentSendService,
    JarvisInvoiceSendService,
    JarvisResolutionParserService,
    NextPymeApiClient,
    NextPymeMasterCatalogService,
    NextPymeRutService,
    JarvisTercerosRepository,
  ],
  exports: [
    JarvisSetupService,
    JarvisTercerosService,
    JarvisTercerosRepository,
    JarvisDocumentPreparationService,
    JarvisSupportDocumentSendService,
    NextPymeApiClient,
    NextPymeMasterCatalogService,
    NextPymeRutService,
  ],
})
export class JarvisModule {}
