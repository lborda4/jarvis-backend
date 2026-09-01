import { BadRequestException } from '@nestjs/common';
import { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';
import { SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT } from '../constants/siigo.constants';
import { SiigoSupportDocumentRequestDto } from '../dto/siigo-support-document-request.dto';
import { SiigoSupportDocumentConfig } from '../helpers/siigo-runtime-config.helper';
import { splitNitAndCheckDigit } from '../helpers/siigo-nit.helper';
import { truncateSiigoObservations } from '../helpers/siigo-observations.helper';
import { buildSiigoSupportDocumentPayment } from '../helpers/siigo-purchase-total.helper';

export function mapElectronicDocumentToSiigoSupportDocument(
  payload: ElectronicDocumentPayload,
  config: SiigoSupportDocumentConfig,
): SiigoSupportDocumentRequestDto {
  validatePayloadForSupportDocument(payload);

  const supplierIdentification = splitNitAndCheckDigit(
    payload.supplier.documentNumber,
  ).identification;
  const supplierReceiptNumber = buildSupplierReceiptNumber(payload);
  const hasIva = payload.totals.iva > 0;
  const itemTaxes = hasIva ? [{ id: config.defaultTaxId }] : undefined;

  const items = payload.items.map((item) => {
    const accountCode = item.accountMapping?.code?.trim();

    if (!accountCode) {
      throw new BadRequestException(
        'Todos los ítems deben tener una cuenta contable asignada antes de crear el Documento Soporte en SIIGO.',
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

  const observations = truncateSiigoObservations(
    payload.observations?.trim() ||
      (payload.invoice.cufe?.trim()
        ? `CUFE: ${payload.invoice.cufe.trim()}`
        : `Documento Soporte ${supplierReceiptNumber.prefix}-${supplierReceiptNumber.number}`),
  );

  const request: SiigoSupportDocumentRequestDto = {
    document: { id: config.documentId },
    date: payload.invoice.issueDate,
    supplier: {
      identification: supplierIdentification,
      branch_office: 0,
    },
    supplier_receipt_number: supplierReceiptNumber,
    observations,
    ...(config.sendStamp ? { stamp: { send: true } } : {}),
    items,
    payments: [
      buildSiigoSupportDocumentPayment(items, config.paymentTypeId, [], {
        subtotal: payload.totals.subtotal,
        taxAmount: payload.totals.iva,
        dueDate: payload.invoice.dueDate,
      }),
    ],
  };

  return request;
}

function validatePayloadForSupportDocument(
  payload: ElectronicDocumentPayload,
): void {
  if (!payload.invoice.issueDate?.trim()) {
    throw new BadRequestException(
      'El payload no contiene la fecha del Documento Soporte.',
    );
  }

  if (!payload.invoice.number?.trim() && !payload.invoice.prefix?.trim()) {
    throw new BadRequestException(
      'El payload no contiene el número del Documento Soporte.',
    );
  }

  if (!payload.supplier.documentNumber?.trim()) {
    throw new BadRequestException(
      'El payload no contiene el documento del proveedor.',
    );
  }

  if (!payload.items.length) {
    throw new BadRequestException(
      'El payload no contiene ítems para crear el Documento Soporte.',
    );
  }

  if (!payload.totals.total || payload.totals.total <= 0) {
    throw new BadRequestException(
      'El payload no contiene un total válido para el Documento Soporte.',
    );
  }
}

function buildSupplierReceiptNumber(payload: ElectronicDocumentPayload): {
  prefix: string;
  number: string;
} {
  const prefix = payload.invoice.prefix?.trim() || 'DS';
  const fullNumber = payload.invoice.number?.trim() || '';

  if (prefix && fullNumber.toUpperCase().startsWith(prefix.toUpperCase())) {
    const numberPart = fullNumber.slice(prefix.length).trim();
    const digitsOnly = numberPart.replace(/\D/g, '');

    return {
      prefix: prefix.slice(0, 6),
      number: (digitsOnly || numberPart || fullNumber).slice(0, 11),
    };
  }

  const digitsOnly = fullNumber.replace(/\D/g, '');

  return {
    prefix: prefix.slice(0, 6),
    number: (digitsOnly || fullNumber || '0').slice(0, 11),
  };
}
