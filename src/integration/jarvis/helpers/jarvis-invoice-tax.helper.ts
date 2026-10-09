import { formatMoney, toMoney } from './jarvis-nextpyme-response.helper';

interface InvoiceChargeTaxLine {
  taxId: number;
  taxAmount: number;
  quantity: number;
  unitValue: number;
  discount: number;
}

/** Conserva el tipo y la tarifa de cada línea al agrupar los impuestos.
 * IVA 0% (includeZeroAmount) cubre FAU04 en factura y DSAU04 en soporte:
 * TaxExclusiveAmount debe igualar la suma de bases imponibles de las líneas. */
export function buildJarvisInvoiceChargeTaxTotals(
  lines: InvoiceChargeTaxLine[],
  options?: { includeZeroAmount?: boolean },
) {
  const totals = new Map<string, {
    taxId: number; taxAmount: number; taxableAmount: number; percent: string;
  }>();
  for (const line of lines) {
    if (!options?.includeZeroAmount && line.taxAmount <= 0) continue;
    const base = toMoney(line.quantity * line.unitValue - line.discount);
    const percent = formatMoney(base > 0 ? line.taxAmount / base * 100 : 0);
    const key = `${line.taxId}:${percent}`;
    const total = totals.get(key) ?? {
      taxId: line.taxId, taxAmount: 0, taxableAmount: 0, percent,
    };
    total.taxAmount += line.taxAmount;
    total.taxableAmount += base;
    totals.set(key, total);
  }
  return [...totals.values()].map((total) => ({
    tax_id: total.taxId,
    tax_amount: formatMoney(toMoney(total.taxAmount)),
    taxable_amount: formatMoney(toMoney(total.taxableAmount)),
    percent: total.percent,
  }));
}
