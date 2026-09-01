import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistorialFactura } from './entities/historial-factura.entity';
import { Integration } from './entities/integration.entity';
import { SiigoAccount } from './entities/siigo-account.entity';
import { SiigoPurchaseSyncJob } from './entities/siigo-purchase-sync-job.entity';
import { SupplierConfiguration } from './entities/supplier-configuration.entity';
import { SupplierItemAccountMapping } from './entities/supplier-item-account-mapping.entity';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { HistorialFacturasRepository } from './repositories/historial-facturas.repository';
import { IntegrationsRepository } from './repositories/integrations.repository';
import { SiigoAccountsRepository } from './repositories/siigo-accounts.repository';
import { SiigoPurchaseSyncJobsRepository } from './repositories/siigo-purchase-sync-jobs.repository';
import { SupplierConfigurationsRepository } from './repositories/supplier-configurations.repository';
import { SupplierItemAccountMappingsRepository } from './repositories/supplier-item-account-mappings.repository';
import { IntegrationSetupService } from './integration-setup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Integration,
      SupplierConfiguration,
      SupplierItemAccountMapping,
      SiigoAccount,
      HistorialFactura,
      SiigoPurchaseSyncJob,
    ]),
  ],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsRepository,
    SiigoAccountsRepository,
    SupplierConfigurationsRepository,
    SupplierItemAccountMappingsRepository,
    HistorialFacturasRepository,
    SiigoPurchaseSyncJobsRepository,
    IntegrationSetupService,
    IntegrationsService,
  ],
  exports: [
    IntegrationsRepository,
    SiigoAccountsRepository,
    SupplierConfigurationsRepository,
    SupplierItemAccountMappingsRepository,
    HistorialFacturasRepository,
    SiigoPurchaseSyncJobsRepository,
    IntegrationSetupService,
    IntegrationsService,
    TypeOrmModule,
  ],
})
export class IntegrationModule {}
