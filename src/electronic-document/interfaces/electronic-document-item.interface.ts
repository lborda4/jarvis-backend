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
  /** Tipo SIIGO que eligió el contador al guardar el borrador. */
  itemType?: 'Product' | 'FixedAsset' | 'Account';
  /** % de IVA del ítem tal como viene en la factura original (DIAN/NextPyme). */
  ivaPercentage?: number;
  /** Descuento propio de la línea (DIAN allowance_charges), si trae. */
  discount?: number;
}
