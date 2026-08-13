import { SuggestedItemTax } from '../../integration/siigo/helpers/siigo-item-tax-suggestion.helper';

export class ElectronicDocumentListItemItemDto {
  description: string;
  quantity: number;
  unitValue: number;
  total: number;
  /**
   * Impuesto de SIIGO sugerido para este ítem, resuelto por coincidencia
   * exacta de porcentaje contra el catálogo de impuestos de la empresa.
   * null si el ítem no trae IVA en la factura original o no hubo match.
   */
  suggestedTax: SuggestedItemTax | null;
}
