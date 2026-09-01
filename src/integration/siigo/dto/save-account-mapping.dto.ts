import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class SaveSupplierPaymentMethodPreferenceDto {
  id: number;
  name: string;
  type: string;
  dueDate?: boolean;
}

export class SaveSupplierRetentionPreferenceDto {
  id: number;
  name: string;
  type: string;
  percentage: number;
}

export class SaveSupplierCostCenterPreferenceDto {
  id: number;
  code: string;
  name: string;
}

export class SaveAccountMappingItemDto {
  descripcion: string;
  accountCode: string;
  accountDescription?: string;
}

export class SaveAccountMappingRequestDto {
  documentId: string;
  accountCode: string;
  accountDescription: string;
  paymentMethod?: SaveSupplierPaymentMethodPreferenceDto;
  retentions?: SaveSupplierRetentionPreferenceDto[];
  costCenter?: SaveSupplierCostCenterPreferenceDto;
  /** Cuenta por ítem individual (proveedor + descripción) — si viene, cada
   * ítem del documento se guarda con SU propia cuenta en vez de aplicar
   * `accountCode` a todos por igual. Si no viene (compatibilidad con
   * llamadores existentes de un solo concepto), se aplica `accountCode` a
   * todos los ítems del documento, igual que antes. */
  items?: SaveAccountMappingItemDto[];
}

export class SaveAccountMappingResponseDto {
  success: boolean;
  document: ElectronicDocumentResponseDto;
}
