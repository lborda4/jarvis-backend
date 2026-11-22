import { advisorCommission } from './advisor-commission.helper';

it('accepts fixed COP amounts, percentages, zero and an undefined commission', () => {
  expect(advisorCommission('FIXED', 150000)).toEqual({ commissionType: 'FIXED', commissionValue: '150000.00' });
  expect(advisorCommission('PERCENT', 7.25)).toEqual({ commissionType: 'PERCENT', commissionValue: '7.25' });
  expect(advisorCommission('PERCENT', 100).commissionValue).toBe('100.00');
  expect(advisorCommission('FIXED', 0).commissionValue).toBe('0.00');
  expect(advisorCommission('PERCENT', null).commissionValue).toBeNull();
});
it.each([['PERCENT', 100.01], ['PERCENT', -1], ['FIXED', 1.234], ['FIXED', Infinity], ['FIXED', '100'], ['FIXED', 1000000000000], ['OTHER', 10]])('rejects invalid commission %s %s', (type, value) => {
  expect(() => advisorCommission(type, value)).toThrow();
});
