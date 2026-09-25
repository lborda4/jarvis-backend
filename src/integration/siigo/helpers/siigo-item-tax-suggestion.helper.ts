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
 * factura original. Solo hace match exacto por porcentaje — si no hay
 * ninguno, o si hay más de uno (ej. "IVA Servicios 19%" e "IVA Activo Fijo"
 * conviven en el mismo catálogo a la misma tarifa), devuelve null para que
 * el usuario elija el impuesto a mano en vez de mandarle a SIIGO un impuesto
 * adivinado — quedarse con el primero por orden de catálogo (antes
 * alfabético) es indistinguible de adivinar.
 */
export function resolveSuggestedTaxForItem(
  ivaPercentage: number | undefined,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SuggestedItemTax | null {
  if (ivaPercentage === undefined || ivaPercentage === null) {
    return null;
  }

  const matches = findActiveIvaTaxesByRate(ivaPercentage, taxesCatalog);

  if (matches.length !== 1) {
    return null;
  }

  const [match] = matches;

  return {
    id: match.id,
    name: match.name,
    percentage: match.percentage,
  };
}

/**
 * IVA de respaldo al enviar a SIIGO cuando el ítem no trae tax id: elige
 * uno cuya tarifa coincida con la factura (ítems o totales DIAN). Si hay
 * varios IVA al mismo %, usa el primero de ESA tarifa — nunca el primer IVA
 * del catálogo (eso mandaba 5% a facturas de 19%).
 */
export function resolveFallbackIvaTaxId(params: {
  itemIvaPercentages?: Array<number | undefined>;
  subtotal?: number;
  ivaAmount?: number;
  taxesCatalog: SiigoTaxCatalogItemDto[];
}): number | null {
  const rate = resolveInvoiceIvaRate(
    params.itemIvaPercentages,
    params.subtotal,
    params.ivaAmount,
  );

  if (rate === null) {
    return null;
  }

  const matches = findActiveIvaTaxesByRate(rate, params.taxesCatalog);

  return matches[0]?.id ?? null;
}

export function resolveInvoiceIvaRate(
  itemIvaPercentages?: Array<number | undefined>,
  subtotal?: number,
  ivaAmount?: number,
): number | null {
  const uniqueRates = [
    ...new Set(
      (itemIvaPercentages ?? [])
        .filter(
          (rate): rate is number =>
            typeof rate === 'number' && Number.isFinite(rate) && rate > 0,
        )
        .map((rate) => Math.round(rate * 100) / 100),
    ),
  ];

  if (uniqueRates.length === 1) {
    return uniqueRates[0];
  }

  if (
    typeof subtotal === 'number' &&
    subtotal > 0 &&
    typeof ivaAmount === 'number' &&
    ivaAmount > 0
  ) {
    return (ivaAmount / subtotal) * 100;
  }

  return null;
}

function findActiveIvaTaxesByRate(
  ivaPercentage: number,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SiigoTaxCatalogItemDto[] {
  return taxesCatalog.filter(
    (tax) =>
      tax.active !== false &&
      tax.type?.trim().toLowerCase() === 'iva' &&
      Math.abs(tax.percentage - ivaPercentage) < IVA_MATCH_TOLERANCE,
  );
}
