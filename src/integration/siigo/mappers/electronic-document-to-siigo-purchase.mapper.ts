import { BadRequestException } from '@nestjs/common';
import { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';
import { SiigoPurchaseRequestDto } from '../dto/siigo-purchase-request.dto';
import { SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT } from '../constants/siigo.constants';
import { SiigoPurchaseConfig } from '../helpers/siigo-runtime-config.helper';
import { splitNitAndCheckDigit } from '../helpers/siigo-nit.helper';
import { buildSiigoPurchasePayment } from '../helpers/siigo-purchase-total.helper';

export interface SiigoPurchaseMappingOptions {
  defaultTaxRate?: number;
}

export function mapElectronicDocumentToSiigoPurchase(
  payload: ElectronicDocumentPayload,
  config: SiigoPurchaseConfig,
  options: SiigoPurchaseMappingOptions = {},
): SiigoPurchaseRequestDto {
  validatePayloadForPurchase(payload);

  const supplierIdentification = splitNitAndCheckDigit(
    payload.supplier.documentNumber,
  ).identification;
  const providerInvoice = parseProviderInvoiceNumber(payload.invoice.number);
  const hasIva = payload.totals.iva > 0;
  const itemTaxes = hasIva ? [{ id: config.defaultTaxId }] : undefined;

  const items = payload.items.map((item) => {
    const accountCode = item.accountMapping?.code?.trim();

    if (!accountCode) {
      throw new BadRequestException(
        'Todos los ítems deben tener una cuenta contable asignada antes de crear la factura de compra.',
      );
    }

    return {
      type: SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT,
      code: accountCode,
      description: item.descripcion?.trim() || 'Ítem importado',
      quantity: item.cantidad > 0 ? item.cantidad : 1,
      price: item.valorUnitario > 0 ? item.valorUnitario : item.total,
      ...(itemTaxes ? { taxes: itemTaxes } : {}),
    };
  });

  const request: SiigoPurchaseRequestDto = {
    document: { id: config.documentId },
    ...(config.purchaseNumber ? { number: config.purchaseNumber } : {}),
    date: payload.invoice.issueDate,
    supplier: {
      identification: supplierIdentification,
      branch_office: 0,
    },
    provider_invoice: providerInvoice,
    observations: `CUFE: ${payload.invoice.cufe}`,
    items,
    payments: [
      buildSiigoPurchasePayment(items, config.paymentTypeId, {
        subtotal: payload.totals.subtotal,
        taxAmount: payload.totals.iva,
        dueDate: payload.invoice.dueDate,
        envDefaultTaxRate: options.defaultTaxRate,
      }),
    ],
  };

  return request;
}

function validatePayloadForPurchase(payload: ElectronicDocumentPayload): void {
  if (!payload.invoice.issueDate?.trim()) {
    throw new BadRequestException(
      'El payload no contiene la fecha de emisión de la factura.',
    );
  }

  if (!payload.invoice.cufe?.trim()) {
    throw new BadRequestException('El payload no contiene el CUFE de la factura.');
  }

  if (!payload.invoice.number?.trim()) {
    throw new BadRequestException(
      'El payload no contiene el número de factura del proveedor.',
    );
  }

  if (!payload.supplier.documentNumber?.trim()) {
    throw new BadRequestException(
      'El payload no contiene el documento del proveedor.',
    );
  }

  if (!payload.items.length) {
    throw new BadRequestException(
      'El payload no contiene ítems para crear la factura de compra.',
    );
  }

  if (!payload.totals.total || payload.totals.total <= 0) {
    throw new BadRequestException(
      'El payload no contiene un total válido para la factura.',
    );
  }
}

export function parseProviderInvoiceNumber(numeroFactura: string): {
  prefix: string;
  number: string;
} {
  const normalized = numeroFactura.trim();

  if (!normalized) {
    return { prefix: 'DIAN', number: '0' };
  }

  const match = normalized.match(/^([A-Za-z]+)[\s-]*(\d+)$/);

  if (match) {
    return {
      prefix: match[1].slice(0, 6),
      number: match[2].slice(0, 11),
    };
  }

  const digitsOnly = normalized.replace(/\D/g, '');

  return {
    prefix: 'DIAN',
    number: (digitsOnly || normalized).slice(0, 11),
  };
}

/**
 * Prefix + consecutivo para DETECTAR si una factura ya existe en SIIGO
 * (comparar contra historial_facturas.provider_invoice_*) — a diferencia de
 * parseProviderInvoiceNumber (que arma lo que se ENVÍA a la API de SIIGO al
 * crear, con los límites de longitud reales de esa API), acá NO hay que
 * adivinar dónde termina el prefijo: `invoice.prefix` ya viene tal cual del
 * Excel/NextPyme (columna propia, no derivada), así que se usa directo y el
 * consecutivo es simplemente lo que sobra de `invoice.number` (que es
 * `prefix + consecutivo` concatenados, ver mapDianSalesInvoiceRowToPayload).
 *
 * Antes esto reparseaba `invoice.number` con la regex de
 * parseProviderInvoiceNumber, que asume que el prefijo es SOLO letras — un
 * prefijo alfanumérico real (ej. "G9C4", "K330", "66DJ", todos de 4
 * caracteres) no matchea esa regex, cae al fallback `prefix: 'DIAN'` y
 * corrompe el consecutivo (le come dígitos del prefijo) — bug real
 * reportado: nunca detectaba que esas facturas ya estaban en SIIGO.
 */
export function resolveProviderInvoiceParts(invoice: {
  number: string;
  prefix?: string;
}): {
  prefix: string;
  number: string;
} {
  const trimmedPrefix = invoice.prefix?.trim();

  if (!trimmedPrefix) {
    return parseProviderInvoiceNumber(invoice.number);
  }

  const fullNumber = invoice.number?.trim() ?? '';
  const consecutive = fullNumber.startsWith(trimmedPrefix)
    ? fullNumber.slice(trimmedPrefix.length)
    : fullNumber;

  return {
    prefix: trimmedPrefix,
    number: consecutive || fullNumber,
  };
}
