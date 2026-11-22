import type { QueryRunner } from 'typeorm';
import { SeedJarvisCommercialPortfolio1795200000000 } from '../migrations/1795200000000-SeedJarvisCommercialPortfolio';

it('registra los cinco planes y valores del Resumen sin importar recargas ni alterar suscripciones existentes', async () => {
  const query = jest.fn().mockResolvedValue([]);
  await new SeedJarvisCommercialPortfolio1795200000000().up({ query } as unknown as QueryRunner);
  const inserts = query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO'));
  expect(inserts).toHaveLength(5);
  expect(inserts.map(([, parameters]) => JSON.parse(parameters[4]).priceCop)).toEqual([139900, 139900, 129900, 230000, 720000]);
  expect(inserts.map(([, parameters]) => parameters[2])).toEqual([50, 25, null, 50, null]);
  expect(inserts.every(([, parameters]) => JSON.parse(parameters[4]).billingMonths === 12)).toBe(true);
  expect(query.mock.calls.some(([sql]) => /UPDATE|DELETE/i.test(String(sql)))).toBe(false);
  expect(inserts.some(([, parameters]) => String(parameters[0]).includes('Recarga'))).toBe(false);
});

it('al revertir conserva planes que estén vinculados a empresas', async () => {
  const query = jest.fn().mockResolvedValue([]);
  await new SeedJarvisCommercialPortfolio1795200000000().down({ query } as unknown as QueryRunner);
  expect(query.mock.calls[0][0]).toContain('NOT EXISTS');
  expect(query.mock.calls[0][0]).toContain('"plan_id" = "plans"."id"');
});
