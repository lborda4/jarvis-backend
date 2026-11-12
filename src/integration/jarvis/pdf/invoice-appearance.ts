/** Presentation settings for the printed document, independent of the application theme. */
export interface InvoiceAppearance {
  accentColor: string
  footerText: string
  showLogo: boolean
}

export const DEFAULT_INVOICE_APPEARANCE: InvoiceAppearance = {
  accentColor: '#00A8A8', footerText: '', showLogo: true,
}

export function normalizeInvoiceColor(value: string): string | null {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i)
  if (!match) return null
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1]
  return `#${hex.toUpperCase()}`
}

export function normalizeInvoiceAppearance(value?: Partial<InvoiceAppearance> | null): InvoiceAppearance {
  return {
    accentColor: typeof value?.accentColor === 'string' ? normalizeInvoiceColor(value.accentColor) ?? DEFAULT_INVOICE_APPEARANCE.accentColor : DEFAULT_INVOICE_APPEARANCE.accentColor,
    footerText: typeof value?.footerText === 'string' ? value.footerText.trim().slice(0, 300) : '',
    showLogo: typeof value?.showLogo === 'boolean' ? value.showLogo : true,
  }
}

export function invoiceAppearanceColors(appearance?: Partial<InvoiceAppearance> | null) {
  const accent = normalizeInvoiceAppearance(appearance).accentColor
  const rgb = [1, 3, 5].map(offset => parseInt(accent.slice(offset, offset + 2), 16))
  const hex = (channels: number[]) => `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
  const luminance = (channels: number[]) => channels.map(channel => {
    const c = channel / 255
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
  let heading = [...rgb]
  while (1.05 / (luminance(heading) + .05) < 4.5) heading = heading.map(channel => channel * .85)
  return {
    accent, heading: hex(heading), soft: hex(rgb.map(channel => channel * .12 + 255 * .88)),
    onAccent: luminance(rgb) > .179 ? '#000000' : '#FFFFFF',
  }
}
