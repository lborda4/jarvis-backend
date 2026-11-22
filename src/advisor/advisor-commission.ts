import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { EntityManager } from 'typeorm';
import type { Plan } from '../plan/entities/plan.entity';
import type { Company } from '../company/entities/company.entity';
import type { JarvisTopUp } from '../plan/jarvis-top-ups';
import { AdvisorSale, type CommissionClass } from './advisor-sale.entity';
import { TOP_UP_COMMISSION_BASIS, TOP_UP_CLASSES } from './commission-catalog';

export const COMMISSION_RATES: Record<CommissionClass, number> = { BASIC: 10, PLUS: 15, PRO: 20 };
export const RENEWAL_COMMISSION_RATES: Record<CommissionClass, number> = { BASIC: 5, PLUS: 7.5, PRO: 10 };
export function planSaleTerms(plan: Plan) {
  const priceCop = plan.commercialTerms?.priceCop ?? (plan.salePriceCop == null ? null : Number(plan.salePriceCop));
  const commissionClass = plan.commissionClass;
  if (!commissionClass || !COMMISSION_RATES[commissionClass] || priceCop === null || !Number.isFinite(priceCop) || priceCop < 0 || priceCop > 999999999999.99)
    throw new BadRequestException(`Configura el precio y la clase de comisión del plan «${plan.name}» en administración.`);
  return { priceCop, commissionClass, commissionRate: COMMISSION_RATES[commissionClass] };
}
export function commissionCop(price: number, rate: number): string {
  // Integer cents, rounded to the nearest cent once per sale.
  const cents = BigInt(Math.round(price * 100));
  const result = (cents * BigInt(Math.round(rate * 100)) + 5000n) / 10000n;
  return `${result / 100n}.${String(result % 100n).padStart(2, '0')}`;
}
export function advisorSaleItems(plan: Plan, topUpSelection: JarvisTopUp[] = [], includePlan = true, renewal = false) {
  const terms = includePlan || TOP_UP_COMMISSION_BASIS === 'PLAN' ? planSaleTerms(plan) : null;
  const topUps = topUpSelection.map(item => {
    const commissionClass = TOP_UP_CLASSES[item.code] ?? item.commissionClass ?? (TOP_UP_COMMISSION_BASIS === 'PLAN' ? terms?.commissionClass : null);
    if (!commissionClass) throw new BadRequestException('Falta confirmar la clase de comisión de las recargas del portafolio.');
    return { ...item, commissionClass, commissionRate: COMMISSION_RATES[commissionClass], commissionStage: 'INITIAL' as const };
  });
  return [
    ...(includePlan && terms ? [{ code: plan.code, name: plan.name, ...terms, commissionRate: (renewal ? RENEWAL_COMMISSION_RATES : COMMISSION_RATES)[terms.commissionClass], commissionStage: renewal ? 'RENEWAL' as const : 'INITIAL' as const, kind: 'PLAN' as const }] : []),
    ...topUps.map(item => ({ ...item, kind: 'TOP_UP' as const })),
  ];
}
export async function recordAdvisorSale(manager: EntityManager, company: Company, plan: Plan, source: string,
  options: { topUps?: JarvisTopUp[]; plan?: boolean; paidBy?: string; activation?: AdvisorSale['activation']; renewal?: boolean } = {}) {
  if (!company.advisorId || (options.plan === false && !options.topUps?.length)) return;
  const items = advisorSaleItems(plan, options.topUps, options.plan !== false, options.renewal);
  for (const item of items) {
    const sourceKey = createHash('sha256').update(JSON.stringify([company.id, source, item.kind, item.code])).digest('hex');
    const repository = manager.getRepository(AdvisorSale);
    // A stable source prevents charging twice when a top-up request is retried.
    await repository.createQueryBuilder().insert().values({ sourceKey, operationKey: source, activation: options.activation ?? 'APPLIED', advisorId: company.advisorId, companyId: company.id,
      companyName: company.name, companyNit: company.nit, provider: plan.provider, kind: item.kind,
      productCode: item.code, productName: item.name, priceCop: item.priceCop.toFixed(2),
      commissionClass: item.commissionClass, commissionRate: item.commissionRate.toFixed(2), commissionStage: item.commissionStage, commissionCop: commissionCop(item.priceCop, item.commissionRate),
      paidAt: options.paidBy ? new Date() : null, paidBy: options.paidBy ?? null,
    }).orIgnore().execute();
  }
}
export function commissionMonth(value: unknown, now = new Date()) {
  const month = value === undefined ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(now) : value;
  if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Selecciona un mes válido.');
  const [year, number] = month.split('-').map(Number);
  return { month, start: `${month}-01T00:00:00-05:00`, end: `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}-01T00:00:00-05:00` };
}
