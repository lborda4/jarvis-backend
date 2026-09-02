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
