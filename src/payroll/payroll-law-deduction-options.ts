export interface PayrollLawDeductionOption {
  id: number
  name: string
  code?: string | null
}

function lawDeductionGroup(row: PayrollLawDeductionOption) {
  const name = row.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (name.includes('subsistencia')) return 'subsistence'
  if (name.includes('solidaridad')) return 'solidarity'
  if (name.includes('salud') || /\beps\b/.test(name)) return 'eps'
  if (name.includes('pension')) return 'pension'
  // Códigos del catálogo; el ID del proveedor se conserva sin modificaciones.
  const code = String(row.code ?? '').trim().replace(/^0+(?=\d)/, '')
  if (['1', '2', '3', '4'].includes(code)) return 'eps'
  if (['5', '6', '7', '8'].includes(code)) return 'pension'
  if (code === '9') return 'solidarity'
  return undefined
}

export function payrollLawOptionsForConcept<T extends PayrollLawDeductionOption>(rows: T[], concept: string): T[] {
  if (!['eps', 'pension', 'solidarity', 'subsistence'].includes(concept)) return []
  const specific = rows.filter(row => lawDeductionGroup(row) === concept)
  // Algunos catálogos ofrecen un solo tipo de fondo para solidaridad y subsistencia.
  if (concept === 'subsistence' && !specific.length)
    return rows.filter(row => lawDeductionGroup(row) === 'solidarity')
  return specific
}
