import { SiigoCustomer } from '../interfaces/siigo-api.interface';

export function getSiigoSupplierName(customer: SiigoCustomer): string {
  return (
    customer.name?.find((value) => value.trim())?.trim() ||
    customer.commercial_name?.trim() ||
    ''
  );
}
