import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';

export interface SuggestedItemTax {
  id: number;
  name: string;
  percentage: number;
}

const IVA_MATCH_TOLERANCE = 0.01;

/** Menor puntaje = mejor candidato. "IVA Activo Fijo" no puede ganar si
 * existe otro IVA a la misma tarifa: al enviar, SIIGO lo aplica como
 * impuesto de activo y el contador ve la compra contabilizada mal. */
function scoreIvaTaxName(name: string): number {
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/activo\s*fijo|fixed\s*asset/.test(normalized)) {
    return 100;
  }

  if (/compra/.test(normalized)) {
    return 0;
  }

  if (/bienes|general|gravado/.test(normalized)) {
    return 1;
  }

  if (/servicio/.test(normalized)) {
    return 2;
  }

  return 10;
}

export function pickPreferredIvaTax<T extends { name: string }>(
  matches: T[],
): T | null {
  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  return [...matches].sort((left, right) => {
    const scoreDiff = scoreIvaTaxName(left.name) - scoreIvaTaxName(right.name);

    return scoreDiff !== 0
      ? scoreDiff
      : left.name.localeCompare(right.name, 'es');
  })[0];
}

/**
 * Busca en el catálogo de impuestos de SIIGO de la empresa un IVA cuyo
 * porcentaje coincida (con tolerancia de punto flotante) con el que trae la
 * factura original. Si hay varios a la misma tarifa (ej. "IVA 19%" e
 * "IVA Activo Fijo"), elige el de compras/general — nunca Activo Fijo,
 * porque SIIGO lo aplica como impuesto de activo y la compra queda mal.
 */
export function resolveSuggestedTaxForItem(
  ivaPercentage: number | undefined,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SuggestedItemTax | null {
  if (ivaPercentage === undefined || ivaPercentage === null) {
    return null;
  }

  const match = pickPreferredIvaTax(
    findActiveIvaTaxesByRate(ivaPercentage, taxesCatalog),
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

/**
 * IVA de respaldo al enviar a SIIGO cuando el ítem no trae tax id: elige
 * uno cuya tarifa coincida con la factura (ítems o totales DIAN). Si hay
 * varios IVA al mismo %, usa el preferido de ESA tarifa (compras/general,
 * nunca Activo Fijo) — no el primer IVA del catálogo (eso mandaba 5% o
 * Activo Fijo a facturas de 19%).
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

  return pickPreferredIvaTax(matches)?.id ?? null;
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
