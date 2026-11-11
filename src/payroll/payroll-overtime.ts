export interface DayOvertimeLine {
  concept: string
  mapping?: string
  startTime?: string
  endTime?: string
  overtimeSurchargeId?: number
  quantity: string
  amount: string
}

export function overtimeDefinition(code: string) {
  if (code === 'overtime_day') return { masterName: 'hora extra diurna', label: 'horas extra diurnas', bodyKey: 'HEDs' }
  if (code === 'overtime_night') return { masterName: 'hora extra nocturna', label: 'horas extra nocturnas', bodyKey: 'HENs' }
  return undefined
}

export const isPayrollOvertime = (line: Pick<DayOvertimeLine, 'concept' | 'mapping'>) =>
  Boolean(overtimeDefinition(line.mapping ?? line.concept))
export const isDayOvertime = (line: Pick<DayOvertimeLine, 'concept' | 'mapping'>) =>
  (line.mapping ?? line.concept) === 'overtime_day'
export const isNightOvertime = (line: Pick<DayOvertimeLine, 'concept' | 'mapping'>) =>
  (line.mapping ?? line.concept) === 'overtime_night'

export function validPayrollTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false
  const date = new Date(`${value}Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value
}

export function dayOvertimeErrors(line: DayOvertimeLine, period: string): string[] {
  const definition = overtimeDefinition(line.mapping ?? line.concept)
  if (!definition) return []
  const errors: string[] = []
  if (!validPayrollTime(line.startTime ?? '') || !validPayrollTime(line.endTime ?? '') || line.startTime! >= line.endTime!)
    errors.push(`Revisa la fecha y hora de inicio y fin de las ${definition.label}.`)
  else if (line.startTime!.slice(0, 7) !== period || line.endTime!.slice(0, 7) !== period)
    errors.push('Las horas extra deben estar dentro del mes de la nómina.')
  if (!Number.isSafeInteger(line.overtimeSurchargeId) || line.overtimeSurchargeId! <= 0)
    errors.push(`Carga el recargo de ${definition.label} antes de guardar.`)
  if (![line.quantity, line.amount].every(value => /^\d{1,12}(\.\d{1,2})?$/.test(value) && Number(value) > 0))
    errors.push('La cantidad de horas y el valor a pagar deben ser mayores que cero.')
  return errors
}

export function dayOvertimeMaster(rows: { id: number; name: string; code?: string | null }[], code = 'overtime_day') {
  const definition = overtimeDefinition(code)
  if (!definition) return undefined
  return rows.find(row => Number.isSafeInteger(row.id) && row.id > 0 &&
    row.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === definition.masterName)
}
