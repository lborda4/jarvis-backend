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

/** Antigüedad acumulada al cierre de la liquidación, con base 30/360 e ingreso incluido. */
export function payrollWorkedTime(
  endDate: string,
  employee: { admittanceDate: string; retirementDate?: string },
): number {
  for (const value of [endDate, employee.admittanceDate, employee.retirementDate].filter(
    (date): date is string => date !== undefined && date !== '',
  )) {
    const date = new Date(value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value)
      throw new Error('Revisa las fechas de ingreso, retiro y liquidación del empleado.')
  }
  if (!employee.admittanceDate || !endDate)
    throw new Error('Completa la fecha de ingreso y el cierre de la liquidación.')
  const { days } = payrollEmploymentDays(
    { startDate: employee.admittanceDate, endDate }, employee,
  )
  if (days < 1)
    throw new Error('El cierre de la vinculación debe ser igual o posterior al ingreso.')
  return days
}
