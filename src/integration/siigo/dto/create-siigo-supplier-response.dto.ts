export class CreateSiigoSupplierResponseSupplierDto {
  id: string;
  name: string;
  documentType: string;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
}

export class CreateSiigoSupplierResponseDto {
  success: boolean;
  /** true si se creó un tercero NUEVO en SIIGO en esta llamada — false si ya
   * existía y solo se reutilizó (ver findSupplierInSiigoWithRetries en
   * SiigoSupplierCreationService). */
  created: boolean;
  supplier: CreateSiigoSupplierResponseSupplierDto;
}
