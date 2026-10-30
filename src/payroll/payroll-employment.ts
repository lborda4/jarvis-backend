/** Días de vinculación dentro de un período, con base laboral de 30 días. */
export function payrollEmploymentDays(
  period: { startDate: string; endDate: string },
  employee: { admittanceDate?: string; retirementDate?: string },
) {
  const start = employee.admittanceDate && employee.admittanceDate > period.startDate
    ? employee.admittanceDate : period.startDate
  const end = employee.retirementDate && employee.retirementDate < period.endDate
    ? employee.retirementDate : period.endDate
  const dayIndex = (date: string, endOfRange: boolean) => {
    const [year, month, day] = date.split('-').map(Number)
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const payrollDay = endOfRange && day === lastDay ? 30 : Math.min(day, 30)
    return (year * 12 + month - 1) * 30 + payrollDay
  }
  return {
    periodDays: dayIndex(period.endDate, true) - dayIndex(period.startDate, false) + 1,
    days: start > end ? 0 : dayIndex(end, true) - dayIndex(start, false) + 1,
  }
}
