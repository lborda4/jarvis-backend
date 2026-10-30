export function isPayrollEmployeeActive(retirementDate?: string | null, date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date())): boolean {
  const retirement = retirementDate?.trim()
  // La fecha de retiro sigue siendo el último día de vinculación.
  return !retirement || retirement >= date
}
