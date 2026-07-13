import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from './entities/integration.entity';
import { SupplierConfiguration } from './entities/supplier-configuration.entity';
import { IntegrationsRepository } from './repositories/integrations.repository';
import { SupplierConfigurationsRepository } from './repositories/supplier-configurations.repository';
import { IntegrationSetupService } from './integration-setup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Integration, SupplierConfiguration])],
  providers: [
    IntegrationsRepository,
    SupplierConfigurationsRepository,
    IntegrationSetupService,
  ],
  exports: [
    IntegrationsRepository,
    SupplierConfigurationsRepository,
    IntegrationSetupService,
    TypeOrmModule,
  ],
})
export class IntegrationModule {}
