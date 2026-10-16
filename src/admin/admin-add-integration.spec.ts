import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

function setup(existing: Record<string, unknown> | null = null, companyExists = true) {
  const siigo = { id: 'siigo', companyId: 'company', provider: IntegrationProvider.SIIGO, active: true, credentials: { secret: 'keep' }, planId: 'plan', subscriptionStartedAt: new Date('2026-01-01') };
  const company = { id: 'company', nit: '900000000', name: 'Empresa', createdAt: new Date(), integrations: [siigo] as Record<string, unknown>[] };
  if (existing) company.integrations.push(existing);
  const repository = {
    findOne: jest.fn().mockResolvedValue(existing),
    update: jest.fn(),
    create: jest.fn(value => ({ id: 'new', ...value })),
    save: jest.fn(async value => {
      if (!company.integrations.includes(value)) company.integrations.push(value);
      return value;
    }),
  };
  const findCompany = jest.fn().mockResolvedValue(companyExists ? company : null);
  const dataSource = { transaction: jest.fn(async work => work({ getRepository: entity => entity === Company ? { findOne: findCompany } : repository })) };
  const service = new AdminService(dataSource as never, { findAllWithIntegrations: jest.fn().mockResolvedValue([company]) } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { service, repository, siigo, dataSource };
}

describe('Adding company integrations', () => {
  it.each([IntegrationProvider.BOLD, IntegrationProvider.JARVIS])('adds %s while preserving Siigo and its plan', async provider => {
    const { service, repository, siigo } = setup();
    const result = await service.addCompanyIntegration('company', provider);
    expect(result.company.integrations.map(item => item.provider)).toEqual(expect.arrayContaining([IntegrationProvider.SIIGO, provider]));
    expect(repository.update).not.toHaveBeenCalled();
    expect(siigo).toMatchObject({ active: true, planId: 'plan', credentials: { secret: 'keep' }, subscriptionStartedAt: new Date('2026-01-01') });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ provider, companyId: 'company', active: true }));
  });
  it('reactivates an existing integration preserving credentials and subscription', async () => {
    const existing = { id: 'bold', provider: IntegrationProvider.BOLD, active: false, credentials: { secret: 'bold-secret' }, planId: 'bold-plan' };
    const { service, repository } = setup(existing);
    await service.addCompanyIntegration('company', IntegrationProvider.BOLD);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ active: true, credentials: { secret: 'bold-secret' }, planId: 'bold-plan' }));
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('does not duplicate an active integration', async () => {
    const { service, repository } = setup({ id: 'bold', provider: IntegrationProvider.BOLD, active: true });
    await service.addCompanyIntegration('company', IntegrationProvider.BOLD);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
  it('rejects unsupported providers before making changes', async () => {
    const { service, dataSource } = setup();
    await expect(service.addCompanyIntegration('company', 'INVALID' as IntegrationProvider)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
  it('rejects missing companies', async () => {
    const { service, repository } = setup(null, false);
    await expect(service.addCompanyIntegration('company', IntegrationProvider.BOLD)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});