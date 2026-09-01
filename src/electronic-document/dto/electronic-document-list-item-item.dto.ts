import { SuggestedItemTax } from '../../integration/siigo/helpers/siigo-item-tax-suggestion.helper';
import { SuggestedItemAccount } from '../../integration/helpers/supplier-preference.helper';

export class ElectronicDocumentListItemItemDto {
  description: string;
  quantity: number;
  unitValue: number;
  total: number;
  /** Código del producto/ítem tal como viene en la factura original (DIAN/NextPyme). */
  code?: string;
  /** Descuento propio de la línea, si la factura original trae uno. */
  discount?: number;
  /**
   * Impuesto de SIIGO sugerido para este ítem, resuelto por coincidencia
   * exacta de porcentaje contra el catálogo de impuestos de la empresa.
   * null si el ítem no trae IVA en la factura original o no hubo match.
   */
  suggestedTax: SuggestedItemTax | null;
  /**
   * Cuenta PUC sugerida para ESTE ítem puntual, resuelta por
   * proveedor + descripción normalizada. `source: 'exact'` = regla
   * confirmada para esta descripción; `source: 'fallback'` = el proveedor
   * tiene una única cuenta en su historial pero esta descripción es nueva
   * — sugerida, no confirmada, el contador debe revisarla. `null` = sin
   * sugerencia, requiere asignación manual.
   */
  suggestedAccount: SuggestedItemAccount | null;
}
