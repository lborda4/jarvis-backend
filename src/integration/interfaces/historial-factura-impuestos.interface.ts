export interface HistorialFacturaTaxDetail {
  id: number;
  name: string;
  percentage: number;
}

/**
 * Forma compartida por `historial_facturas.impuestos` y
 * `supplier_configurations.impuestos_default`. Cada campo (salvo `tarifas`)
 * representa como máximo un impuesto de esa categoría por línea — si SIIGO
 * trae varios de la misma categoría en una línea, los adicionales van a
 * `tarifas` en vez de perderse.
 */
export interface HistorialFacturaImpuestos {
  iva?: HistorialFacturaTaxDetail | null;
  retefuente?: HistorialFacturaTaxDetail | null;
  reteica?: HistorialFacturaTaxDetail | null;
  autorretencion?: HistorialFacturaTaxDetail | null;
  tarifas?: HistorialFacturaTaxDetail[];
}
