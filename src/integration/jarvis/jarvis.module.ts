import { PayrollController } from '../../payroll/payroll.controller';
import { PayrollService } from '../../payroll/payroll.service';
import { PayrollGuard } from '../../payroll/payroll.guard';
import { JarvisSellersController } from './jarvis-sellers.controller';
import { JarvisInvoiceDraftsController } from './jarvis-invoice-drafts.controller';
import { JarvisDashboardService } from './jarvis-dashboard.service';
import { JarvisRadianEvent } from './entities/jarvis-radian-event.entity';
import { JarvisRadianEventsRepository } from './repositories/jarvis-radian-events.repository';
import { JarvisRadianService } from './jarvis-radian.service';
import { JarvisInvoicePdfService } from './jarvis-invoice-pdf.service';
import { JarvisPaymentMethod } from './entities/jarvis-payment-method.entity';
import { JarvisPaymentMethodsService } from './jarvis-payment-methods.service';
import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module';
import { CompanyModule } from '../../company/company.module';
import { ElectronicDocumentModule } from '../../electronic-document/electronic-document.module';
import { PlanModule } from '../../plan/plan.module';
import { IntegrationModule } from '../integration.module';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { JarvisInvoiceHistoryService } from './jarvis-invoice-history.service';
import { JarvisTax } from './entities/jarvis-tax.entity';
import { JarvisTercero } from './entities/jarvis-tercero.entity';
import { JarvisController } from './jarvis.controller';
import { JarvisDocumentPreparationService } from './jarvis-document-preparation.service';
import { JarvisInvoiceSendService } from './jarvis-invoice-send.service';
import { JarvisResolutionParserService } from './jarvis-resolution-parser.service';
import { JarvisSetupService } from './jarvis-setup.service';
import { JarvisSupportDocumentSendService } from './jarvis-support-document-send.service';
import { JarvisTaxesService } from './jarvis-taxes.service';
import { JarvisTercerosService } from './jarvis-terceros.service';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisTaxesRepository } from './repositories/jarvis-taxes.repository';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';

@Module({
  imports: [
    HttpModule,
    AppConfigModule,
    forwardRef(() => PlanModule),
    forwardRef(() => IntegrationModule),
    CompanyModule,
    forwardRef(() => ElectronicDocumentModule),
    TypeOrmModule.forFeature([JarvisRadianEvent, JarvisPaymentMethod, JarvisTercero, JarvisTax, JarvisSalesInvoice]),
  ],
  controllers: [JarvisController, JarvisSellersController, JarvisInvoiceDraftsController, PayrollController],
  providers: [
    PayrollService,
    PayrollGuard,
    JarvisDashboardService,
    JarvisRadianService,
    JarvisRadianEventsRepository,
    JarvisInvoicePdfService,
    JarvisPaymentMethodsService,
    JarvisInvoiceHistoryService,
    JarvisSetupService,
    JarvisTercerosService,
    JarvisTaxesService,
    JarvisDocumentPreparationService,
    JarvisSupportDocumentSendService,
    JarvisInvoiceSendService,
    JarvisResolutionParserService,
    NextPymeApiClient,
    NextPymeMasterCatalogService,
    NextPymeRutService,
    JarvisTercerosRepository,
    JarvisTaxesRepository,
  ],
  exports: [
    JarvisSetupService,
    JarvisTercerosService,
    JarvisTercerosRepository,
    JarvisTaxesService,
    JarvisTaxesRepository,
    JarvisDocumentPreparationService,
    JarvisSupportDocumentSendService,
    NextPymeApiClient,
    NextPymeMasterCatalogService,
    NextPymeRutService,
  ],
})
export class JarvisModule {}
