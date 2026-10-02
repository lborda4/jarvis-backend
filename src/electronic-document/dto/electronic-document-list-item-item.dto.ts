import { SuggestedItemTax } from '../../integration/siigo/helpers/siigo-item-tax-suggestion.helper';
import {
  SuggestedItemAccount,
  SuggestedProduct,
} from '../../integration/helpers/supplier-preference.helper';

export class ElectronicDocumentListItemItemDto {
  description: string;
  quantity: number;
  unitValue: number;
  total: number;
  /** Tarifa de IVA de esta línea; no se hereda del total de la factura. */
  ivaPercentage?: number;
  /** Tarifa de Impuesto al consumo (INC) de esta línea, si la factura lo trae. */
  consumptionTaxPercentage?: number;
  /** Código del producto/ítem tal como viene en la factura original (DIAN/NextPyme). */
  code?: string;
  /** Producto SIIGO confirmado; no es el código del proveedor. */
  productMapping?: { code: string };
  /** Cuenta que el contador asignó y guardó en payload.items.accountMapping. */
  accountMapping?: { code: string; description?: string } | null;
  /** Tipo SIIGO guardado en el borrador (Account / Product / FixedAsset). */
  itemType?: 'Product' | 'FixedAsset' | 'Account' | null;
  /** Descuento propio de la línea, si la factura original trae uno. */
  discount?: number;
  /**
   * Impuesto de SIIGO sugerido para este ítem, resuelto por coincidencia
   * exacta de porcentaje contra el catálogo de impuestos de la empresa.
   * null si el ítem no trae IVA en la factura original o no hubo match.
   */
  suggestedTax: SuggestedItemTax | null;
  /**
   * Impoconsumo del catálogo SIIGO sugerido para esta línea (type
   * Impoconsumo), cuando la factura trae INC. null si no hay INC o no
   * hubo match de tarifa.
   */
  suggestedConsumptionTax: SuggestedItemTax | null;
  /**
   * Cuenta PUC sugerida para ESTE ítem puntual, resuelta por
   * proveedor + descripción normalizada. `source: 'exact'` = regla
   * confirmada para esta descripción; `source: 'fallback'` = el proveedor
   * tiene una única cuenta en su historial pero esta descripción es nueva
   * — sugerida, no confirmada, el contador debe revisarla. `null` = sin
   * sugerencia, requiere asignación manual.
   */
  suggestedAccount: SuggestedItemAccount | null;
  /** Producto sugerido por IA para ESTA línea (facturas heterogéneas). */
  suggestedProduct?: SuggestedProduct | null;
}
