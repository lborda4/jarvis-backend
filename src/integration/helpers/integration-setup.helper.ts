import { EntityManager } from 'typeorm';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { Integration } from '../entities/integration.entity';

export async function ensureSiigoIntegration(
  manager: EntityManager,
  companyId: string,
): Promise<Integration> {
  return ensureIntegration(
    manager,
    companyId,
    IntegrationProvider.SIIGO,
    {
      username: '',
      access_key: '',
    },
  );
}

export async function ensureJarvisIntegration(
  manager: EntityManager,
  companyId: string,
  credentials: Integration['credentials'] = {},
): Promise<Integration> {
  return ensureIntegration(
    manager,
    companyId,
    IntegrationProvider.JARVIS,
    credentials,
  );
}

async function ensureIntegration(
  manager: EntityManager,
  companyId: string,
  provider: IntegrationProvider,
  credentials: Integration['credentials'],
): Promise<Integration> {
  const repository = manager.getRepository(Integration);
  const existingIntegration = await repository.findOne({
    where: {
      provider,
      companyId,
      active: true,
    },
  });

  if (existingIntegration) {
    return existingIntegration;
  }

  const integration = repository.create({
    companyId,
    provider,
    credentials,
    active: true,
  });

  return repository.save(integration);
}
