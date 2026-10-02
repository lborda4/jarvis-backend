import type { AiSuggestionItemSnapshot } from './electronic-document-payload.interface';

export interface ElectronicDocumentItemAccountMapping {
  code: string;
  description?: string;
}

export interface ElectronicDocumentItem {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  total: number;
  codigo?: string;
  /** Sugerencia de IA de esta línea; independiente de la asignación contable. */
  aiSuggestion?: AiSuggestionItemSnapshot | null;
  accountMapping?: ElectronicDocumentItemAccountMapping;
  /** Producto SIIGO confirmado en el borrador; independiente del SKU original. */
  productMapping?: { code: string };
  /** Tipo SIIGO que eligió el contador al guardar el borrador. */
  itemType?: 'Product' | 'FixedAsset' | 'Account';
  /** % de IVA del ítem tal como viene en la factura original (DIAN/NextPyme). */
  ivaPercentage?: number;
  /** % de Impuesto al consumo (INC / Impoconsumo) de la línea, si la factura lo trae. */
  consumptionTaxPercentage?: number;
  /** Descuento propio de la línea (DIAN allowance_charges), si trae. */
  discount?: number;
  /** Recargo propio de la línea (allowance_charges con charge_indicator). */
  surcharge?: number;
}
