import { BadRequestException } from '@nestjs/common';
import { SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT, SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED } from '../constants/siigo.constants';
import {
  CreateSiigoSupportDocumentItemDto,
  CreateSiigoSupportDocumentRequestDto,
} from '../dto/create-siigo-support-document.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { SiigoSupportDocumentRequestDto } from '../dto/siigo-support-document-request.dto';
import {
  isAllowedSupportDocumentRetentionType,
} from '../helpers/siigo-support-document-retention.helper';
import { calculateSiigoSupportDocumentPaymentValue, roundMoney } from '../helpers/siigo-purchase-total.helper';

export function mapCreateSupportDocumentRequestToSiigo(
  request: CreateSiigoSupportDocumentRequestDto,
  siigoDocumentTypeId: number,
  taxesCatalog: SiigoTaxCatalogItemDto[],
  defaultSendStamp = SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED,
): SiigoSupportDocumentRequestDto {
  validateCreateSupportDocumentRequest(request);

  const items = request.items.map((item) => mapItem(item));
  const retentions = mapRetentions(request.retentions);
  const sendStamp = request.stamp?.send ?? defaultSendStamp;
  const calculatedPaymentValue = calculateSiigoSupportDocumentPaymentValue(
    items,
    taxesCatalog,
    {
      retentionIds: (retentions ?? []).map((retention) => retention.id),
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

function mapItem(item: CreateSiigoSupportDocumentItemDto) {
  const taxes = item.taxes?.filter((tax) => Number.isFinite(tax.id) && tax.id > 0);
  const discount =
    item.discount !== undefined && Number.isFinite(item.discount) && item.discount > 0
      ? item.discount
      : undefined;

  return {
    type: item.type?.trim() || SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT,
    code: item.code.trim(),
    description: item.description?.trim() || 'Ítem importado',
    quantity: item.quantity > 0 ? item.quantity : 1,
    price: item.price,
    ...(discount !== undefined ? { discount } : {}),
    ...(taxes?.length ? { taxes } : {}),
  };
}

function mapRetentions(
  retentions?: CreateSiigoSupportDocumentRequestDto['retentions'],
): Array<{ id: number }> | undefined {
  if (!retentions?.length) {
    return undefined;
  }

  const mapped: Array<{ id: number }> = [];
  const rejectedTypes = new Set<string>();

  for (const retention of retentions) {
    if (!Number.isFinite(retention.id) || retention.id <= 0) {
      continue;
    }

    if (retention.type && !isAllowedSupportDocumentRetentionType(retention.type)) {
      rejectedTypes.add(retention.type.trim());
      continue;
    }

    mapped.push({ id: retention.id });
  }

  if (rejectedTypes.size > 0) {
    throw new BadRequestException(
      `Las retenciones de tipo ${[...rejectedTypes].join(', ')} no son válidas en Documento Soporte. Solo se permiten ReteICA y Retefuente.`,
    );
  }

  if (retentions.length > 0 && mapped.length === 0) {
    throw new BadRequestException(
      'Las retenciones enviadas no son válidas para Documento Soporte. Solo se permiten ReteICA y Retefuente.',
    );
  }

  return mapped.length ? mapped : undefined;
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
