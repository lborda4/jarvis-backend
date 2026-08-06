import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CompanyModule } from '../../company/company.module';
import { ElectronicDocumentModule } from '../../electronic-document/electronic-document.module';
import { PlanModule } from '../../plan/plan.module';
import { IntegrationModule } from '../integration.module';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoController } from './siigo.controller';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoPurchaseCreationService } from './siigo-purchase-creation.service';
import { SiigoPurchaseService } from './siigo-purchase.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoSupplierCreationService } from './siigo-supplier-creation.service';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';
import { SiigoDocumentPreparationService } from './siigo-document-preparation.service';
import { SiigoDocumentResumeService } from './siigo-document-resume.service';
import { SiigoBalanceTrialImportService } from './siigo-balance-trial-import.service';
import { SiigoAccountsBalanceSyncService } from './siigo-accounts-balance-sync.service';
import { SiigoValidationService } from './siigo-validation.service';
import { SiigoSupportDocumentService } from './siigo-support-document.service';
import { SiigoSupportDocumentSendService } from './siigo-support-document-send.service';
import { SiigoPurchaseSendService } from './siigo-purchase-send.service';
import { SiigoDocumentTypesService } from './siigo-document-types.service';
import { SiigoDocumentCreationService } from './siigo-document-creation.service';
import { SiigoDocumentCreationRegistry } from './siigo-document-creation.registry';
import { SiigoPurchaseDocumentCreationHandler } from './handlers/siigo-purchase-document-creation.handler';
import { SiigoSupportDocumentCreationHandler } from './handlers/siigo-support-document-creation.handler';
import { SiigoPaymentTypesCatalogService } from './siigo-payment-types-catalog.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoDocumentSendThrottleService } from './siigo-document-send-throttle.service';
import { SiigoCatalogSyncService } from './siigo-catalog-sync.service';

@Module({
  imports: [
    HttpModule,
    IntegrationModule,
    CompanyModule,
    ElectronicDocumentModule,
    PlanModule,
  ],
  controllers: [SiigoController],
  providers: [
    SiigoHttpClient,
    SiigoAuthService,
    SiigoSupplierService,
    SiigoPurchaseService,
    SiigoSupportDocumentService,
    SiigoSupportDocumentSendService,
    SiigoPurchaseSendService,
    SiigoDocumentTypesService,
    SiigoValidationService,
    SiigoSupplierCreationService,
    SiigoAccountMappingService,
    SiigoPurchaseDocumentCreationHandler,
    SiigoSupportDocumentCreationHandler,
    {
      provide: SiigoDocumentCreationRegistry,
      useFactory: (
        purchaseHandler: SiigoPurchaseDocumentCreationHandler,
        supportHandler: SiigoSupportDocumentCreationHandler,
      ) =>
        new SiigoDocumentCreationRegistry([purchaseHandler, supportHandler]),
      inject: [
        SiigoPurchaseDocumentCreationHandler,
        SiigoSupportDocumentCreationHandler,
      ],
    },
    SiigoDocumentCreationService,
    SiigoPurchaseCreationService,
    SiigoDocumentResumeService,
    SiigoDocumentPreparationService,
    SiigoAccountsCatalogService,
    SiigoCatalogSyncService,
    SiigoConfigurationCacheService,
    SiigoDocumentSendThrottleService,
    SiigoPaymentTypesCatalogService,
    SiigoCostCentersCatalogService,
    SiigoTaxesCatalogService,
    SiigoBalanceTrialImportService,
    SiigoAccountsBalanceSyncService,
  ],
  exports: [
    SiigoValidationService,
    SiigoSupplierCreationService,
    SiigoAccountMappingService,
    SiigoPurchaseCreationService,
    SiigoDocumentCreationService,
    SiigoDocumentPreparationService,
    SiigoAccountsCatalogService,
    SiigoTaxesCatalogService,
  ],
})
export class SiigoModule {}
