import { BadRequestException } from '@nestjs/common';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export function normalizeCompanyTracking(commercial: unknown, billingCycle: unknown) {
  if (commercial != null && (typeof commercial !== 'string' || commercial.trim().length > 120)) throw new BadRequestException('El comercial debe tener hasta 120 caracteres.');
  if (billingCycle !== 'MONTHLY' && billingCycle !== 'ANNUAL') throw new BadRequestException('Selecciona un plan mensual o anual.');
  return { commercial: typeof commercial === 'string' ? commercial.trim() || null : null, billingCycle: billingCycle as BillingCycle };
}
/** Calendar anniversary in Colombia, clamped to the last valid day of the month. */
export function companyDueDate(createdAt: Date, cycle: BillingCycle | null | undefined): string | null {
  if (!cycle || !Number.isFinite(createdAt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(createdAt);
  const get = (key: string) => Number(parts.find(part => part.type === key)?.value);
  const day = get('day');
  const first = new Date(Date.UTC(get('year'), get('month') - 1 + (cycle === 'ANNUAL' ? 12 : 1), 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
