import { SiigoCustomer } from './siigo-api.interface';
import { SiigoAuthContext } from './siigo-auth-context.interface';

export interface SiigoBatchContext {
  authContext: SiigoAuthContext;
  supplierByNit: Map<string, SiigoCustomer | null>;
  supplierRequestsInFlight: Map<string, Promise<SiigoCustomer | null>>;
}
