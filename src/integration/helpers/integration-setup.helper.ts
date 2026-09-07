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

/** Bold no persiste credenciales todavía — la llave de identidad (x-api-key)
 * la ingresa el admin en el panel cada vez que hace falta y viaja solo en
 * esa llamada puntual (ver BoldController/BoldTerminalsService), nunca se
 * guarda acá. Esta integración solo marca que la empresa tiene Bold activo. */
export async function ensureBoldIntegration(
  manager: EntityManager,
  companyId: string,
): Promise<Integration> {
  return ensureIntegration(manager, companyId, IntegrationProvider.BOLD, {});
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
