import { payrollDefaultLawDeductions, payrollRequiredDeductionErrors } from './payroll-required-deductions'
import type { PayrollInput, PayrollLine } from './payroll-domain'

const lines: PayrollLine[] = [
  { id: 'eps', concept: 'eps', kind: 'deduction', quantity: '1', amount: '0', typeLawDeductionsId: 31 },
  { id: 'pension', concept: 'pension', kind: 'deduction', quantity: '1', amount: '100', typeLawDeductionsId: 51 },
]
describe('EPS y pensión obligatorias para el envío', () => {
  it('exige ambos conceptos sin inventar deducciones', () => {
    const state = { lines: [] }
    expect(payrollRequiredDeductionErrors(state)).toHaveLength(2)
    expect(state.lines).toEqual([])
  })
  it('acepta un valor cero explícito con un código seleccionado', () => {
    expect(payrollRequiredDeductionErrors({ lines })).toEqual([])
  })
  it('exige el ID y un valor válido, sin confundir vacío con cero', () => {
    const errors = payrollRequiredDeductionErrors({ lines: lines.map(line => ({ ...line, amount: '', typeLawDeductionsId: undefined })) })
    expect(errors).toHaveLength(4)
  })
  it('admite los códigos históricos explícitos y conceptos con homologación', () => {
    expect(payrollRequiredDeductionErrors({ lines: lines.map(line => ({ ...line, concept: `internal_${line.concept}`, mapping: line.concept, typeLawDeductionsId: undefined })), epsTypeLawDeductionsId: 31, pensionTypeLawDeductionsId: 51 })).toEqual([])
  })
})

it('normalizes health and pension before sending and both optional funds without changing values', () => {
  const state = { lines: [...lines, { ...lines[0], id: 'fund', concept: 'solidarity', typeLawDeductionsId: 11 }, { ...lines[0], id: 'sub', concept: 'internal_sub', mapping: 'subsistence', typeLawDeductionsId: 12 }], epsTypeLawDeductionsId: 31, pensionTypeLawDeductionsId: 51 } as PayrollInput;
  const result = payrollDefaultLawDeductions(state);
  expect(result.lines.map(line => line.typeLawDeductionsId)).toEqual([4, 6, 9, 9]);
  expect(result.lines.map(line => line.amount)).toEqual(state.lines.map(line => line.amount));
  expect(state.lines[0].typeLawDeductionsId).toBe(31);
  expect(result).toMatchObject({ epsTypeLawDeductionsId: 4, pensionTypeLawDeductionsId: 6 });
  expect(payrollDefaultLawDeductions({ ...state, lines: [] }).lines).toEqual([]);
});
