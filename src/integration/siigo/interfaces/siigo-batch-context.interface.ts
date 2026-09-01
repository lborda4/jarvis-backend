import { SiigoCustomer } from './siigo-api.interface';
import { SiigoAuthContext } from './siigo-auth-context.interface';

export interface SiigoBatchContext {
  authContext: SiigoAuthContext;
  /** Nombres locales por NIT normalizado (supplier_configurations). */
  localSupplierNamesByNit: Map<string, string>;
  supplierByNit: Map<string, SiigoCustomer | null>;
  supplierRequestsInFlight: Map<string, Promise<SiigoCustomer | null>>;
  /** Serializa la creación automática de terceros por NIT dentro del lote —
   * varias facturas del mismo proveedor nuevo no disparan creaciones
   * simultáneas (createSupplier ya reutiliza el tercero si otra ya lo creó
   * mientras tanto). Opcional: solo lo usa la preparación en segundo plano. */
  supplierCreationInFlight?: Map<string, Promise<boolean>>;
}
