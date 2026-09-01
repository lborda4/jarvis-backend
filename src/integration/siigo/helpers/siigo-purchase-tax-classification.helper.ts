import { HistorialFacturaImpuestos, HistorialFacturaTaxDetail } from '../../interfaces/historial-factura-impuestos.interface';
import { HistorialFacturaTipo } from '../../enums/historial-factura-tipo.enum';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import {
  SiigoPurchaseResponseRetention,
  SiigoPurchaseResponseTax,
} from '../interfaces/siigo-api.interface';

export function buildTaxCatalogById(
  taxesCatalog: SiigoTaxCatalogItemDto[],
): Map<number, SiigoTaxCatalogItemDto> {
  return new Map(taxesCatalog.map((tax) => [tax.id, tax]));
}

const IMPUESTOS_BUCKET_BY_TAX_TYPE: Record<
  string,
  keyof Pick<HistorialFacturaImpuestos, 'iva' | 'retefuente' | 'reteica' | 'autorretencion'>
> = {
  iva: 'iva',
  retefuente: 'retefuente',
  reteica: 'reteica',
  autorretencion: 'autorretencion',
  'autorretención': 'autorretencion',
};

/** Inverso de IMPUESTOS_BUCKET_BY_TAX_TYPE, con la capitalización que ya usa
 * el resto del código (ver examples en ListSiigoTaxesQueryDto). */
export const RETENTION_TYPE_LABEL_BY_BUCKET: Record<'retefuente' | 'reteica' | 'autorretencion', string> = {
  retefuente: 'Retefuente',
  reteica: 'ReteICA',
  autorretencion: 'Autorretención',
};

function classifyTaxEntries(
  entries: Array<{ id: number; name: string; percentage: number }>,
  taxCatalogById: Map<number, SiigoTaxCatalogItemDto>,
): HistorialFacturaImpuestos {
  const impuestos: HistorialFacturaImpuestos = {};
  const tarifas: HistorialFacturaTaxDetail[] = [];

  for (const entry of entries) {
    const catalogTax = taxCatalogById.get(entry.id);
    const normalizedType = catalogTax?.type?.trim().toLowerCase();
    const bucket = normalizedType
      ? IMPUESTOS_BUCKET_BY_TAX_TYPE[normalizedType]
      : undefined;
    const detail: HistorialFacturaTaxDetail = {
      id: entry.id,
      name: entry.name,
      percentage: entry.percentage,
    };

    if (bucket && !impuestos[bucket]) {
      impuestos[bucket] = detail;
    } else {
      tarifas.push(detail);
    }
  }

  if (tarifas.length > 0) {
    impuestos.tarifas = tarifas;
  }

  return impuestos;
}

/**
 * Clasifica los impuestos de ítem + retenciones de documento de una compra de
 * SIIGO en los baldes de `HistorialFacturaImpuestos`, usando el catálogo de
 * impuestos ya sincronizado (`/v1/taxes`) para resolver la categoría real por
 * id — el `type` numérico que trae `retentions[]` en la respuesta de compras
 * es un código interno de SIIGO, no la categoría (IVA/Retefuente/...).
 * Impuestos sin categoría reconocida, o repetidos dentro de la misma
 * categoría, van a `tarifas` en vez de perderse.
 */
export function classifySiigoPurchaseTaxes(
  itemTaxes: SiigoPurchaseResponseTax[] | undefined,
  documentRetentions: SiigoPurchaseResponseRetention[] | undefined,
  taxCatalogById: Map<number, SiigoTaxCatalogItemDto>,
): HistorialFacturaImpuestos {
  const entries: Array<{ id: number; name: string; percentage: number }> = [
    ...(itemTaxes ?? []).map((tax) => ({
      id: tax.id,
      name: tax.name,
      percentage: tax.percentage,
    })),
    ...(documentRetentions ?? []).map((retention) => ({
      id: retention.id,
      name: retention.name,
      percentage: retention.percentage,
    })),
  ];

  return classifyTaxEntries(entries, taxCatalogById);
}

/**
 * Igual que classifySiigoPurchaseTaxes, pero a partir de ids sueltos (como
 * los que traen los DTOs de envío: `items[].taxes[].id`, `retentions[].id`),
 * resolviendo nombre/porcentaje desde el catálogo ya sincronizado.
 */
export function classifyTaxIdsUsingCatalog(
  taxIds: number[],
  taxCatalogById: Map<number, SiigoTaxCatalogItemDto>,
): HistorialFacturaImpuestos {
  const entries = taxIds
    .map((id) => taxCatalogById.get(id))
    .filter((tax): tax is SiigoTaxCatalogItemDto => Boolean(tax))
    .map((tax) => ({ id: tax.id, name: tax.name, percentage: tax.percentage }));

  return classifyTaxEntries(entries, taxCatalogById);
}

/** IVA no es una retención: se excluye a propósito (fluye por el mecanismo de suggestedTax existente). */
export function mapImpuestosToRetentionPreferences(
  impuestos: HistorialFacturaImpuestos,
): Array<{ id: number; name: string; type: string; percentage: number }> {
  const retentionBuckets: Array<'retefuente' | 'reteica' | 'autorretencion'> = [
    'retefuente',
    'reteica',
    'autorretencion',
  ];

  return retentionBuckets
    .map((bucket) => {
      const detail = impuestos[bucket];

      return detail
        ? {
            id: detail.id,
            name: detail.name,
            type: RETENTION_TYPE_LABEL_BY_BUCKET[bucket],
            percentage: detail.percentage,
          }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export function mapSiigoItemTypeToHistorialTipo(
  siigoItemType: string | undefined,
): HistorialFacturaTipo {
  return siigoItemType?.trim().toLowerCase() === 'product'
    ? HistorialFacturaTipo.PRODUCTO
    : HistorialFacturaTipo.CUENTA;
}
