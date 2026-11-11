import { companyDueDate, normalizeCompanyTracking } from './company-tracking';
import { AdminService } from './admin.service';

describe('Company tracking', () => {
  it.each([
    ['2026-01-31T15:00:00Z', 3, '2026-04-30'],
    ['2026-10-02T02:00:00Z', 6, '2027-04-01'],
    ['2024-02-29T15:00:00Z', 12, '2025-02-28'],
    ['2026-12-31T15:00:00Z', 15, '2028-03-31'],
  ] as const)('adds calendar months for %s + %s months', (date, months, expected) => {
    expect(companyDueDate(new Date(date), months)).toBe(expected);
  });
  it.each([0, -1, 1.5, '3', null, NaN, Infinity, 1201])('rejects invalid month count %s', months => {
    expect(() => normalizeCompanyTracking('Laura', undefined, months)).toThrow('meses');
  });
  it('gives explicit months precedence over the legacy cycle', () => {
    expect(normalizeCompanyTracking(' Laura ', 'ANNUAL', 3)).toEqual({ commercial: 'Laura', billingMonths: 3, billingCycle: null });
  });
  it('saves a custom number of months and returns its due date', async () => {
    const company = { id: 'company', name: 'Cliente', createdAt: new Date('2026-01-31T15:00:00Z'), integrations: [], billingCycle: 'ANNUAL' };
    const companies = { findById: jest.fn().mockResolvedValue(company), save: jest.fn(), findAllWithIntegrations: jest.fn().mockResolvedValue([company]) };
    const service = new AdminService({ transaction: async work => work({ getRepository: () => ({ findOne: companies.findById, save: companies.save }) }) } as never, companies as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const result = await service.updateCompanyTracking('company', { commercial: 'Laura', billingMonths: 3 });
    expect(companies.save).toHaveBeenCalledWith(expect.objectContaining({ billingMonths: 3, billingCycle: null }));
    expect(result.company.billingMonths).toBe(3);
    expect(result.company.subscriptionDueDate).toBe('2026-04-30');
  });

  it.each([
    ['2026-01-31T15:00:00Z', 'MONTHLY', '2026-02-28'],
    ['2024-01-31T15:00:00Z', 'MONTHLY', '2024-02-29'],
    ['2024-02-29T15:00:00Z', 'ANNUAL', '2025-02-28'],
    ['2026-12-31T15:00:00Z', 'MONTHLY', '2027-01-31'],
    ['2026-10-02T02:00:00Z', 'MONTHLY', '2026-11-01'],
  ] as const)('calculates anniversary for %s %s', (date, cycle, expected) => {
    expect(companyDueDate(new Date(date), cycle)).toBe(expected);
  });
  it('does not infer a cycle for existing companies', () => {
    expect(companyDueDate(new Date(), null)).toBeNull();
  });
  it('validates cycle and sales representative before saving', () => {
    expect(normalizeCompanyTracking(' Laura ', 'ANNUAL')).toEqual({ commercial: 'Laura', billingCycle: 'ANNUAL', billingMonths: 12 });
    expect(() => normalizeCompanyTracking('Laura', 'WEEKLY')).toThrow();
    expect(() => normalizeCompanyTracking('x'.repeat(121), 'MONTHLY')).toThrow();
  });
  it('persists configuration without restarting the creation date or changing plan access', async () => {
    const company = { id: 'company', name: 'Cliente', createdAt: new Date('2026-01-31T15:00:00Z'), integrations: [] };
    const companies = { findById: jest.fn().mockResolvedValue(company), save: jest.fn().mockResolvedValue(company), findAllWithIntegrations: jest.fn().mockResolvedValue([company]) };
    const service = new AdminService({ transaction: async work => work({ getRepository: () => ({ findOne: companies.findById, save: companies.save }) }) } as never, companies as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const result = await service.updateCompanyTracking('company', { commercial: 'Laura', billingCycle: 'MONTHLY' });
    expect(companies.save).toHaveBeenCalledWith(expect.objectContaining({ commercial: 'Laura', billingCycle: 'MONTHLY', createdAt: new Date('2026-01-31T15:00:00Z') }));
    expect(result.company.subscriptionDueDate).toBe('2026-02-28');
    expect(result.company.integrations).toEqual([]);
  });
  it('rejects unknown companies', async () => {
    const companies = { findById: jest.fn().mockResolvedValue(null), save: jest.fn() };
    const service = new AdminService({ transaction: async work => work({ getRepository: () => ({ findOne: companies.findById, save: companies.save }) }) } as never, companies as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.updateCompanyTracking('missing', { billingCycle: 'MONTHLY' })).rejects.toThrow('Empresa no encontrada');
    expect(companies.save).not.toHaveBeenCalled();
  });
});
