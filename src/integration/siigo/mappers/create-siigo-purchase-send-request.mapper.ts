import { BadRequestException } from '@nestjs/common';
import { CreateSiigoPurchaseSendRequestDto } from '../dto/create-siigo-purchase-send.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { SiigoPurchaseRequestDto } from '../dto/siigo-purchase-request.dto';
import { resolveSupportDocumentRetentionPlacement } from '../helpers/siigo-support-document-retention.helper';
import {
  calculateSiigoSupportDocumentPaymentValue,
} from '../helpers/siigo-purchase-total.helper';
import {
  mapSiigoDocumentSendItem,
  mapSiigoDocumentSendPayments,
} from './create-siigo-support-document-request.mapper';

export function mapCreatePurchaseSendRequestToSiigo(
  request: CreateSiigoPurchaseSendRequestDto,
  siigoDocumentTypeId: number,
  taxesCatalog: SiigoTaxCatalogItemDto[],
  defaultTaxId?: number,
  hasIva = false,
): SiigoPurchaseRequestDto {
  validateCreatePurchaseSendRequest(request);

  const retentionPlacement = resolveSupportDocumentRetentionPlacement(
    (request.retentions ?? []).map((retention) => retention.id),
    taxesCatalog,
  );
  const itemTaxes =
    hasIva && defaultTaxId && defaultTaxId > 0 ? [{ id: defaultTaxId }] : undefined;
  const items = request.items.map((item) => {
    const mappedItem = mapSiigoDocumentSendItem(
      item,
      retentionPlacement.itemRetentionIds,
    );

    if (itemTaxes && !(mappedItem.taxes?.length ?? 0)) {
      return {
        ...mappedItem,
        taxes: itemTaxes,
      };
    }

    return mappedItem;
  });
  const calculatedPaymentValue = calculateSiigoSupportDocumentPaymentValue(
    items,
    taxesCatalog,
    {
      retentionIds: [
        ...retentionPlacement.documentRetentions.map((retention) => retention.id),
        ...retentionPlacement.itemRetentionIds,
      ],
    },
  );

  return {
    document: { id: siigoDocumentTypeId },
    date: request.date.trim(),
    supplier: {
      identification: request.supplier.identification.trim(),
      branch_office: request.supplier.branch_office ?? 0,
    },
    ...(request.cost_center !== undefined
      ? { cost_center: request.cost_center }
      : {}),
    provider_invoice: {
      prefix: request.provider_invoice.prefix.trim(),
      number: request.provider_invoice.number.trim(),
    },
    ...(request.observations?.trim()
      ? { observations: request.observations.trim() }
      : {}),
    items,
    payments: mapSiigoDocumentSendPayments(
      request.payments,
      calculatedPaymentValue,
    ),
  };
}

function validateCreatePurchaseSendRequest(
  request: CreateSiigoPurchaseSendRequestDto,
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

  if (!request.provider_invoice?.prefix?.trim()) {
    throw new BadRequestException(
      'El documento debe incluir provider_invoice.prefix.',
    );
  }

  if (!request.provider_invoice?.number?.trim()) {
    throw new BadRequestException(
      'El documento debe incluir provider_invoice.number.',
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
