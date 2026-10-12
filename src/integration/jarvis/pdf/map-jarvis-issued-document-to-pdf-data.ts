import type { PurchaseInvoiceDownloadPartyDto } from '../../../electronic-document/dto/purchase-invoice-download.dto';
import {
  buildDianCatalogQrUrl,
  buildDianInvoiceQrText,
} from '../../../electronic-document/helpers/dian-invoice-qr.helper';
import type { JarvisCredentials } from '../../interfaces/integration-credentials.interface';
import type { JarvisSalesInvoice } from '../entities/jarvis-sales-invoice.entity';
import { JarvisResolutionKind } from '../enums/jarvis-resolution-kind.enum';
import type { JarvisInvoicePdfData } from './jarvis-invoice-pdf-data';

function party(
  overrides: Partial<PurchaseInvoiceDownloadPartyDto>,
): PurchaseInvoiceDownloadPartyDto {
  return {
    name: null,
    tradeName: null,
    documentType: null,
    documentNumber: null,
    checkDigit: null,
    address: null,
    phone: null,
    email: null,
    countryName: null,
    departmentName: null,
    cityName: null,
    ...overrides,
  };
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Representación gráfica cuando NextPyme no entrega el XML (p. ej. HTTP 402).
 * Usa el documento ya emitido y el request guardado; no reemite.
 */
export function mapJarvisIssuedDocumentToPdfData(
  invoice: JarvisSalesInvoice,
  credentials?: JarvisCredentials | null,
  company?: { nit: string; name: string } | null,
): JarvisInvoicePdfData | null {
  const request = invoice.sourceRequest;
  const items = Array.isArray(request?.items) ? request.items : [];
  if (!invoice.cufe?.trim() || items.length === 0) {
    return null;
  }

  const mappedItems = items.map((item) => {
    const quantity = money(item.quantity);
    const unitValue = money(item.unitValue);
    const discount = money(item.discount);
    const ivaAmount = money(item.taxAmount);
    const line = quantity * unitValue - discount;
    const ivaPercentage = line > 0 ? (ivaAmount / line) * 100 : 0;
    return {
      description: item.description?.trim() || 'Ítem',
      code: item.code?.trim() || null,
      quantity,
      unitValue,
      discount: discount || null,
      surcharge: null,
      ivaPercentage,
      ivaAmount: ivaAmount || null,
      total: line,
      taxes: ivaAmount > 0 ? [{ type: 'IVA', amount: ivaAmount }] : [],
    };
  });

  const subtotal = mappedItems.reduce((sum, item) => sum + item.total, 0);
  const iva = mappedItems.reduce((sum, item) => sum + (item.ivaAmount ?? 0), 0);
  const documentDiscount = money(request?.discountAmount);
  const total = invoice.total != null && Number.isFinite(Number(invoice.total))
    ? Number(invoice.total)
    : subtotal + iva - documentDiscount;
  const invoiceNumber = `${invoice.prefix ?? ''}${invoice.number ?? ''}`.trim();
  const cufe = invoice.cufe.trim();
  const relatedNumber = request?.billingReference?.number?.trim();
  const relatedKind =
    invoice.documentKind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE ||
    invoice.documentKind === JarvisResolutionKind.SUPPORT_DOCUMENT
      ? 'Documento relacionado'
      : 'Factura relacionada';

  const issuer = party({
    name: credentials?.business_name?.trim() || company?.name?.trim() || null,
    documentType: 'NIT',
    documentNumber: company?.nit?.trim() || null,
    tradeName: credentials?.trade_name?.trim() || credentials?.business_name?.trim() || null,
    address: credentials?.address?.trim() || null,
    phone: credentials?.phone?.trim() || null,
    email: credentials?.email?.trim() || null,
    cityName: credentials?.city?.trim() || credentials?.municipality?.trim() || null,
    departmentName: credentials?.department?.trim() || null,
    countryName: credentials?.country?.trim() || null,
  });
  const buyer = party({
    name: invoice.customerName?.trim() || request?.customerName?.trim() || null,
    documentType: request?.customerDocumentType?.trim() || null,
    documentNumber:
      invoice.customerIdentification?.trim() ||
      request?.customerIdentification?.trim() ||
      null,
  });

  return {
    id: invoice.id,
    documentKind: invoice.documentKind,
    cufe,
    invoiceNumber: invoiceNumber || null,
    prefix: invoice.prefix?.trim() || null,
    issueDate: invoice.issueDate || request?.issueDate || null,
    dueDate: request?.payment?.due_date?.trim() || null,
    isCreditPayment:
      request?.payment?.payment_form_id === 2
        ? true
        : request?.payment?.payment_form_id === 1
          ? false
          : null,
    paymentMethodName: null,
    currency: invoice.currency || request?.currency || 'COP',
    observations: request?.observations?.trim() || null,
    issuer,
    buyer,
    items: mappedItems,
    taxes: iva > 0 ? [{ type: 'IVA', amount: iva }] : [],
    subtotal,
    iva,
    discount: documentDiscount || null,
    surcharge: null,
    total,
    withholdings: [],
    references: relatedNumber
      ? [
          {
            type: relatedKind,
            number: relatedNumber,
            date: request?.billingReference?.issueDate ?? null,
          },
        ]
      : [],
    dianQrUrl: buildDianCatalogQrUrl(cufe),
    dianQrText: buildDianInvoiceQrText({
      invoiceNumber: invoiceNumber || cufe,
      issueDate: invoice.issueDate || request?.issueDate || null,
      issuerNit: issuer.documentNumber || '',
      buyerNit: buyer.documentNumber || '',
      subtotal,
      iva,
      total,
      cufe,
    }),
    taxExclusiveAmount: subtotal,
    taxInclusiveAmount: subtotal + iva,
  };
}

export function hasIssuedPdfFallback(
  invoice: Pick<JarvisSalesInvoice, 'sourceRequest' | 'cufe'>,
): boolean {
  return Boolean(
    invoice.cufe?.trim() &&
      Array.isArray(invoice.sourceRequest?.items) &&
      invoice.sourceRequest.items.length > 0,
  );
}
