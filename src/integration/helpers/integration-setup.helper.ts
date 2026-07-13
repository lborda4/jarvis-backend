import { EntityManager } from 'typeorm';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { Integration } from '../entities/integration.entity';

export async function ensureSiigoIntegration(
  manager: EntityManager,
  companyId: string,
): Promise<Integration> {
  const repository = manager.getRepository(Integration);
  const existingIntegration = await repository.findOne({
    where: {
      provider: IntegrationProvider.SIIGO,
      companyId,
      active: true,
    },
  });

  if (existingIntegration) {
    return existingIntegration;
  }

  const integration = repository.create({
    companyId,
    provider: IntegrationProvider.SIIGO,
    credentials: {
      username: '',
      access_key: '',
    },
    configuration: {},
    active: true,
  });

  return repository.save(integration);
}
