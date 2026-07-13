import { SiigoCustomer } from '../interfaces/siigo-api.interface';

export function getSiigoSupplierName(customer: SiigoCustomer): string {
  return (
    customer.commercial_name?.trim() ||
    customer.name?.find((value) => value.trim())?.trim() ||
    ''
  );
}
