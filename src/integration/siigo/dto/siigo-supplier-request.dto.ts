export class SiigoSupplierRequestDto {
  type: string;
  person_type: string;
  id_type: string;
  identification: string;
  check_digit?: string;
  name: string[];
  commercial_name?: string;
  active?: boolean;
  vat_responsible?: boolean;
  fiscal_responsibilities: Array<{ code: string; name?: string }>;
  address?: {
    address: string;
    city: {
      country_code: string;
      state_code: string;
      city_code: string;
    };
  };
  phones?: { number: string; indicative?: string; extension?: string }[];
  contacts?: Array<{
    first_name: string;
    last_name: string;
    email?: string;
    phone?: { indicative?: string; number: string; extension?: string };
  }>;
  comments?: string;
}
