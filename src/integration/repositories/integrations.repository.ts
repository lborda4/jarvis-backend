import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from '../entities/integration.entity';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationCredentials } from '../interfaces/integration-credentials.interface';

@Injectable()
export class IntegrationsRepository {
  constructor(
    @InjectRepository(Integration)
    private readonly repository: Repository<Integration>,
  ) {}

  findByCompanyAndProvider(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<Integration | null> {
    return this.repository.findOne({
      where: { companyId, provider, active: true },
    });
  }

  findByCompanyAndProviderWithPlan(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<Integration | null> {
    return this.repository.findOne({
      where: { companyId, provider, active: true },
      relations: { plan: true },
    });
  }

  findByIdWithPlan(id: string): Promise<Integration | null> {
    return this.repository.findOne({
      where: { id },
      relations: { plan: true },
    });
  }

  create(
    data: Pick<
      Integration,
      'companyId' | 'provider' | 'credentials' | 'active'
    > &
      Partial<
        Pick<Integration, 'plan' | 'subscriptionStartedAt' | 'subscriptionStatus'>
      >,
  ): Integration {
    return this.repository.create(data);
  }

  findAllByCompanyId(companyId: string): Promise<Integration[]> {
    return this.repository.find({
      where: { companyId, active: true },
      relations: { plan: true },
      order: { provider: 'ASC' },
    });
  }

  save(integration: Integration): Promise<Integration> {
    return this.repository.save(integration);
  }

  async updateCredentials(
    integration: Integration,
    credentials: IntegrationCredentials,
  ): Promise<Integration> {
    integration.credentials = credentials;
    return this.repository.save(integration);
  }
}
