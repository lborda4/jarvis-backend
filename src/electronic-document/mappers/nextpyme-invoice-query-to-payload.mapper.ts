import { NextPymeInvoiceQueryResult } from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  // Redondea a centavos: NextPyme/DIAN a veces trae valores calculados con
  // residuo de punto flotante (ej. 3564706.3499999996), que SIIGO rechaza
  // más adelante por tener más de 2 decimales.
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

// Códigos DIAN de tipo de documento de identificación (tabla 5.7 UBL 2.1).
const DIAN_DOCUMENT_TYPE_BY_CODE: Record<string, string> = {
  '13': 'CC', // Cédula de ciudadanía
  '21': 'CE', // Tarjeta de extranjería
  '22': 'CE', // Cédula de extranjería
  '31': 'NIT',
  '41': 'PA', // Pasaporte
  '42': 'PA', // Documento de identificación extranjero
};

function resolveDocumentType(
  typeIdentification: string | number | undefined,
): string {
  const normalized = String(typeIdentification ?? '').trim();

  return DIAN_DOCUMENT_TYPE_BY_CODE[normalized] ?? 'NIT';
}

export function mapNextPymeInvoiceQueryToElectronicDocumentPayload(
  result: NextPymeInvoiceQueryResult,
  cufe: string,
): ElectronicDocumentPayload {
  const seller = result.seller;
  const totals = result.legal_monetary_totals;
  const lineExtension = toNumber(totals.line_extension_amount);
  const payable = toNumber(totals.payable_amount);
  const subtotal = lineExtension > 0 ? lineExtension : payable;
  const iva = Math.max(payable - subtotal, 0);
  const invoiceNumber =
    `${result.prefix ?? ''}${result.number ?? ''}`.trim() || cufe.slice(0, 12);

  const items = result.invoice_lines.length
    ? result.invoice_lines.map((line) => {
        const quantity = toNumber(line.invoiced_quantity);
        const price = toNumber(line.price_amount);
        const total = toNumber(line.line_extension_amount);
        // Se toma el primer impuesto de la línea como IVA — en Documento
        // Soporte/Factura de compra las retenciones no vienen por ítem acá.
        const firstTax = line.tax_totals?.[0];
        const ivaPercentage =
          firstTax?.percent !== undefined
            ? toNumber(firstTax.percent)
            : undefined;

        return {
          descripcion: line.description?.trim() || 'Ítem importado',
          cantidad: quantity > 0 ? quantity : 1,
          valorUnitario: price > 0 ? price : total,
          total: total > 0 ? total : price,
          ...(ivaPercentage !== undefined ? { ivaPercentage } : {}),
        };
      })
    : [
        {
          descripcion: 'Factura electrónica recibida',
          cantidad: 1,
          valorUnitario: subtotal,
          total: subtotal,
        },
      ];

  return {
    supplier: {
      documentNumber: String(seller.identification_number ?? '').replace(
        /\D/g,
        '',
      ),
      documentType: resolveDocumentType(seller.type_identification),
      name: seller.name?.trim() || '',
      commercialName: seller.name?.trim() || '',
      address: seller.address?.trim() || '',
      phone: seller.phone?.trim() || '',
      email: seller.email?.trim() || '',
      stateCode: seller.municipality?.department?.code?.trim() || '',
      cityCode:
        seller.municipality?.code?.trim() || seller.code?.trim() || '',
      countryCode: 'Co',
    },
    invoice: {
      cufe,
      prefix: result.prefix?.trim() || undefined,
      number: invoiceNumber,
      issueDate: result.date?.trim() || '',
      ...(result.payment_form?.payment_due_date?.trim()
        ? { dueDate: result.payment_form.payment_due_date.trim() }
        : {}),
      currency: 'COP',
    },
    items,
    taxes: iva > 0 ? [{ type: 'IVA', amount: iva }] : [],
    totals: {
      subtotal,
      total: payable,
      iva,
    },
    ...(result.notes?.trim() ? { observations: result.notes.trim() } : {}),
  };
}
