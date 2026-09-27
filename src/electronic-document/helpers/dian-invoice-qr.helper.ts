export const DIAN_CATALOG_QR_BASE_URL =
  'https://catalogo-vpfe.dian.gov.co/document/searchqr';

export interface DianInvoiceQrFields {
  invoiceNumber: string;
  issueDate: string | null;
  /** Hora de emisión (HH:MM:SS). Vacío en documentos ya importados: el
   * mapper de NextPyme descarta `time`. */
  issueTime?: string | null;
  issuerNit: string;
  buyerNit: string;
  subtotal: number;
  iva: number;
  total: number;
  cufe: string;
}

function formatQrAmount(value: number): string {
  return value.toFixed(2);
}

export function buildDianCatalogQrUrl(cufe: string): string {
  return `${DIAN_CATALOG_QR_BASE_URL}?documentkey=${encodeURIComponent(cufe)}`;
}

/**
 * Texto del QR según el Anexo técnico UBL 2.1 de factura electrónica.
 * `HorFac` se omite si no hay hora: inventarla rompería la validación
 * frente al catálogo DIAN.
 */
export function buildDianInvoiceQrText(fields: DianInvoiceQrFields): string {
  const lines = [
    `NumFac: ${fields.invoiceNumber}`,
    `FecFac: ${fields.issueDate?.trim() || ''}`,
  ];

  const issueTime = fields.issueTime?.trim();
  if (issueTime) {
    lines.push(`HorFac: ${issueTime}`);
  }

  lines.push(
    `NitFac: ${fields.issuerNit}`,
    `DocAdq: ${fields.buyerNit}`,
    `ValFac: ${formatQrAmount(fields.subtotal)}`,
    `ValIva: ${formatQrAmount(fields.iva)}`,
    `ValTolFac: ${formatQrAmount(fields.total)}`,
    `CUFE: ${fields.cufe}`,
    buildDianCatalogQrUrl(fields.cufe),
  );

  return lines.join('\n');
}
