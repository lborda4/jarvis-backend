import { SiigoPurchaseItemDto } from '../dto/siigo-purchase-request.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { normalizeSiigoTaxType } from './siigo-support-document-retention.helper';

export interface CalculateSiigoPurchaseTotalOptions {
  taxRate?: number;
  subtotal?: number;
  taxAmount?: number;
  discount?: number;
  dueDate?: string;
  envDefaultTaxRate?: number;
}

export type SiigoDiscountType = 'Value' | 'Percentage';

export interface SiigoLineItemForTotal {
  quantity: number;
  price: number;
  discount?: number;
  taxes?: Array<{ id: number }>;
}

export interface CalculateSiigoDocumentTotalOptions {
  discountType?: SiigoDiscountType;
  globalDiscount?: number;
  taxesById?: Map<number, Pick<SiigoTaxCatalogItemDto, 'id' | 'percentage' | 'type'>>;
  taxRate?: number;
  subtotal?: number;
  taxAmount?: number;
  envDefaultTaxRate?: number;
  roundAmount?: (value: number) => number;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Redondea montos para Siigo en pesos colombianos (enteros).
 * Solo aplica al valor calculado enviado a Siigo; no modifica totales del XML.
 */
export function roundSiigoAmount(value: number): number {
  return Math.round(roundMoney(value));
}

export function resolveSiigoTaxRate(
  options: Pick<
    CalculateSiigoDocumentTotalOptions,
    'taxRate' | 'subtotal' | 'taxAmount' | 'envDefaultTaxRate'
  >,
): number {
  if (options.taxRate !== undefined && options.taxRate >= 0) {
    return options.taxRate;
  }

  if (
    options.subtotal &&
    options.subtotal > 0 &&
    options.taxAmount &&
    options.taxAmount > 0
  ) {
    return options.taxAmount / options.subtotal;
  }

  if (options.envDefaultTaxRate !== undefined && options.envDefaultTaxRate >= 0) {
    return options.envDefaultTaxRate;
  }

  return 0;
}

export function buildSiigoTaxesByIdMap(
  taxesCatalog: SiigoTaxCatalogItemDto[],
): Map<number, Pick<SiigoTaxCatalogItemDto, 'id' | 'percentage' | 'type'>> {
  return new Map(taxesCatalog.map((tax) => [tax.id, tax]));
}

function isRetentionTaxType(type?: string): boolean {
  const normalized = normalizeSiigoTaxType(type);

  return (
    normalized.includes('rete') ||
    normalized.includes('autorreten') ||
    normalized.includes('autorretencion')
  );
}

function resolveLineDiscount(
  discount: number,
  lineGross: number,
  discountType: SiigoDiscountType,
  roundAmount: (value: number) => number,
): number {
  if (!Number.isFinite(discount) || discount <= 0) {
    return 0;
  }

  if (discountType === 'Percentage') {
    return roundAmount((lineGross * discount) / 100);
  }

  return roundAmount(discount);
}

function resolveGlobalDiscount(
  discount: number,
  itemsTotal: number,
  discountType: SiigoDiscountType,
  roundAmount: (value: number) => number,
): number {
  if (!Number.isFinite(discount) || discount <= 0) {
    return 0;
  }

  if (discountType === 'Percentage') {
    return roundAmount((itemsTotal * discount) / 100);
  }

  return roundAmount(discount);
}

function calculateSiigoLineBreakdown(
  item: SiigoLineItemForTotal,
  options: CalculateSiigoDocumentTotalOptions,
  roundAmount: (value: number) => number,
): { baseValue: number; taxTotal: number; lineTotal: number } {
  const discountType = options.discountType ?? 'Value';
  const lineGross = roundAmount(item.quantity * item.price);
  const lineDiscount = resolveLineDiscount(
    item.discount ?? 0,
    lineGross,
    discountType,
    roundAmount,
  );
  const baseValue = roundAmount(lineGross - lineDiscount);
  const taxRate = resolveSiigoTaxRate(options);
  let taxTotal = 0;

  if (item.taxes?.length) {
    if (options.taxesById?.size) {
      for (const taxRef of item.taxes) {
        const taxDefinition = options.taxesById.get(taxRef.id);

        if (
          !taxDefinition ||
          !Number.isFinite(taxDefinition.percentage) ||
          taxDefinition.percentage <= 0 ||
          isRetentionTaxType(taxDefinition.type)
        ) {
          continue;
        }

        taxTotal = roundAmount(
          taxTotal +
            roundAmount((baseValue * taxDefinition.percentage) / 100),
        );
      }
    } else if (taxRate > 0) {
      taxTotal = roundAmount((baseValue * taxRate) / 100);
    }
  }

  return {
    baseValue,
    taxTotal,
    lineTotal: roundAmount(baseValue + taxTotal),
  };
}

function calculateSiigoLineTotal(
  item: SiigoLineItemForTotal,
  options: CalculateSiigoDocumentTotalOptions,
  roundAmount: (value: number) => number,
): number {
  return calculateSiigoLineBreakdown(item, options, roundAmount).lineTotal;
}

function resolveRetentionBase(
  retentionType: string | undefined,
  subtotal: number,
  taxTotal: number,
): number {
  const normalized = normalizeSiigoTaxType(retentionType);

  if (normalized === 'reteiva') {
    return taxTotal;
  }

  return subtotal;
}

function calculateRetentionAmount(
  retentionType: string | undefined,
  percentage: number,
  base: number,
  roundAmount: (value: number) => number,
): number {
  const normalized = normalizeSiigoTaxType(retentionType);

  if (normalized === 'reteica') {
    return roundAmount((base * percentage) / 1000);
  }

  return roundAmount((base * percentage) / 100);
}

export function calculateSiigoDocumentRetentionTotal(
  items: SiigoLineItemForTotal[],
  retentionIds: number[],
  taxesCatalog: SiigoTaxCatalogItemDto[],
  options: CalculateSiigoDocumentTotalOptions = {},
): number {
  if (!retentionIds.length) {
    return 0;
  }

  const roundAmount = options.roundAmount ?? roundMoney;
  const taxesById = options.taxesById ?? buildSiigoTaxesByIdMap(taxesCatalog);
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    const breakdown = calculateSiigoLineBreakdown(item, options, roundAmount);
    subtotal = roundAmount(subtotal + breakdown.baseValue);
    taxTotal = roundAmount(taxTotal + breakdown.taxTotal);
  }

  let retentionTotal = 0;

  for (const retentionId of retentionIds) {
    const retention = taxesById.get(retentionId);

    if (
      !retention ||
      !Number.isFinite(retention.percentage) ||
      retention.percentage <= 0 ||
      !isRetentionTaxType(retention.type)
    ) {
      continue;
    }

    const base = resolveRetentionBase(retention.type, subtotal, taxTotal);
    retentionTotal = roundAmount(
      retentionTotal +
        calculateRetentionAmount(
          retention.type,
          retention.percentage,
          base,
          roundAmount,
        ),
    );
  }

  return retentionTotal;
}

/**
 * Calcula el total del documento igual que Siigo:
 * suma(total por ítem) - descuento global
 *
 * Cada ítem:
 * ValorBase = Redondear(Cantidad × Precio - Descuento)
 * Impuesto = Redondear((ValorBase × %Impuesto) / 100)
 * TotalItem = Redondear(ValorBase + Impuesto)
 */
export function calculateSiigoDocumentPaymentValue(
  items: SiigoLineItemForTotal[],
  options: CalculateSiigoDocumentTotalOptions = {},
): number {
  const roundAmount = options.roundAmount ?? roundMoney;
  const discountType = options.discountType ?? 'Value';
  const globalDiscount = options.globalDiscount ?? 0;
  let itemsTotal = 0;

  for (const item of items) {
    itemsTotal = roundAmount(
      itemsTotal + calculateSiigoLineTotal(item, options, roundAmount),
    );
  }

  const resolvedGlobalDiscount = resolveGlobalDiscount(
    globalDiscount,
    itemsTotal,
    discountType,
    roundAmount,
  );

  return roundAmount(itemsTotal - resolvedGlobalDiscount);
}

/**
 * Calcula el total de la compra igual que Siigo:
 * suma(subtotales por ítem) + suma(impuestos por ítem) - descuentos
 */
export function calculateSiigoPurchasePaymentValue(
  items: Pick<SiigoPurchaseItemDto, 'quantity' | 'price' | 'taxes'>[],
  options: CalculateSiigoPurchaseTotalOptions = {},
): number {
  const discount = options.discount ?? 0;

  return calculateSiigoDocumentPaymentValue(items, {
    taxRate: resolveSiigoTaxRate(options),
    subtotal: options.subtotal,
    taxAmount: options.taxAmount,
    envDefaultTaxRate: options.envDefaultTaxRate,
    globalDiscount: discount,
    roundAmount: roundSiigoAmount,
  });
}

export interface CalculateSiigoSupportDocumentTotalOptions
  extends Pick<
    CalculateSiigoDocumentTotalOptions,
    'discountType' | 'globalDiscount' | 'taxRate' | 'subtotal' | 'taxAmount'
  > {
  retentionIds?: number[];
}

export function calculateSiigoSupportDocumentPaymentValue(
  items: SiigoLineItemForTotal[],
  taxesCatalog: SiigoTaxCatalogItemDto[],
  options: CalculateSiigoSupportDocumentTotalOptions = {},
): number {
  const roundAmount = roundMoney;
  const documentOptions: CalculateSiigoDocumentTotalOptions = {
    ...options,
    taxesById: buildSiigoTaxesByIdMap(taxesCatalog),
    roundAmount,
  };
  const itemsTotal = calculateSiigoDocumentPaymentValue(items, documentOptions);
  const retentionTotal = calculateSiigoDocumentRetentionTotal(
    items,
    options.retentionIds ?? [],
    taxesCatalog,
    documentOptions,
  );

  return roundAmount(itemsTotal - retentionTotal);
}

export function buildSiigoPurchasePayment(
  items: Pick<SiigoPurchaseItemDto, 'quantity' | 'price' | 'taxes'>[],
  paymentTypeId: number,
  options: CalculateSiigoPurchaseTotalOptions = {},
): { id: number; value: number; due_date?: string } {
  const dueDate = options.dueDate?.trim();

  return {
    id: paymentTypeId,
    value: calculateSiigoPurchasePaymentValue(items, options),
    ...(dueDate ? { due_date: dueDate } : {}),
  };
}

export interface BuildSiigoSupportDocumentPaymentOptions
  extends CalculateSiigoSupportDocumentTotalOptions {
  dueDate?: string;
}

export function buildSiigoSupportDocumentPayment(
  items: SiigoLineItemForTotal[],
  paymentTypeId: number,
  taxesCatalog: SiigoTaxCatalogItemDto[],
  options: BuildSiigoSupportDocumentPaymentOptions = {},
): { id: number; value: number; due_date?: string } {
  const dueDate = options.dueDate?.trim();
  const { dueDate: _dueDate, ...totalOptions } = options;

  return {
    id: paymentTypeId,
    value: calculateSiigoSupportDocumentPaymentValue(
      items,
      taxesCatalog,
      totalOptions,
    ),
    ...(dueDate ? { due_date: dueDate } : {}),
  };
}
