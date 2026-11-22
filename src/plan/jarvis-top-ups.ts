import { BadRequestException } from '@nestjs/common';
import type { Plan } from './entities/plan.entity';
import type { CommissionClass } from '../advisor/advisor-sale.entity';
import { TOP_UP_CLASSES } from '../advisor/commission-catalog';

export interface JarvisTopUp {
  commissionClass?: CommissionClass;
  code: string;
  name: string;
  kind: 'DOCUMENTS' | 'PAYROLL_EMPLOYEES';
  units: number;
  priceCop: number;
}

/** Updated JENIUS cost model, Productos E7:E27. One-time prices, separate from the annual plan. */
const CATALOG: readonly JarvisTopUp[] = [
  ...([[10, 25000], [25, 45000], [50, 80000], [100, 149900], [250, 300000], [500, 480000]] as const)
    .map(([units, priceCop]) => ({ code: `documents_${units}`, name: `Recarga ${units} documentos`, kind: 'DOCUMENTS' as const, units, priceCop })),
  ...([[1, 20000], [2, 38000], [3, 55000], [4, 72000], [5, 88000], [6, 104000], [7, 119000], [8, 134000], [9, 148000], [10, 162000], [11, 175000], [15, 225000], [20, 290000], [30, 405000]] as const)
    .map(([units, priceCop]) => ({ code: `payroll_${units}`, name: `Recarga ${units} ${units === 1 ? 'empleado' : 'empleados'}`, kind: 'PAYROLL_EMPLOYEES' as const, units, priceCop })),
];

export const listJarvisTopUps = (): JarvisTopUp[] => CATALOG.map(item => ({ ...item, ...(TOP_UP_CLASSES[item.code] ? { commissionClass: TOP_UP_CLASSES[item.code] } : {}) }));

export function isTopUpCompatible(plan: Plan, item: JarvisTopUp): boolean {
  const terms = plan.commercialTerms;
  if (!terms) return false;
  return item.kind === 'DOCUMENTS'
    ? terms.modules.includes('BILLING') && plan.documentLimit !== null
    : terms.modules.includes('PAYROLL') && terms.employeeLimit !== null;
}

export function resolveJarvisTopUps(plan: Plan | null, codes: unknown): JarvisTopUp[] {
  if (codes === undefined) return [];
  if (!Array.isArray(codes) || codes.length > CATALOG.length || codes.some(code => typeof code !== 'string')) throw new BadRequestException('Selecciona recargas disponibles en el catálogo.');
  const selectedCodes = new Set<string>();
  return codes.map(code => {
    const item = CATALOG.find(item => item.code === code);
    if (!item || !plan || !isTopUpCompatible(plan, item)) throw new BadRequestException('La recarga seleccionada no corresponde al plan de esta empresa.');
    if (selectedCodes.has(item.code)) throw new BadRequestException('La misma recarga no puede repetirse en una operación.');
    selectedCodes.add(item.code);
    return { ...item, ...(TOP_UP_CLASSES[item.code] ? { commissionClass: TOP_UP_CLASSES[item.code] } : {}) };
  });
}
