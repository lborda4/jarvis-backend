import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Integration } from './entities/integration.entity';
import { ensureSiigoIntegration } from './helpers/integration-setup.helper';

@Injectable()
export class IntegrationSetupService {
  constructor(private readonly dataSource: DataSource) {}

  async ensureSiigoIntegration(companyId: string): Promise<Integration> {
    return this.dataSource.transaction(async (manager) =>
      ensureSiigoIntegration(manager, companyId),
    );
  }
}
