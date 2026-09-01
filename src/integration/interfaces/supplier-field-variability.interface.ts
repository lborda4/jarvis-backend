import type { HistorialFacturaTaxDetail } from './historial-factura-impuestos.interface';
import type { SupplierPaymentMethodPreference } from './supplier-mapping-value.interface';

/**
 * Resultado del recálculo de variabilidad para UN campo del historial de un
 * proveedor: `variable=false` significa que ≥VARIABILITY_THRESHOLD del
 * historial (líneas o facturas, según el campo) coincide en el mismo valor,
 * que queda en `valor`. `variable=true` significa que no hay un valor único
 * confiable — el llamador debe resolverlo con el dato de la transacción
 * actual (o preguntarle al contador) en vez de asumir uno.
 *
 * `valor: null` con `variable: false` es un resultado válido y distinto de
 * "variable" — significa que el historial es consistente en NO tener ese
 * campo (ej. un proveedor que nunca trae Retefuente): tan confiable como
 * tener un valor fijo, solo que el valor fijo es "ninguno".
 */
export interface SupplierFieldVariabilityEntry<T> {
  variable: boolean;
  valor: T | null;
}

/**
 * Variabilidad calculada POR CAMPO para un proveedor (ver
 * SiigoPurchaseHistorySyncService.recomputeSupplierSummaries), reemplazando
 * el viejo `tieneVariabilidad` único a nivel de fila completa: dos facturas
 * del mismo proveedor pueden diferir en medio de pago pero coincidir
 * siempre en cuenta contable — antes eso marcaba TODO el proveedor como
 * variable (perdiendo la sugerencia de cuenta también); ahora cada campo se
 * evalúa de forma independiente.
 */
export interface SupplierFieldVariability {
  cuentaPuc?: SupplierFieldVariabilityEntry<string>;
  tipoItem?: SupplierFieldVariabilityEntry<'Account' | 'Product'>;
  medioPago?: SupplierFieldVariabilityEntry<SupplierPaymentMethodPreference>;
  iva?: SupplierFieldVariabilityEntry<HistorialFacturaTaxDetail>;
  retefuente?: SupplierFieldVariabilityEntry<HistorialFacturaTaxDetail>;
  reteica?: SupplierFieldVariabilityEntry<HistorialFacturaTaxDetail>;
  autorretencion?: SupplierFieldVariabilityEntry<HistorialFacturaTaxDetail>;
}
