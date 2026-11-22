import { AdvisorSalesService } from './advisor-sales.service';
import { AdvisorSale } from './advisor-sale.entity';
import { Company } from '../company/entities/company.entity';

function setup() {
  const sale = { id: 'sale', companyId: 'company', companyName: 'Cliente', advisorId: 'advisor', priceCop: '139900.00', commissionCop: '13990.00', commissionRate: 10,
    activation: 'APPLIED', paidAt: null, paidBy: null, productName: 'Plan inicial', provider: 'JARVIS', createdAt: new Date('2026-10-15T15:00:00Z'), advisor: { user: { name: 'Laura' } } } as unknown as AdvisorSale;
  const company = { id: 'company', commercialActivity: [] } as unknown as Company;
  const query = { innerJoinAndSelect: jest.fn(() => query), where: jest.fn(() => query), andWhere: jest.fn(() => query), orderBy: jest.fn(() => query), getMany: jest.fn(async () => [sale]) };
  const sales = { findOneBy: jest.fn(async ({ id }) => id === sale.id ? sale : null), findOne: jest.fn(async () => sale), save: jest.fn(), createQueryBuilder: () => query };
  const companies = { findOne: jest.fn(async () => company), save: jest.fn() };
  const manager = { getRepository: entity => entity === AdvisorSale ? sales : entity === Company ? companies : null };
  const db = { ...manager, transaction: jest.fn(async work => work(manager)) };
  return { service: new AdvisorSalesService(db as never), sale, company, sales, companies, query };
}
it('registers payment exactly once in the payment month, without renewing documents or recalculating the commission', async () => {
  const f = setup();
  await f.service.registerPayment('sale', 'admin'); const paidAt = f.sale.paidAt;
  await expect(f.service.registerPayment('sale', 'another-admin')).resolves.toMatchObject({ message: expect.stringContaining('mes original') });
  expect(f.sale).toMatchObject({ paidAt: expect.any(Date), paidBy: 'admin', commissionCop: '13990.00' });
  expect(f.sale.paidAt).toBe(paidAt); expect(f.sales.save).toHaveBeenCalledTimes(1); expect(f.company.commercialActivity).toHaveLength(1);
  expect(f.sales.findOne).toHaveBeenCalledWith({ where: { id: 'sale' }, lock: { mode: 'pessimistic_write' } });
  expect(f.company.commercialActivity[0]).toMatchObject({ kind: 'PAYMENT', amountCop: 139900, planName: 'Plan inicial' });
});
it.each(['FAILED', 'PROCESSING', 'UNCERTAIN'])('does not recognize a payment for a top-up in state %s', async activation => {
  const f = setup(); f.sale.activation = activation as AdvisorSale['activation'];
  await expect(f.service.registerPayment('sale', 'admin')).rejects.toThrow('activación');
  expect(f.sales.save).not.toHaveBeenCalled(); expect(f.company.commercialActivity).toHaveLength(0);
});
it('excludes pending sales from monthly totals and scopes the report to the authenticated advisor', async () => {
  const f = setup(); let result = await f.service.report('2026-11', 'advisor');
  expect(result.pending).toHaveLength(1); expect(result.totalCommissionCop).toBe(0); expect(result.totalSalesCop).toBe(0);
  expect(f.query.where).toHaveBeenCalledWith(expect.stringContaining('sale.paid_at >= :start'), expect.objectContaining({ start: '2026-11-01T00:00:00-05:00', end: '2026-12-01T00:00:00-05:00' }));
  expect(f.query.andWhere).toHaveBeenCalledWith('sale.advisor_id = :advisorId', { advisorId: 'advisor' });
  f.sale.paidAt = new Date('2026-11-21T15:00:00Z'); result = await f.service.report('2026-11', 'advisor');
  expect(result.totalCommissionCop).toBe(13990); expect(result.totalSalesCop).toBe(139900); expect(result.summary[0].paidSales).toBe(1);
});
