/** Ignore missing values and placeholder dashes without hiding valid numeric zeroes. */
export function pdfOptionalText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  const text = String(value).trim()
  return text && !/^[—–-]+$/.test(text) ? text : null
}

interface TaxDetailsInput {
  documentKind?: string | null
  prefix?: string | null
  issuerTaxProfile?: { taxResponsibility?: string | null; vatRegime?: string | null; economicActivity?: string | null; icaRate?: number | null }
  authorization?: { number?: string | null; from?: string | null; to?: string | null; startDate?: string | null; endDate?: string | null }
}

export function invoicePdfTaxDetails(data: TaxDetailsInput) {
  const profile = data.issuerTaxProfile
  const fiscal = pdfOptionalText(profile?.taxResponsibility)
  const vat = profile?.vatRegime === 'non_vat_responsible' ? 'No responsable de IVA'
    : profile?.vatRegime === 'vat_responsible' ? 'Responsable de IVA' : null
  const taxLines = [fiscal ? `Responsabilidad fiscal: ${fiscal}` : null, vat ? `Régimen IVA: ${vat}` : null].filter((line): line is string => Boolean(line))
  const authorization = data.authorization
  const number = pdfOptionalText(authorization?.number)
  const from = pdfOptionalText(authorization?.from)
  const to = pdfOptionalText(authorization?.to)
  const start = pdfOptionalText(authorization?.startDate)
  const end = pdfOptionalText(authorization?.endDate)
  const note = ['CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_CREDIT_NOTE'].includes(data.documentKind ?? '')
  const hasResolution = !note && Boolean(number || from || to || start || end)
  const prefix = pdfOptionalText(data.prefix)
  const range = [from ? `Desde: ${from}` : null, to ? `Hasta: ${to}` : null].filter(Boolean).join('  ')
  const validity = start && end ? `${start} a ${end}` : start ? `Desde ${start}` : end ? `Hasta ${end}` : null
  const resolutionLines = hasResolution ? [
    number ? `Resolución No. ${number}` : null,
    prefix ? `Prefijo: ${prefix}` : null,
    range || null,
    validity ? `Vigencia: ${validity}` : null,
  ].filter((line): line is string => Boolean(line)) : []
  const activity = pdfOptionalText(profile?.economicActivity)
  const rate = profile?.icaRate != null && Number.isFinite(profile.icaRate) && profile.icaRate > 0 ? `Tarifa ICA: ${profile.icaRate} ‰` : null
  return {
    title: hasResolution ? taxLines.length ? 'Información tributaria y resolución de facturación' : 'Resolución de facturación' : 'Información tributaria',
    lines: [...taxLines, ...resolutionLines],
    activity: [activity ? `Actividad económica: ${activity}` : null, rate].filter(Boolean).join(' · '),
  }
}
