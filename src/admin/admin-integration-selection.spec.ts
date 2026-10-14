import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

it.each([IntegrationProvider.JARVIS, IntegrationProvider.SIIGO])('reactiva %s sin reemplazar credenciales ni plan', async provider => {
  const existing = { id: 'integration', companyId: 'company', provider, active: false, credentials: { secret: 'keep' }, planId: 'plan', subscriptionStartedAt: new Date('2026-01-01') };
  const repository = {
    findOne: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockResolvedValue(existing),
  };
  const company = { id: 'company', nit: '900000000', name: 'Empresa', createdAt: new Date(), integrations: [] };
  const dataSource = { transaction: jest.fn(async work => work({ getRepository: entity => entity === Company ? { findOne: jest.fn().mockResolvedValue(company) } : repository })) };
  const service = new AdminService(dataSource as never, { findAllWithIntegrations: jest.fn().mockResolvedValue([company]) } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  await service.selectCompanyIntegration('company', provider);
  expect(repository.findOne).toHaveBeenCalledWith({ where: { companyId: 'company', provider } });
  expect(repository.update).toHaveBeenCalledWith({ companyId: 'company', provider: provider === IntegrationProvider.JARVIS ? IntegrationProvider.SIIGO : IntegrationProvider.JARVIS }, { active: false });
  expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ active: true, credentials: { secret: 'keep' }, planId: 'plan', subscriptionStartedAt: new Date('2026-01-01') }));
});
