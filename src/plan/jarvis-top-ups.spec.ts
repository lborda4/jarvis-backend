import { listJarvisTopUps, resolveJarvisTopUps } from './jarvis-top-ups';
import type { Plan } from './entities/plan.entity';

const combo = { provider: 'JARVIS', documentLimit: 50, commercialTerms: { modules: ['BILLING', 'PAYROLL'], employeeLimit: 2 } } as Plan;

it('incluye las seis recargas de documentos y las catorce de empleados con los precios del Excel', () => {
  const items = listJarvisTopUps();
  expect(items.filter(item => item.kind === 'DOCUMENTS').map(item => [item.units, item.priceCop])).toEqual([[10,25000],[25,45000],[50,80000],[100,149900],[250,300000],[500,480000]]);
  expect(items.filter(item => item.kind === 'PAYROLL_EMPLOYEES').map(item => [item.units, item.priceCop])).toEqual([[1,20000],[2,38000],[3,55000],[4,72000],[5,88000],[6,104000],[7,119000],[8,134000],[9,148000],[10,162000],[11,175000],[15,225000],[20,290000],[30,405000]]);
  items[0].priceCop = 1;
  expect(listJarvisTopUps()[0].priceCop).toBe(25000);
});

it('resuelve los precios en el servidor y mantiene recargas separadas del plan anual', () => {
  expect(resolveJarvisTopUps(combo, ['documents_100', 'payroll_5'])).toEqual([
    expect.objectContaining({ units: 100, priceCop: 149900, kind: 'DOCUMENTS' }),
    expect.objectContaining({ units: 5, priceCop: 88000, kind: 'PAYROLL_EMPLOYEES' }),
  ]);
  expect(resolveJarvisTopUps(combo, [])).toEqual([]);
});

it.each([null, 'documents_10', ['unknown'], ['documents_10','documents_10'], [1]].map(codes => ({ codes })))('rechaza selección inválida $codes sin modificar el catálogo', ({ codes }) => {
  expect(() => resolveJarvisTopUps(combo, codes)).toThrow();
});

it('rechaza recargas incompatibles con el módulo o con cupos ilimitados', () => {
  const billing = { ...combo, commercialTerms: { ...combo.commercialTerms!, modules: ['BILLING'] } } as Plan;
  expect(() => resolveJarvisTopUps(billing, ['payroll_1'])).toThrow('no corresponde');
  const payroll = { ...combo, documentLimit: null, commercialTerms: { ...combo.commercialTerms!, modules: ['PAYROLL'] } } as Plan;
  expect(() => resolveJarvisTopUps(payroll, ['documents_10'])).toThrow('no corresponde');
  const unlimited = { ...combo, documentLimit: null, commercialTerms: { ...combo.commercialTerms!, employeeLimit: null } };
  expect(() => resolveJarvisTopUps(unlimited, ['documents_10'])).toThrow('no corresponde');
  expect(() => resolveJarvisTopUps(unlimited, ['payroll_1'])).toThrow('no corresponde');
});


it('suma varias recargas del mismo tipo y conserva precio y comision de cada producto', () => {
  const items = resolveJarvisTopUps(combo, ['documents_100', 'documents_50', 'documents_25', 'payroll_1', 'payroll_2']);
  expect(items.filter(item => item.kind === 'DOCUMENTS').reduce((sum, item) => sum + item.units, 0)).toBe(175);
  expect(items.filter(item => item.kind === 'PAYROLL_EMPLOYEES').reduce((sum, item) => sum + item.units, 0)).toBe(3);
  expect(items.find(item => item.code === 'documents_100')).toMatchObject({ priceCop: 149900, commissionClass: 'PLUS' });
  expect(() => resolveJarvisTopUps(combo, Array(21).fill('documents_10'))).toThrow();
});
