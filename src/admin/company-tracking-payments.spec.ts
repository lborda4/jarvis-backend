import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { SubscriptionStatus } from '../plan/enums/subscription-status.enum';

describe('Company tracking payments', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-11T15:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  function setup() {
    const startedAt = new Date('2026-09-09T15:00:00Z');
    const integration = { id: 'siigo', provider: IntegrationProvider.SIIGO, active: true, subscriptionStatus: SubscriptionStatus.SUSPENDED, subscriptionStartedAt: startedAt, plan: null };
    const company = { id: 'company', name: 'Cliente', createdAt: startedAt, billingMonths: 1, billingCycle: 'MONTHLY', trackingPeriodStart: null, trackingLastPaidAt: null, integrations: [integration] } as unknown as Company;
    const repository = { findOne: jest.fn().mockResolvedValue(company), save: jest.fn() };
    const update = jest.fn(async (_criteria, changes) => { Object.assign(integration, changes); });
    const dataSource = { transaction: jest.fn(async work => work({ getRepository: entity => entity === Company ? repository : { update } })) };
    const service = new AdminService(dataSource as never, { findAllWithIntegrations: async () => [company] } as never, {} as never, {} as never, { resolveIncludedDocumentTypes: () => [] } as never, {} as never, {} as never, {} as never);
    return { service, company, integration, repository, update, startedAt };
  }
  it('renews overdue clients from today and activates their plan without restarting document usage', async () => {
    const { service, company, repository, update, integration, startedAt } = setup();
    const result = await service.updateCompanyTracking('company', { billingMonths: 1, paymentReceived: true, expectedDueDate: '2026-10-09' });
    expect(result.company.subscriptionDueDate).toBe('2026-12-11');
    expect(result.company.trackingLastPaidAt).toBe('2026-11-11T15:00:00.000Z');
    expect(company.trackingPeriodStart).toBe('2026-11-11');
    expect(integration.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(integration.subscriptionStartedAt).toBe(startedAt);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'company', active: true }), { subscriptionStatus: SubscriptionStatus.ACTIVE });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'company' }, lock: { mode: 'pessimistic_write' } });
  });
  it('adds the configured period to a future due date instead of losing prepaid days', async () => {
    const { service, company } = setup();
    company.trackingPeriodStart = '2026-11-30';
    const result = await service.updateCompanyTracking('company', { billingMonths: 3, paymentReceived: true, expectedDueDate: '2026-12-30' });
    expect(result.company.subscriptionDueDate).toBe('2027-03-30');
  });
  it('does not extend again when the administrator saves unrelated changes', async () => {
    const { service, update } = setup();
    await service.updateCompanyTracking('company', { billingMonths: 1, paymentReceived: true, expectedDueDate: '2026-10-09' });
    const result = await service.updateCompanyTracking('company', { commercial: 'Laura', billingMonths: 1, paymentReceived: false });
    expect(result.company.subscriptionDueDate).toBe('2026-12-11');
    expect(result.company.trackingLastPaidAt).toBe('2026-11-11T15:00:00.000Z');
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('rejects repeated requests for the same due date', async () => {
    const { service, update } = setup();
    const request = { billingMonths: 1, paymentReceived: true, expectedDueDate: '2026-10-09' };
    await service.updateCompanyTracking('company', request);
    await expect(service.updateCompanyTracking('company', request)).rejects.toThrow('El vencimiento cambió');
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('requires the displayed due date and rejects invalid payment indicators before saving', async () => {
    const { service, repository, update } = setup();
    await expect(service.updateCompanyTracking('company', { billingMonths: 1, paymentReceived: true })).rejects.toThrow('El vencimiento cambió');
    await expect(service.updateCompanyTracking('company', { billingMonths: 1, paymentReceived: 'true' as never })).rejects.toThrow('pago');
    expect(repository.save).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('preserves the current due date and subscription status without a new payment', async () => {
    const { service, update, integration } = setup();
    const result = await service.updateCompanyTracking('company', { billingMonths: 1, paymentReceived: false });
    expect(result.company.subscriptionDueDate).toBe('2026-10-09');
    expect(result.company.trackingLastPaidAt).toBeNull();
    expect(integration.subscriptionStatus).toBe(SubscriptionStatus.SUSPENDED);
    expect(update).not.toHaveBeenCalled();
  });
});
