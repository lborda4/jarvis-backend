import { jeniusWorkbook } from './jenius-workbook.fixture';
import { listJarvisTopUps } from '../plan/jarvis-top-ups';
import { COMMISSION_RATES, RENEWAL_COMMISSION_RATES, commissionCop } from './advisor-commission';
import type { CommissionClass } from './advisor-sale.entity';
import { SeedJeniusCommissionCatalog1796000000000 } from '../migrations/1796000000000-SeedJeniusCommissionCatalog';

const canonical = (value: string): CommissionClass => value === 'BASICA' ? 'BASIC' : value as CommissionClass;
it('matches every recharge class and price in the supplied workbook', () => {
  const expected = jeniusWorkbook.products.filter(item => item.name.startsWith('Recarga')).map(item => ({
    code: `${item.name.includes('empleado') ? 'payroll' : 'documents'}_${item.name.match(/\d+/)![0]}`,
    priceCop: item.priceCop, commissionClass: canonical(item.class),
  }));
  expect(listJarvisTopUps().map(({ code, priceCop, commissionClass }) => ({ code, priceCop, commissionClass }))).toEqual(expected);
});
it('matches first-sale and renewal rates, including the workbook commercial income example', () => {
  for (const tier of ['BASIC', 'PLUS', 'PRO'] as const) {
    expect(COMMISSION_RATES[tier]).toBe(jeniusWorkbook.rates[tier].initial * 100);
    expect(RENEWAL_COMMISSION_RATES[tier]).toBe(jeniusWorkbook.rates[tier].renewal * 100);
  }
  const total = jeniusWorkbook.example.rows.reduce((sum, item) => sum + Number(commissionCop(item.priceCop, COMMISSION_RATES[canonical(item.class)])) * item.quantity, 0);
  expect(total).toBe(jeniusWorkbook.example.expectedCommissionCop);
  expect(total).toBe(1951550);
});
it('seeds the existing Jarvis products without changing subscription terms or sale history', async () => {
  const runner = { query: jest.fn().mockResolvedValue([]) };
  await new SeedJeniusCommissionCatalog1796000000000().up(runner as never);
  const updates = runner.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE plans'));
  expect(updates.map(([, values]) => values)).toEqual([
    ['jarvis_billing_initial_annual', 'BASIC', 139900], ['jarvis_billing_regular_annual', 'BASIC', 139900],
    ['jarvis_payroll_basic_annual', 'BASIC', 129900], ['jarvis_compliance_initial_annual', 'PRO', 230000], ['jarvis_compliance_unlimited_annual', 'PRO', 720000],
  ]);
  expect(runner.query.mock.calls.some(([sql]) => /UPDATE advisor_sales/i.test(sql))).toBe(false);
  expect(updates.some(([sql]) => /billingMonths|document_limit|subscription/i.test(sql))).toBe(false);
});
