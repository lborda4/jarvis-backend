import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CompanyModule } from '../../company/company.module';
import { ElectronicDocumentModule } from '../../electronic-document/electronic-document.module';
import { PlanModule } from '../../plan/plan.module';
import { IntegrationModule } from '../integration.module';
import { JarvisModule } from '../jarvis/jarvis.module';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoController } from './siigo.controller';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoPurchaseCreationService } from './siigo-purchase-creation.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoSupplierCreationService } from './siigo-supplier-creation.service';
import { SiigoAccountsCatalogService } from './siigo-accounts-catalog.service';
import { SiigoDocumentPreparationService } from './siigo-document-preparation.service';
import { SiigoDocumentResumeService } from './siigo-document-resume.service';
import { SiigoAccountsImportService } from './siigo-accounts-import.service';
import { SiigoAccountsBalanceSyncService } from './siigo-accounts-balance-sync.service';
import { SiigoValidationService } from './siigo-validation.service';
import { SiigoSupportDocumentSendService } from './siigo-support-document-send.service';
import { SiigoPurchaseSendService } from './siigo-purchase-send.service';
import { SiigoDocumentTypesService } from './siigo-document-types.service';
import { SiigoDocumentCreationService } from './siigo-document-creation.service';
import { SiigoDocumentCreationRegistry } from './siigo-document-creation.registry';
import { SiigoPurchaseDocumentCreationHandler } from './handlers/siigo-purchase-document-creation.handler';
import { SiigoSupportDocumentCreationHandler } from './handlers/siigo-support-document-creation.handler';
import { SiigoPaymentTypesCatalogService } from './siigo-payment-types-catalog.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';
import { SiigoProductsCatalogService } from './siigo-products-catalog.service';
import { SiigoTaxesCatalogService } from './siigo-taxes-catalog.service';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoDocumentSendThrottleService } from './siigo-document-send-throttle.service';
import { SiigoCatalogSyncService } from './siigo-catalog-sync.service';
import { SiigoAiAccountSuggestionService } from './siigo-ai-account-suggestion.service';
import { SiigoPurchaseHistorySyncService } from './siigo-purchase-history-sync.service';
import { SiigoPurchaseHistoryAutoSyncService } from './siigo-purchase-history-auto-sync.service';
import { SiigoPurchaseAiClassificationService } from './siigo-purchase-ai-classification.service';
import { OpenRouterModule } from '../openrouter/openrouter.module';

@Module({
  imports: [
    HttpModule,
    IntegrationModule,
    CompanyModule,
    forwardRef(() => ElectronicDocumentModule),
    PlanModule,
    OpenRouterModule,
    JarvisModule,
  ],
  controllers: [SiigoController],
  providers: [
    SiigoHttpClient,
    SiigoAuthService,
    SiigoSupplierService,
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
      ) => new SiigoDocumentCreationRegistry([purchaseHandler, supportHandler]),
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
    SiigoProductsCatalogService,
    SiigoTaxesCatalogService,
    SiigoAccountsImportService,
    SiigoAccountsBalanceSyncService,
    SiigoAiAccountSuggestionService,
    SiigoPurchaseHistorySyncService,
    SiigoPurchaseHistoryAutoSyncService,
    SiigoPurchaseAiClassificationService,
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
    SiigoPaymentTypesCatalogService,
    SiigoProductsCatalogService,
    SiigoPurchaseAiClassificationService,
  ],
})
export class SiigoModule {}
