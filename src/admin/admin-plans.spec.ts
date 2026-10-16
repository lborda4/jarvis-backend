import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

const id = '11111111-1111-4111-8111-111111111101';
function setup(provider = IntegrationProvider.SIIGO) {
  const plan = { id, provider, name: 'Basico', code: 'basic', documentLimit: 100, includedDocumentTypes: [] };
  const save = jest.fn(async value => value);
  const plans = { findById: jest.fn().mockResolvedValue(plan) };
  const service = new AdminService(
    { getRepository: () => ({ save }) } as never, {} as never, plans as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  return { service, plan, plans, save };
}

describe('Admin plan editing', () => {
  it.each([IntegrationProvider.SIIGO, IntegrationProvider.JARVIS])('updates %s without changing provider or code', async provider => {
    const { service, save } = setup(provider);
    const result = await service.updatePlan(id, { name: ' Plan 50 ', documentLimit: 50 });
    expect(result.plan).toMatchObject({ id, provider, code: 'basic', name: 'Plan 50', documentLimit: 50 });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('supports unlimited plans', async () => {
    const { service } = setup();
    expect((await service.updatePlan(id, { name: 'Ilimitado', documentLimit: null })).plan.documentLimit).toBeNull();
  });
  it.each([undefined, -1, 0, 1.5, '50', 2147483648])('rejects invalid quota %s without saving', async documentLimit => {
    const { service, save } = setup();
    await expect(service.updatePlan(id, { name: 'Plan', documentLimit } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects blank names', async () => {
    const { service, save } = setup();
    await expect(service.updatePlan(id, { name: ' ', documentLimit: 20 })).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects malformed identifiers', async () => {
    const { service, plans } = setup();
    await expect(service.updatePlan('invalid', { name: 'Plan', documentLimit: 20 })).rejects.toBeInstanceOf(BadRequestException);
    expect(plans.findById).not.toHaveBeenCalled();
  });
  it('reports missing plans', async () => {
    const { service, plans } = setup();
    plans.findById.mockResolvedValue(null);
    await expect(service.updatePlan(id, { name: 'Plan', documentLimit: 20 })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects plans from other providers', async () => {
    const { service, save } = setup(IntegrationProvider.BOLD);
    await expect(service.updatePlan(id, { name: 'Plan', documentLimit: 20 })).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });
});