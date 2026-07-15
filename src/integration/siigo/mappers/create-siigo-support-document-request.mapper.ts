import { BadRequestException } from '@nestjs/common';
import { SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT, SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED } from '../constants/siigo.constants';
import {
  CreateSiigoSupportDocumentItemDto,
  CreateSiigoSupportDocumentRequestDto,
} from '../dto/create-siigo-support-document.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { SiigoSupportDocumentRequestDto } from '../dto/siigo-support-document-request.dto';
import { resolveSupportDocumentRetentionPlacement } from '../helpers/siigo-support-document-retention.helper';
import { calculateSiigoSupportDocumentPaymentValue, roundMoney } from '../helpers/siigo-purchase-total.helper';

export function mapCreateSupportDocumentRequestToSiigo(
  request: CreateSiigoSupportDocumentRequestDto,
  siigoDocumentTypeId: number,
  taxesCatalog: SiigoTaxCatalogItemDto[],
  defaultSendStamp = SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED,
): SiigoSupportDocumentRequestDto {
  validateCreateSupportDocumentRequest(request);

  const retentionPlacement = resolveSupportDocumentRetentionPlacement(
    (request.retentions ?? []).map((retention) => retention.id),
    taxesCatalog,
  );
  const items = request.items.map((item) =>
    mapItem(item, retentionPlacement.itemRetentionIds),
  );
  const retentions = retentionPlacement.documentRetentions.length
    ? retentionPlacement.documentRetentions
    : undefined;
  const sendStamp = request.stamp?.send ?? defaultSendStamp;
  const allRetentionIds = [
    ...retentionPlacement.documentRetentions.map((retention) => retention.id),
    ...retentionPlacement.itemRetentionIds,
  ];
  const calculatedPaymentValue = calculateSiigoSupportDocumentPaymentValue(
    items,
    taxesCatalog,
    {
      retentionIds: allRetentionIds,
    },
  );

  return {
    document: { id: siigoDocumentTypeId },
    date: request.date.trim(),
    supplier: {
      identification: request.supplier.identification.trim(),
      branch_office: request.supplier.branch_office ?? 0,
    },
    supplier_receipt_number: {
      prefix: request.supplier_receipt_number.prefix.trim(),
      number: request.supplier_receipt_number.number.trim(),
    },
    ...(request.observations?.trim()
      ? { observations: request.observations.trim() }
      : {}),
    ...(sendStamp ? { stamp: { send: true } } : {}),
    ...(retentions?.length ? { retentions } : {}),
    items,
    payments: mapPayments(request.payments, calculatedPaymentValue),
  };
}

function mapPayments(
  payments: CreateSiigoSupportDocumentRequestDto['payments'],
  calculatedTotal: number,
) {
  if (payments.length === 1) {
    const payment = payments[0];

    return [
      {
        id: payment.id,
        value: calculatedTotal,
        ...(payment.due_date?.trim()
          ? { due_date: payment.due_date.trim() }
          : {}),
      },
    ];
  }

  const requestedTotal = payments.reduce((sum, payment) => sum + payment.value, 0);

  if (requestedTotal <= 0) {
    throw new BadRequestException(
      'Los pagos deben tener un valor total mayor a cero.',
    );
  }

  let assigned = 0;

  return payments.map((payment, index) => {
    const value =
      index === payments.length - 1
        ? roundMoney(calculatedTotal - assigned)
        : roundMoney((payment.value / requestedTotal) * calculatedTotal);
    assigned = roundMoney(assigned + value);

    return {
      id: payment.id,
      value,
      ...(payment.due_date?.trim() ? { due_date: payment.due_date.trim() } : {}),
    };
  });
}

function mapItem(
  item: CreateSiigoSupportDocumentItemDto,
  itemRetentionIds: number[],
) {
  const taxes = item.taxes?.filter((tax) => Number.isFinite(tax.id) && tax.id > 0);
  const discount =
    item.discount !== undefined && Number.isFinite(item.discount) && item.discount > 0
      ? item.discount
      : undefined;
  const existingTaxIds = new Set((taxes ?? []).map((tax) => tax.id));
  const itemRetentions = itemRetentionIds
    .filter((retentionId) => !existingTaxIds.has(retentionId))
    .map((retentionId) => ({ id: retentionId }));
  const mergedTaxes = [...(taxes ?? []), ...itemRetentions];

  return {
    type: item.type?.trim() || SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT,
    code: item.code.trim(),
    description: item.description?.trim() || 'Ítem importado',
    quantity: item.quantity > 0 ? item.quantity : 1,
    price: item.price,
    ...(discount !== undefined ? { discount } : {}),
    ...(mergedTaxes.length ? { taxes: mergedTaxes } : {}),
  };
}

function validateCreateSupportDocumentRequest(
  request: CreateSiigoSupportDocumentRequestDto,
): void {
  if (!request.documentId?.trim()) {
    throw new BadRequestException('El campo documentId es obligatorio.');
  }

  if (!request.date?.trim()) {
    throw new BadRequestException('El campo date es obligatorio.');
  }

  if (!request.supplier?.identification?.trim()) {
    throw new BadRequestException(
      'El proveedor debe incluir identification.',
    );
  }

  if (!request.supplier_receipt_number?.prefix?.trim()) {
    throw new BadRequestException(
      'El documento debe incluir supplier_receipt_number.prefix.',
    );
  }

  if (!request.supplier_receipt_number?.number?.trim()) {
    throw new BadRequestException(
      'El documento debe incluir supplier_receipt_number.number.',
    );
  }

  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new BadRequestException('Debe enviar al menos un ítem.');
  }

  if (!Array.isArray(request.payments) || request.payments.length === 0) {
    throw new BadRequestException('Debe enviar al menos un pago.');
  }

  for (const item of request.items) {
    if (!item.code?.trim()) {
      throw new BadRequestException('Cada ítem debe incluir code.');
    }

    if (!Number.isFinite(item.price)) {
      throw new BadRequestException('Cada ítem debe incluir price válido.');
    }
  }

  for (const payment of request.payments) {
    if (!Number.isFinite(payment.id) || payment.id <= 0) {
      throw new BadRequestException('Cada pago debe incluir id válido.');
    }

    if (!Number.isFinite(payment.value) || payment.value <= 0) {
      throw new BadRequestException('Cada pago debe incluir value válido.');
    }
  }
}
