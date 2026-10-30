import { isPayrollEmployeeActive } from './payroll-employee-status'

it.each([undefined, null, '', '   '])('mantiene activo al empleado sin retiro (%s)', retirementDate => {
  expect(isPayrollEmployeeActive(retirementDate, '2026-10-28')).toBe(true)
})
it('mantiene activo al empleado hasta el día de retiro inclusive', () => {
  expect(isPayrollEmployeeActive('2026-10-29', '2026-10-28')).toBe(true)
  expect(isPayrollEmployeeActive('2026-10-28', '2026-10-28')).toBe(true)
  expect(isPayrollEmployeeActive('2026-10-27', '2026-10-28')).toBe(false)
})
