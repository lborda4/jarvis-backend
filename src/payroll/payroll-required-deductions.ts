import { cents, type PayrollInput, type PayrollLine } from './payroll-domain'

export function payrollRequiredDeductionErrors(state: {
  lines: PayrollLine[]; epsTypeLawDeductionsId?: number; pensionTypeLawDeductionsId?: number;
}) {
  return (['eps', 'pension'] as const).flatMap(code => {
    const label = code === 'eps' ? 'EPS' : 'pensión'
    const lines = state.lines.filter(line => line.kind === 'deduction' && (line.mapping ?? line.concept) === code)
    if (!lines.length) return [`Completa el tipo de deducción de ley y el valor de ${label} en las novedades.`]
    const errors: string[] = []
    for (const line of lines) {
      const id = line.typeLawDeductionsId ?? (code === 'eps' ? state.epsTypeLawDeductionsId : state.pensionTypeLawDeductionsId)
      if (!Number.isSafeInteger(id) || id! < 1) errors.push(`Selecciona el tipo de deducción de ley de ${label}.`)
      try { cents(line.amount) } catch { errors.push(`Ingresa el valor de ${label}; puede ser cero si corresponde.`) }
    }
    return [...new Set(errors)]
  })
}

export function payrollDefaultLawDeductions(state: PayrollInput): PayrollInput {
  return {
    ...state,
    epsTypeLawDeductionsId: 4,
    pensionTypeLawDeductionsId: 6,
    lines: state.lines.map(line => {
      const code = line.mapping ?? line.concept;
      const id = code === 'eps' ? 4 : code === 'pension' ? 6 : ['solidarity', 'subsistence'].includes(code) ? 9 : undefined;
      return line.kind === 'deduction' && id ? { ...line, typeLawDeductionsId: id } : line;
    }),
  };
}
