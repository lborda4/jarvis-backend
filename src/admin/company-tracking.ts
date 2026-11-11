import { BadRequestException } from '@nestjs/common';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export function trackingToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return [part('year'), part('month'), part('day')].join('-');
}
export function companyTrackingDueDate(company: { createdAt: Date; billingMonths?: number | null; billingCycle?: BillingCycle | null; trackingPeriodStart?: string | null }): string | null {
  const start = company.trackingPeriodStart ? new Date(company.trackingPeriodStart + 'T12:00:00Z') : company.createdAt;
  return companyDueDate(start, company.billingMonths ?? company.billingCycle);
}
export function billingMonthsFromCycle(cycle: BillingCycle | null | undefined): number | null {
  return cycle === 'ANNUAL' ? 12 : cycle === 'MONTHLY' ? 1 : null;
}
export function normalizeCompanyTracking(commercial: unknown, billingCycle: unknown, billingMonths?: unknown) {
  if (commercial != null && (typeof commercial !== 'string' || commercial.trim().length > 120)) throw new BadRequestException('El comercial debe tener hasta 120 caracteres.');
  const months = billingMonths !== undefined ? billingMonths : billingMonthsFromCycle(billingCycle as BillingCycle);
  if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 1200) throw new BadRequestException('Indica una cantidad entera de meses entre 1 y 1200.');
  return { commercial: typeof commercial === 'string' ? commercial.trim() || null : null, billingMonths: months, billingCycle: months === 12 ? 'ANNUAL' as const : months === 1 ? 'MONTHLY' as const : null };
}
/** Calendar anniversary in Colombia, clamped to the last valid day of the month. */
export function companyDueDate(createdAt: Date, period: number | BillingCycle | null | undefined): string | null {
  const months = typeof period === 'number' ? period : billingMonthsFromCycle(period);
  if (!months || !Number.isInteger(months) || months < 1 || months > 1200 || !Number.isFinite(createdAt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(createdAt);
  const get = (key: string) => Number(parts.find(part => part.type === key)?.value);
  const day = get('day');
  const first = new Date(Date.UTC(get('year'), get('month') - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
