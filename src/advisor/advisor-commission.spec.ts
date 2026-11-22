import { advisorSaleItems, commissionCop, commissionMonth, planSaleTerms, recordAdvisorSale, RENEWAL_COMMISSION_RATES } from './advisor-commission';
import { listJarvisTopUps } from '../plan/jarvis-top-ups';
import { Plan } from '../plan/entities/plan.entity';
import { Company } from '../company/entities/company.entity';
import { AdvisorSale } from './advisor-sale.entity';

it.each([['BASIC', 10], ['PLUS', 15], ['PRO', 20]] as const)('calculates the %s rate from the product, using the catalog price', (commissionClass, rate) => {
  const plan = { name: 'Plan', commissionClass, salePriceCop: '100000.00', commercialTerms: { priceCop: 139900 } } as Plan;
  expect(planSaleTerms(plan)).toEqual({ priceCop: 139900, commissionClass, commissionRate: rate });
  expect(commissionCop(139900, rate)).toBe((139900 * rate / 100).toFixed(2));
});
it('rounds commissions to cents and rejects unconfigured plans instead of guessing their class or price', () => {
  expect(commissionCop(10.05, 10)).toBe('1.01'); expect(commissionCop(0, 20)).toBe('0.00');
  expect(() => planSaleTerms({ name: 'Unknown', salePriceCop: '1000.00' } as Plan)).toThrow('clase');
  expect(() => planSaleTerms({ name: 'Unknown', commissionClass: 'PLUS' } as Plan)).toThrow('precio');
});
it('groups by Colombia calendar months, including December rollover and midnight boundaries', () => {
  expect(commissionMonth(undefined, new Date('2026-12-01T04:59:59Z')).month).toBe('2026-11');
  expect(commissionMonth(undefined, new Date('2026-12-01T05:00:00Z')).month).toBe('2026-12');
  expect(commissionMonth('2026-12')).toMatchObject({ start: '2026-12-01T00:00:00-05:00', end: '2027-01-01T00:00:00-05:00' });
  expect(() => commissionMonth('2026-13')).toThrow();
});
it('uses the class of each recharge, independently from the plan class', async () => {
  const plan = { name: 'Plan', code: 'plan', commissionClass: 'PLUS', salePriceCop: '100000.00' } as Plan;
  const topUp = { code: 'documents_10', name: '10 documentos', kind: 'DOCUMENTS' as const, units: 10, priceCop: 25000 };
  const catalog = listJarvisTopUps();
  expect(catalog.filter(item => item.kind === 'DOCUMENTS').map(item => [item.units, item.commissionClass, item.priceCop])).toEqual([
    [10, 'PLUS', 25000], [25, 'PLUS', 45000], [50, 'PLUS', 80000], [100, 'PLUS', 149900], [250, 'PRO', 300000], [500, 'PRO', 480000],
  ]);
  const proRecharge = catalog.find(item => item.code === 'payroll_11')!;
  const basicPlan = { ...plan, commissionClass: 'BASIC' as const };
  expect(advisorSaleItems(basicPlan, [proRecharge])[1]).toMatchObject({ commissionClass: 'PRO', commissionRate: 20 });
  expect(advisorSaleItems({ ...plan, commissionClass: null, salePriceCop: null }, [proRecharge], false)[0]).toMatchObject({ commissionClass: 'PRO', commissionRate: 20 });
  expect(advisorSaleItems(plan, [topUp])[1]).toMatchObject({ commissionClass: 'PLUS', commissionRate: 15 });
  expect(() => advisorSaleItems(plan, [{ ...topUp, code: 'unknown' }])).toThrow('confirmar');
  const manager = { getRepository: jest.fn() };
  await expect(recordAdvisorSale(manager as never, { id: 'company', advisorId: 'advisor' } as Company, plan, 'source', { topUps: [{ ...topUp, code: 'unknown' }] })).rejects.toThrow('confirmar');
  expect(manager.getRepository).not.toHaveBeenCalled();
  // Unassigned companies keep the existing top-up flow.
  await expect(recordAdvisorSale(manager as never, { id: 'company', advisorId: null } as Company, plan, 'source', { topUps: [topUp] })).resolves.toBeUndefined();
});
it('snapshots plan and top-up sales once, keeping prices, ownership and rates unchanged on retries', async () => {
  const saved: Record<string, unknown>[] = [];
  let next: Record<string, unknown>;
  const builder = { insert: () => builder, values: (value: Record<string, unknown>) => { next = value; return builder; }, orIgnore: () => builder,
    execute: async () => { if (!saved.some(item => item.sourceKey === next.sourceKey)) saved.push(structuredClone(next)); } };
  const manager = { getRepository: jest.fn(entity => { expect(entity).toBe(AdvisorSale); return { createQueryBuilder: () => builder }; }) };
  const company = { id: 'company', name: 'Cliente', nit: '900', advisorId: 'advisor' } as Company;
  const plan = { code: 'catalog-plan', name: 'Plan', provider: 'JARVIS', commissionClass: 'PLUS', commercialTerms: { priceCop: 230000 } } as Plan;
  const topUps = [{ code: 'documents_10', name: '10 documentos', kind: 'DOCUMENTS' as const, units: 10, priceCop: 25000, commissionClass: 'PLUS' as const }];
  await recordAdvisorSale(manager as never, company, plan, 'initial', { topUps });
  expect(saved).toHaveLength(2);
  expect(saved[0]).toMatchObject({ advisorId: 'advisor', priceCop: '230000.00', commissionRate: '15.00', commissionCop: '34500.00', paidAt: null });
  expect(saved[1]).toMatchObject({ kind: 'TOP_UP', priceCop: '25000.00', commissionCop: '3750.00' });
  company.advisorId = 'other'; plan.commissionClass = 'PRO'; plan.commercialTerms!.priceCop = 500000;
  await recordAdvisorSale(manager as never, company, plan, 'initial', { topUps });
  expect(saved).toHaveLength(2); expect(saved[0]).toMatchObject({ advisorId: 'advisor', priceCop: '230000.00', commissionRate: '15.00' });
});
it.each([['BASIC', 5], ['PLUS', 7.5], ['PRO', 10]] as const)('applies the workbook renewal commission for %s, including fractional percentages', (commissionClass, rate) => {
  const plan = { name: 'Plan', code: 'plan', commissionClass, salePriceCop: '400000.00' } as Plan;
  expect(RENEWAL_COMMISSION_RATES[commissionClass]).toBe(rate);
  expect(advisorSaleItems(plan, [], true, true)[0]).toMatchObject({ commissionStage: 'RENEWAL', commissionRate: rate });
  expect(commissionCop(400000, rate)).toBe((400000 * rate / 100).toFixed(2));
  expect(advisorSaleItems(plan, listJarvisTopUps().slice(0, 1), true, true)[1]).toMatchObject({ commissionStage: 'INITIAL', commissionRate: 15 });
});
