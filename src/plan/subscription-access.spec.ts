import { ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { subscriptionAccess, isSubscriptionMutation } from './subscription-access';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { jarvisConsumptionStart, jarvisDocumentLimit, startJarvisDocumentCycle } from './jarvis-subscription';
import { listJarvisTopUps } from './jarvis-top-ups';

const now = new Date('2026-11-20T15:00:00Z');
const build = (provider = IntegrationProvider.JARVIS) => ({
  id: provider, companyId: 'client-a', active: true, provider, subscriptionStatus: 'ACTIVE',
  subscriptionStartedAt: new Date('2026-01-01T15:00:00Z'),
  company: { createdAt: new Date('2026-01-01T15:00:00Z'), billingMonths: 12, trackingPeriodStart: '2026-01-01' },
  plan: { documentLimit: 25 },
  jarvisCertificateTerm: { startsAt: '2026-01-01T15:00:00Z', endsAt: '2027-01-01T15:00:00Z' },
}) as Integration;

describe('subscription expiration and fresh document cycles', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());
  it('expires SIIGO at the beginning of its due date in Colombia', () => {
    const integration = build(IntegrationProvider.SIIGO);
    expect(subscriptionAccess(integration, new Date('2027-01-01T04:59:59Z')).canWrite).toBe(true);
    expect(subscriptionAccess(integration, new Date('2027-01-01T05:00:00Z'))).toMatchObject({ expired: true, canWrite: false, daysRemaining: 0 });
    expect(subscriptionAccess(integration, new Date('2026-12-22T05:00:00Z')).daysRemaining).toBe(10);
  });
  it('keeps the exact certificate expiration time for Jarvis and exposes ten calendar days', () => {
    const integration = build();
    expect(subscriptionAccess(integration, new Date('2026-12-22T23:00:00Z')).daysRemaining).toBe(10);
    expect(subscriptionAccess(integration, new Date('2027-01-01T14:59:59Z')).canWrite).toBe(true);
    expect(subscriptionAccess(integration, new Date('2027-01-01T15:00:00Z')).canWrite).toBe(false);
  });
  it.each([25, null])('zeros an expired balance including topups and unlimited plans (%s)', limit => {
    const integration = build();
    integration.plan!.documentLimit = limit;
    integration.topUpOperations = [{ id: 'old', status: 'APPLIED', createdAt: now.toISOString(), periodStart: '2026-01-01', topUps: [listJarvisTopUps()[3]] }];
    jest.setSystemTime(new Date('2027-01-01T15:00:00Z'));
    expect(jarvisDocumentLimit(integration)).toBe(0);
  });
  it('restarts usage and drops old credits even with the same saved certificate dates', () => {
    const integration = build();
    startJarvisDocumentCycle(integration, new Date('2026-10-01T15:00:00Z'));
    const oldCycleId = integration.jarvisDocumentCycle!.id;
    integration.topUpOperations = [{ id: 'old', cycleId: oldCycleId, status: 'APPLIED', createdAt: '2026-10-02T15:00:00Z', periodStart: '2026-01-01', topUps: [listJarvisTopUps()[3]] }];
    expect(jarvisDocumentLimit(integration)).toBe(125);
    startJarvisDocumentCycle(integration, now);
    expect(integration.jarvisDocumentCycle!.id).not.toBe(oldCycleId);
    expect(jarvisConsumptionStart(integration)).toEqual(now);
    expect(jarvisDocumentLimit(integration)).toBe(25);
    integration.topUpOperations.push({ id: 'new', cycleId: integration.jarvisDocumentCycle!.id, status: 'APPLIED', createdAt: now.toISOString(), periodStart: '2026-01-01', topUps: [listJarvisTopUps()[0]] });
    expect(jarvisDocumentLimit(integration)).toBe(35);
  });
});

describe('server read-only enforcement', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());
  const context = (method: string, originalUrl: string) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, originalUrl, user: { companyId: 'client-a' } }) }) }) as never;
  it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s reads and downloads without requiring a valid subscription', async method => {
    const repository = { findAllByCompanyId: jest.fn() };
    const next = { handle: jest.fn(() => of('read')) };
    await new SubscriptionAccessInterceptor(repository as never).intercept(context(method, '/invoices/file.pdf'), next);
    expect(next.handle).toHaveBeenCalled(); expect(repository.findAllByCompanyId).not.toHaveBeenCalled();
  });
  it.each(['/invoices/import', '/integrations/siigo/purchases', '/products', '/import-sessions/a'])('rejects an expired SIIGO write to %s before the handler', async path => {
    const integration = build(IntegrationProvider.SIIGO);
    integration.company.trackingPeriodStart = '2020-01-01';
    const repository = { findAllByCompanyId: jest.fn().mockResolvedValue([integration]) };
    const next = { handle: jest.fn(() => of('write')) };
    await expect(new SubscriptionAccessInterceptor(repository as never).intercept(context('POST', path), next)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findAllByCompanyId).toHaveBeenCalledWith('client-a'); expect(next.handle).not.toHaveBeenCalled();
  });
  it('selects the explicit provider and keeps admin renewal and authentication accessible', async () => {
    const siigo = build(IntegrationProvider.SIIGO); siigo.company.trackingPeriodStart = '2020-01-01';
    const jarvis = build();
    const repository = { findAllByCompanyId: jest.fn().mockResolvedValue([siigo, jarvis]) };
    const next = { handle: jest.fn(() => of('write')) };
    await new SubscriptionAccessInterceptor(repository as never).intercept(context('POST', '/integrations/jarvis/support-documents'), next);
    expect(next.handle).toHaveBeenCalled();
    for (const path of ['/admin/companies/a/tracking', '/auth/login', '/subscriptions/access']) expect(isSubscriptionMutation('POST', path)).toBe(false);
    expect(isSubscriptionMutation('POST', '/integrations/jarvis/terceros/lookup-nit')).toBe(false);
  });
});
