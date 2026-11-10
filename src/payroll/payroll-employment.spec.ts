
import { payrollEmploymentDays, payrollWorkedTime } from './payroll-employment'

it.each([
  ['2026-10-01', '2026-10-31', '2026-10-16', '', 15, 30],
  ['2026-10-01', '2026-10-15', '2026-10-10', '', 6, 15],
  ['2026-10-16', '2026-10-31', '2026-10-20', '', 11, 15],
  ['2026-10-01', '2026-10-31', '2026-11-01', '', 0, 30],
  ['2026-10-01', '2026-10-31', '2026-01-01', '2026-09-30', 0, 30],
  ['2026-10-01', '2026-10-31', '2026-01-01', '2026-10-10', 10, 30],
  ['2026-10-01', '2026-10-31', '2026-10-10', '2026-10-20', 11, 30],
  ['2026-02-01', '2026-02-28', '2026-02-19', '', 12, 30],
  ['2028-02-01', '2028-02-29', '2028-01-01', '', 30, 30],
  ['2026-10-16', '2026-10-31', '2026-10-31', '', 1, 15],
])('limita los días de %s a %s según ingreso %s y retiro %s', (startDate, endDate, admittanceDate, retirementDate, days, periodDays) => {
  expect(payrollEmploymentDays({ startDate, endDate }, { admittanceDate, retirementDate })).toEqual({ days, periodDays })
})

it.each([
  ['2024-01-01', '2026-01-31', undefined, 750],
  ['2026-01-01', '2026-01-15', undefined, 15],
  ['2026-01-01', '2026-02-15', undefined, 45],
  ['2026-01-16', '2026-01-31', undefined, 15],
  ['2026-01-31', '2026-01-31', undefined, 1],
  ['2026-01-01', '2026-02-28', undefined, 60],
  ['2028-01-01', '2028-02-29', undefined, 60],
  ['2026-01-01', '2026-10-31', '2026-10-10', 280],
  ['2026-01-01', '2026-10-31', '2026-11-15', 300],
])('calcula antigüedad desde %s al cierre %s y retiro %s', (admittanceDate, endDate, retirementDate, days) => {
  expect(payrollWorkedTime(endDate, { admittanceDate, retirementDate })).toBe(days)
})

it.each([
  ['2026-02-30', '2026-10-31', undefined],
  ['2026-01-01', '2026-02-30', undefined],
  ['2026-01-01', '2026-10-31', '2026-09-31'],
  ['2026-11-01', '2026-10-31', undefined],
  ['2026-01-01', '2026-10-31', '2025-12-31'],
  ['', '2026-10-31', undefined],
])('rechaza fechas inválidas o anteriores al ingreso: %s, %s, %s', (admittanceDate, endDate, retirementDate) => {
  expect(() => payrollWorkedTime(endDate, { admittanceDate, retirementDate })).toThrow()
})
