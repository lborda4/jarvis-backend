import { AdminService } from './admin.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

describe('Admin tracking document balances', () => {
  function setup() {
    const company = { id: 'company', name: 'Cliente', createdAt: new Date('2026-01-01'), integrations: [
      { id: 'jarvis', provider: IntegrationProvider.JARVIS, active: true, plan: { id: 'annual', documentLimit: 50 } },
      { id: 'siigo', provider: IntegrationProvider.SIIGO, active: true, plan: null, documentLimits: { SUPPORT_DOCUMENT: 100 } },
      { id: 'bold', provider: IntegrationProvider.BOLD, active: true, plan: null },
    ] };
    const companies = { findAllWithIntegrations: jest.fn().mockResolvedValue([company]), findById: jest.fn().mockResolvedValue(company), save: jest.fn() };
    const plans = { resolveIncludedDocumentTypes: () => [], getSubscription: jest.fn(async (_companyId, provider) => provider === IntegrationProvider.JARVIS
      ? { documentLimit: 50, documentsUsed: 12, remaining: 38 }
      : { documentLimit: 100, documentsUsed: 100, remaining: 0 }) };
    const service = new AdminService({ transaction: async work => work({ getRepository: () => ({ findOne: companies.findById, save: companies.save }) }) } as never, companies as never, {} as never, {} as never, plans as never, {} as never, {} as never, {} as never);
    return { service, company, companies, plans };
  }
  it('uses the shared subscription calculation for Jarvis and manual Siigo quotas, excluding Bold', async () => {
    const { service, plans } = setup();
    const item = (await service.listCompanies('admin')).items[0];
    expect(item.integrations.find(value => value.provider === IntegrationProvider.JARVIS)?.documentQuota).toEqual({ documentLimit: 50, documentsUsed: 12, remaining: 38 });
    expect(item.integrations.find(value => value.provider === IntegrationProvider.SIIGO)?.documentQuota?.remaining).toBe(0);
    expect(plans.getSubscription.mock.calls).toEqual(expect.arrayContaining([['company', IntegrationProvider.JARVIS], ['company', IntegrationProvider.SIIGO]]));
    expect(plans.getSubscription).toHaveBeenCalledTimes(2);
  });
  it('preserves unlimited balances without confusing them with missing plans', async () => {
    const { service, company, plans } = setup();
    company.integrations = company.integrations.filter(item => item.provider === IntegrationProvider.JARVIS);
    plans.getSubscription.mockResolvedValue({ documentLimit: null, documentsUsed: 80, remaining: null });
    expect((await service.listCompanies('admin')).items[0].integrations[0].documentQuota).toEqual({ documentLimit: null, documentsUsed: 80, remaining: null });
    company.integrations[0].plan = null;
    expect((await service.listCompanies('admin')).items[0].integrations[0].documentQuota).toBeUndefined();
    expect(plans.getSubscription).toHaveBeenCalledTimes(1);
  });
  it('retains balances after editing tracking', async () => {
    const { service } = setup();
    const result = await service.updateCompanyTracking('company', { commercial: 'Laura', billingCycle: 'MONTHLY' });
    expect(result.company.integrations.find(value => value.provider === IntegrationProvider.JARVIS)?.documentQuota?.remaining).toBe(38);
  });
});
