import { SiigoCostCenterCatalogItemDto } from '../dto/list-siigo-cost-centers.dto';

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Resuelve el texto libre que trae la columna "Centro de costos" del Excel
 * de Documento Soporte contra el catálogo real — contra tres formas
 * posibles del valor, en orden:
 * 1. "código - nombre" completo (el formato exacto que arma la lista
 *    desplegable de la plantilla, ver formatCostCenterLabel) — el más
 *    específico, se intenta primero.
 * 2. Código exacto (si el usuario escribió el código solo, a mano).
 * 3. Nombre exacto (si escribió el nombre solo, a mano).
 * Todas las comparaciones son insensibles a mayúsculas/acentos. Devuelve
 * `null` si no matchea nada (texto vacío, o un valor que no existe en el
 * catálogo activo) — el llamador debe seguir sin `cost_center` en vez de
 * bloquear todo por un dato opcional mal escrito.
 */
export function resolveSiigoCostCenter(
  rawValue: string | undefined,
  costCenters: SiigoCostCenterCatalogItemDto[],
): SiigoCostCenterCatalogItemDto | null {
  const normalized = rawValue?.trim() ? normalize(rawValue) : '';

  if (!normalized) {
    return null;
  }

  const byFullLabel = costCenters.find(
    (costCenter) =>
      normalize(`${costCenter.code} - ${costCenter.name}`) === normalized,
  );

  if (byFullLabel) {
    return byFullLabel;
  }

  const byCode = costCenters.find(
    (costCenter) => normalize(costCenter.code) === normalized,
  );

  if (byCode) {
    return byCode;
  }

  const byName = costCenters.find(
    (costCenter) => normalize(costCenter.name) === normalized,
  );

  return byName ?? null;
}

/** Igual que `resolveSiigoCostCenter`, pero devuelve solo el id — para
 * llamadores que arman directamente el request de SIIGO (`cost_center` es
 * un número, no el objeto completo). */
export function resolveSiigoCostCenterId(
  rawValue: string | undefined,
  costCenters: SiigoCostCenterCatalogItemDto[],
): number | null {
  return resolveSiigoCostCenter(rawValue, costCenters)?.id ?? null;
}
