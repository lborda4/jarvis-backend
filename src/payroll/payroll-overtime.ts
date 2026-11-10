export interface DayOvertimeLine {
  concept: string
  mapping?: string
  startTime?: string
  endTime?: string
  overtimeSurchargeId?: number
  quantity: string
  amount: string
}

export const isDayOvertime = (line: Pick<DayOvertimeLine, 'concept' | 'mapping'>) =>
  (line.mapping ?? line.concept) === 'overtime_day'

export function validPayrollTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false
  const date = new Date(`${value}Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value
}

export function dayOvertimeErrors(line: DayOvertimeLine, period: string): string[] {
  if (!isDayOvertime(line)) return []
  const errors: string[] = []
  if (!validPayrollTime(line.startTime ?? '') || !validPayrollTime(line.endTime ?? '') || line.startTime! >= line.endTime!)
    errors.push('Revisa la fecha y hora de inicio y fin de las horas extra diurnas.')
  else if (line.startTime!.slice(0, 7) !== period || line.endTime!.slice(0, 7) !== period)
    errors.push('Las horas extra diurnas deben estar dentro del mes de la nómina.')
  if (!Number.isSafeInteger(line.overtimeSurchargeId) || line.overtimeSurchargeId! <= 0)
    errors.push('Carga el recargo de horas extra diurnas antes de guardar.')
  if (![line.quantity, line.amount].every(value => /^\d{1,12}(\.\d{1,2})?$/.test(value) && Number(value) > 0))
    errors.push('La cantidad de horas y el valor a pagar deben ser mayores que cero.')
  return errors
}

export function dayOvertimeMaster(rows: { id: number; name: string; code?: string | null }[]) {
  return rows.find(row => Number.isSafeInteger(row.id) && row.id > 0 &&
    row.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'hora extra diurna')
}
