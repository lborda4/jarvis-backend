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
  supplier: CreateSiigoSupplierResponseSupplierDto;
}
