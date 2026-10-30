import { BadRequestException } from '@nestjs/common';
import type { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';
import type { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import { isImpoconsumoTaxType } from './siigo-item-tax-suggestion.helper';

export function purchaseHasConsumptionTax(payload?: ElectronicDocumentPayload): boolean {
  return Boolean(payload?.taxes?.some(tax => tax.type === 'INC' && tax.amount > 0) || payload?.items?.some(item => (item.consumptionTaxPercentage ?? 0) > 0));
}

export function assertPurchaseConsumptionTax(payload: ElectronicDocumentPayload | undefined, items: Array<{ taxes?: Array<{ id: number }> }>, catalog: SiigoTaxCatalogItemDto[]) {
  if (!purchaseHasConsumptionTax(payload)) return;
  const consumptionIds = new Set(catalog.filter(tax => tax.active !== false && isImpoconsumoTaxType(tax.type)).map(tax => tax.id));
  if (!items.some(item => item.taxes?.some(tax => consumptionIds.has(tax.id)))) {
    throw new BadRequestException('La factura original tiene impoconsumo, pero el envío no incluye un impuesto al consumo válido de SIIGO. Sincroniza los impuestos y revisa la factura antes de enviarla.');
  }
}
