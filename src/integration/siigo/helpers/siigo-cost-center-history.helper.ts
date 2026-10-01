import { SiigoCostCenterCatalogItemDto } from '../dto/list-siigo-cost-centers.dto';
import { SupplierCostCenterPreference } from '../../interfaces/supplier-mapping-value.interface';

export interface CostCenterHistoryGroup { proveedorNit: string; id: number | null; count: number }

export function resolveHistoricalCostCenter(
  value: number | { id: number; code?: string; name?: string } | null | undefined,
  catalog: SiigoCostCenterCatalogItemDto[],
): SupplierCostCenterPreference | null {
  const id = typeof value === 'number' ? value : value?.id;
  if (!Number.isInteger(id) || !id || id <= 0) return null;
  return catalog.find(item => item.id === id) ?? {
    id, code: typeof value === 'object' ? String(value?.code ?? id) : String(id),
    name: typeof value === 'object' ? value?.name || `Centro ${id}` : `Centro ${id}`,
  };
}

export function dominantCostCenter(groups: CostCenterHistoryGroup[], catalog: SiigoCostCenterCatalogItemDto[]) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const best = groups.reduce<CostCenterHistoryGroup | null>((winner, group) => !winner || group.count > winner.count ? group : winner, null);
  const match = best && total > 0 && best.count / total > 0.7
    ? catalog.find(item => item.id === best.id) : undefined;
  return match ? { variable: false, valor: match } : { variable: true, valor: null };
}
