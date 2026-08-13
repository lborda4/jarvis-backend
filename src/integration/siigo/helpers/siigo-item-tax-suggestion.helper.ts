import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';

export interface SuggestedItemTax {
  id: number;
  name: string;
  percentage: number;
}

const IVA_MATCH_TOLERANCE = 0.01;

/**
 * Busca en el catálogo de impuestos de SIIGO de la empresa un IVA cuyo
 * porcentaje coincida (con tolerancia de punto flotante) con el que trae la
 * factura original. Solo hace match exacto por porcentaje — si no hay uno,
 * devuelve null para que el usuario elija el impuesto a mano en vez de
 * mandarle a SIIGO un impuesto adivinado.
 */
export function resolveSuggestedTaxForItem(
  ivaPercentage: number | undefined,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SuggestedItemTax | null {
  if (ivaPercentage === undefined || ivaPercentage === null) {
    return null;
  }

  const match = taxesCatalog.find(
    (tax) =>
      tax.active !== false &&
      tax.type?.trim().toLowerCase() === 'iva' &&
      Math.abs(tax.percentage - ivaPercentage) < IVA_MATCH_TOLERANCE,
  );

  if (!match) {
    return null;
  }

  return {
    id: match.id,
    name: match.name,
    percentage: match.percentage,
  };
}
