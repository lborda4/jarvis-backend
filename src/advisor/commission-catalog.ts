import type { CommissionClass } from './advisor-sale.entity';

// Modelo_costos_punto_equilibrio_JENIUS_actualizado.xlsx, Productos A6:E30.
export const TOP_UP_COMMISSION_BASIS: 'PLAN' | 'PRODUCT' | 'PENDING' = 'PRODUCT';
export const TOP_UP_CLASSES: Partial<Record<string, CommissionClass>> = {
  ...Object.fromEntries([10, 25, 50, 100].map(units => [`documents_${units}`, 'PLUS' as const])),
  ...Object.fromEntries([250, 500].map(units => [`documents_${units}`, 'PRO' as const])),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(units => [`payroll_${units}`, 'PLUS' as const])),
  ...Object.fromEntries([11, 15, 20, 30].map(units => [`payroll_${units}`, 'PRO' as const])),
};
