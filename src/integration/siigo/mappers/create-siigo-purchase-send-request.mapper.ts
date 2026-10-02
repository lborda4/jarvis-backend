import { BadRequestException } from '@nestjs/common';
import { CreateSiigoPurchaseSendRequestDto } from '../dto/create-siigo-purchase-send.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { SiigoPurchaseRequestDto } from '../dto/siigo-purchase-request.dto';
import { resolveSupportDocumentRetentionPlacement } from '../helpers/siigo-support-document-retention.helper';
import { truncateSiigoObservations } from '../helpers/siigo-observations.helper';
import {
  calculateSiigoSupportDocumentPaymentValue,
  roundMoney,
} from '../helpers/siigo-purchase-total.helper';
import {
  mapSiigoDocumentSendItem,
  mapSiigoDocumentSendPayments,
} from './create-siigo-support-document-request.mapper';

export function mapCreatePurchaseSendRequestToSiigo(
  request: CreateSiigoPurchaseSendRequestDto,
  siigoDocumentTypeId: number,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SiigoPurchaseRequestDto {
  validateCreatePurchaseSendRequest(request);

  const retentionPlacement = resolveSupportDocumentRetentionPlacement(
    (request.retentions ?? []).map((retention) => retention.id),
    taxesCatalog,
  );
  // Igual que Documento Soporte: ReteICA/ReteIVA/Autorretención van en el
  // campo "retentions" a nivel documento, y Retefuente va como tax del ítem.
  // SIIGO rechaza (invalid_array) esos tipos de retención dentro de
  // items[].taxes, así que NO deben mezclarse ahí.
  const documentRetentionIds = retentionPlacement.documentRetentions.map(
    (retention) => retention.id,
  );
  const allRetentionIds = [
    ...documentRetentionIds,
    ...retentionPlacement.itemRetentionIds,
  ];
  const retentions = retentionPlacement.documentRetentions.length
    ? retentionPlacement.documentRetentions
    : undefined;
  // Una línea sin IVA debe conservarse así aunque las demás tengan impuesto.
  const items = request.items.map((item) =>
    mapSiigoDocumentSendItem(
      item,
      retentionPlacement.itemRetentionIds,
    ),
  );
  const calculatedPaymentValue = calculateSiigoSupportDocumentPaymentValue(
    items,
    taxesCatalog,
    {
      retentionIds: allRetentionIds,
      taxIncluded: request.tax_included === true,
      // SIIGO documenta el total de compra con Redondear(..., 2) por línea
      // (ValorBase, IVA, TotalItem). Usar pesos enteros (roundSiigoAmount)
      // aquí producía off-by-one reales: p.ej. price 151176.47 + IVA 19% →
      // nosotros 179899, SIIGO 179900 → invalid_total_payments. El reintento
      // con el total que reporta SIIGO sigue como red de seguridad.
      roundAmount: roundMoney,
    },
  );

  return {
    discount_type: 'Value',
    tax_included: request.tax_included === true,
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
      ? { observations: truncateSiigoObservations(request.observations.trim()) }
      : {}),
    ...(retentions?.length ? { retentions } : {}),
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
    throw new BadRequestException('El proveedor debe incluir identification.');
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
