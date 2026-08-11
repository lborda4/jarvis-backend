import { SiigoCustomer } from './siigo-api.interface';
import { SiigoAuthContext } from './siigo-auth-context.interface';

export interface SiigoBatchContext {
  authContext: SiigoAuthContext;
  /** Nombres locales por NIT normalizado (supplier_configurations). */
  localSupplierNamesByNit: Map<string, string>;
  supplierByNit: Map<string, SiigoCustomer | null>;
  supplierRequestsInFlight: Map<string, Promise<SiigoCustomer | null>>;
}
