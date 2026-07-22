import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from './entities/integration.entity';
import { SiigoAccount } from './entities/siigo-account.entity';
import { SupplierConfiguration } from './entities/supplier-configuration.entity';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationsRepository } from './repositories/integrations.repository';
import { SiigoAccountsRepository } from './repositories/siigo-accounts.repository';
import { SupplierConfigurationsRepository } from './repositories/supplier-configurations.repository';
import { IntegrationSetupService } from './integration-setup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Integration, SupplierConfiguration, SiigoAccount]),
  ],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsRepository,
    SiigoAccountsRepository,
    SupplierConfigurationsRepository,
    IntegrationSetupService,
    IntegrationsService,
  ],
  exports: [
    IntegrationsRepository,
    SiigoAccountsRepository,
    SupplierConfigurationsRepository,
    IntegrationSetupService,
    IntegrationsService,
    TypeOrmModule,
  ],
})
export class IntegrationModule {}
